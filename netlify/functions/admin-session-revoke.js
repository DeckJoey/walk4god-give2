// netlify/functions/admin-session-revoke.js
//
// Logs out one specific device/session for a given account. Requires
// manageAccounts permission (an admin can log out anyone's device,
// including their own current one).

const auth = require('./lib/auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const me = await auth.authenticate(event);
  if (!me) return auth.json(401, { ok: false, error: 'Not logged in.' });
  if (!auth.requirePermission(me, 'manageAccounts')) {
    return auth.json(403, { ok: false, error: 'You do not have permission to manage devices.' });
  }

  try {
    const { userId, sessionId } = JSON.parse(event.body || '{}');
    if (!userId || !sessionId) {
      return auth.json(400, { ok: false, error: 'Missing account or device.' });
    }
    await auth.revokeSession(userId, sessionId);
    await auth.logActivity(me.displayName || me.identifier, 'Logged out a device', userId);
    return auth.json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not log out that device.' });
  }
};
