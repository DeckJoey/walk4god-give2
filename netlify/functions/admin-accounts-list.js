// netlify/functions/admin-accounts-list.js
//
// Returns every admin account (not passwords) plus their session/device
// list. Requires the caller to have the manageAccounts permission.

const auth = require('./lib/auth');

exports.handler = async function (event) {
  const me = await auth.authenticate(event);
  if (!me) return auth.json(401, { ok: false, error: 'Not logged in.' });
  if (!auth.requirePermission(me, 'manageAccounts')) {
    return auth.json(403, { ok: false, error: 'You do not have permission to manage accounts.' });
  }

  try {
    const users = await auth.listUsers();
    const accounts = [];

    // Include the permanent owner account at the top, if configured.
    if (process.env.ADMIN_OWNER_IDENTIFIER) {
      const ownerSessions = await auth.getSessions('owner');
      accounts.push({
        id: 'owner',
        identifier: process.env.ADMIN_OWNER_IDENTIFIER,
        displayName: 'Owner',
        isOwner: true,
        disabled: false,
        permissions: { viewGiving: true, viewSocial: true, manageAccounts: true },
        devices: ownerSessions
          .filter((s) => !s.revoked)
          .map((s) => ({ sessionId: s.sessionId, device: s.device, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
      });
    }

    for (const u of users) {
      const sessions = await auth.getSessions(u.id);
      accounts.push({
        id: u.id,
        identifier: u.identifier,
        displayName: u.displayName,
        isOwner: false,
        disabled: !!u.disabled,
        permissions: u.permissions,
        devices: sessions
          .filter((s) => !s.revoked)
          .map((s) => ({ sessionId: s.sessionId, device: s.device, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
      });
    }

    return auth.json(200, { ok: true, accounts });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not load accounts.' });
  }
};
