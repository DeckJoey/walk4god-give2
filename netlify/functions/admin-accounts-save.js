// netlify/functions/admin-accounts-save.js
//
// Creates a new admin account, or updates an existing one's permissions /
// disabled state / password. Requires manageAccounts permission.
//
// Body for a NEW account:
//   { identifier, displayName, password, permissions: {viewGiving, viewSocial, manageAccounts} }
// Body for UPDATING an existing account:
//   { userId, displayName?, permissions?, disabled?, newPassword? }

const crypto = require('crypto');
const auth = require('./lib/auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const me = await auth.authenticate(event);
  if (!me) return auth.json(401, { ok: false, error: 'Not logged in.' });
  if (!auth.requirePermission(me, 'manageAccounts')) {
    return auth.json(403, { ok: false, error: 'You do not have permission to manage accounts.' });
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // ---- Updating an existing account ----
    if (body.userId) {
      if (body.userId === 'owner') {
        return auth.json(400, { ok: false, error: "The owner account can't be edited here." });
      }
      const user = await auth.getUser(body.userId);
      if (!user) return auth.json(404, { ok: false, error: 'Account not found.' });

      if (typeof body.displayName === 'string') user.displayName = body.displayName;
      if (body.permissions && typeof body.permissions === 'object') {
        user.permissions = {
          viewGiving: !!body.permissions.viewGiving,
          viewSocial: !!body.permissions.viewSocial,
          manageAccounts: !!body.permissions.manageAccounts,
        };
      }
      if (typeof body.disabled === 'boolean') user.disabled = body.disabled;
      if (body.newPassword) {
        const { hash, salt } = auth.hashPassword(body.newPassword);
        user.passwordHash = hash;
        user.passwordSalt = salt;
      }

      await auth.saveUser(user);
      await auth.logActivity(me.displayName || me.identifier, 'Updated account', user.displayName || user.identifier);
      return auth.json(200, { ok: true });
    }

    // ---- Creating a new account ----
    const { identifier, displayName, password, permissions } = body;
    if (!identifier || !password) {
      return auth.json(400, { ok: false, error: 'Email/phone and a password are required.' });
    }
    if (password.length < 8) {
      return auth.json(400, { ok: false, error: 'Password must be at least 8 characters.' });
    }

    const existing = await auth.findUserByIdentifier(identifier);
    if (existing) {
      return auth.json(400, { ok: false, error: 'An account with that email/phone already exists.' });
    }
    const ownerIdentifier = auth.normalizeIdentifier(process.env.ADMIN_OWNER_IDENTIFIER || '');
    if (auth.normalizeIdentifier(identifier) === ownerIdentifier) {
      return auth.json(400, { ok: false, error: 'That identifier is reserved for the owner account.' });
    }

    const { hash, salt } = auth.hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      identifier: identifier.trim(),
      displayName: displayName || identifier.trim(),
      passwordHash: hash,
      passwordSalt: salt,
      disabled: false,
      permissions: {
        viewGiving: !!(permissions && permissions.viewGiving),
        viewSocial: !!(permissions && permissions.viewSocial),
        manageAccounts: !!(permissions && permissions.manageAccounts),
      },
      createdAt: Date.now(),
      createdBy: me.userId,
    };

    await auth.saveUser(user);
    await auth.logActivity(me.displayName || me.identifier, 'Added account', user.displayName || user.identifier);
    return auth.json(200, { ok: true, userId: user.id });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not save the account.' });
  }
};
