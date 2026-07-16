// netlify/functions/admin-login.js
//
// Logs an admin in with email/phone + password. Two paths:
//   1. Identifier matches ADMIN_OWNER_IDENTIFIER and password matches
//      ADMIN_MASTER_PASSWORD -> logs in as the permanent "owner" account.
//   2. Otherwise looks up a regular account created on the Accounts page.
//
// Body: { identifier, password, remember }
//   remember: true -> session lasts 30 days instead of the default 12 hours.

const crypto = require('crypto');
const auth = require('./lib/auth');

const SESSION_LENGTH_MS = 12 * 60 * 60 * 1000; // 12 hours
const REMEMBER_LENGTH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { identifier, password, remember } = JSON.parse(event.body || '{}');
    if (!identifier || !password) {
      return auth.json(400, { ok: false, error: 'Enter your email/phone and password.' });
    }

    const norm = auth.normalizeIdentifier(identifier);
    const ownerIdentifier = auth.normalizeIdentifier(process.env.ADMIN_OWNER_IDENTIFIER || '');
    const ip =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for'] ||
      'unknown';
    const device = auth.deviceLabel(event.headers['user-agent']);
    const sessionLength = remember ? REMEMBER_LENGTH_MS : SESSION_LENGTH_MS;

    // ---- Path 1: owner / master password ----
    if (norm && norm === ownerIdentifier && password === process.env.ADMIN_MASTER_PASSWORD) {
      const sessionId = crypto.randomUUID();
      await auth.addSession('owner', {
        sessionId, device, ip, createdAt: Date.now(), lastSeenAt: Date.now(), revoked: false,
      });
      const token = auth.signToken({ userId: 'owner', sessionId, exp: Date.now() + sessionLength });
      await auth.logActivity('Owner', 'Logged in', device);
      return auth.json(200, {
        ok: true,
        token,
        user: {
          displayName: 'Owner',
          identifier: process.env.ADMIN_OWNER_IDENTIFIER,
          isOwner: true,
          permissions: { viewGiving: true, viewSocial: true, manageAccounts: true },
        },
      });
    }

    // ---- Path 2: regular account ----
    const user = await auth.findUserByIdentifier(identifier);
    if (!user || user.disabled) {
      return auth.json(401, { ok: false, error: 'Incorrect login or password.' });
    }
    if (!auth.verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      return auth.json(401, { ok: false, error: 'Incorrect login or password.' });
    }

    const sessionId = crypto.randomUUID();
    await auth.addSession(user.id, {
      sessionId, device, ip, createdAt: Date.now(), lastSeenAt: Date.now(), revoked: false,
    });
    const token = auth.signToken({ userId: user.id, sessionId, exp: Date.now() + sessionLength });
    await auth.logActivity(user.displayName || user.identifier, 'Logged in', device);

    return auth.json(200, {
      ok: true,
      token,
      user: {
        displayName: user.displayName,
        identifier: user.identifier,
        isOwner: false,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Something went wrong. Please try again.' });
  }
};
