// netlify/functions/admin-activity.js
//
// Returns the recent admin activity log (logins, account changes, device
// logouts). Requires manageAccounts permission since it's security-related.
//
// Query param: ?days=14 (default 14, max 90)

const { getStore } = require('@netlify/blobs');
const auth = require('./lib/auth');

exports.handler = async function (event) {
  const me = await auth.authenticate(event);
  if (!me) return auth.json(401, { ok: false, error: 'Not logged in.' });
  if (!auth.requirePermission(me, 'manageAccounts')) {
    return auth.json(403, { ok: false, error: 'You do not have permission to view this.' });
  }

  const days = Math.min(parseInt((event.queryStringParameters || {}).days, 10) || 14, 90);
  const store = getStore('adminEvents');
  let entries = [];

  try {
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `activity:${d.toISOString().slice(0, 10)}`;
      const dayEntries = await store.get(key, { type: 'json' });
      if (dayEntries) entries = entries.concat(dayEntries);
    }
    entries.sort((a, b) => b.ts - a.ts);
    return auth.json(200, { ok: true, entries: entries.slice(0, 100) });
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not load activity.' });
  }
};
