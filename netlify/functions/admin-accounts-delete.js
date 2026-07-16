// netlify/functions/admin-accounts-delete.js
//
// Permanently removes an admin account and its sessions. Requires
// manageAccounts permission. The owner account can never be deleted.

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
    const { userId } = JSON.parse(event.body || '{}');
    if (!userId || userId === 'owner') {
      return auth.json(400, { ok: false, error: "That account can't be deleted." });
    }
    const user = await auth.getUser(userId);
    await auth.deleteUser(userId);
    await auth.logActivity(me.displayName || me.identifier, 'Deleted account', user ? (user.displayName || user.identifier) : userId);
    return auth.json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not delete the account.' });
  }
};
