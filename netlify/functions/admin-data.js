// netlify/functions/admin-data.js
//
// Returns the raw-but-scoped data the dashboard needs to draw its charts.
// Reads the last N days of gifts/events/subscriptions from Netlify Blobs.
// Small-scale friendly: a church site won't generate enough volume for
// this to be slow.
//
// Query param: ?days=30 (default 30, max 180)

const { getStore } = require('@netlify/blobs');
const auth = require('./lib/auth');

function dateKeysForRange(days) {
  const keys = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

exports.handler = async function (event) {
  const me = await auth.authenticate(event);
  if (!me) return auth.json(401, { ok: false, error: 'Not logged in.' });

  const days = Math.min(parseInt((event.queryStringParameters || {}).days, 10) || 30, 180);
  const dayKeys = dateKeysForRange(days);
  const store = getStore('adminEvents');

  const result = { ok: true };

  try {
    if (auth.requirePermission(me, 'viewGiving')) {
      let gifts = [];
      let subscriptions = [];
      let alerts = [];
      for (const day of dayKeys) {
        const dayGifts = await store.get(`gifts:${day}`, { type: 'json' });
        if (dayGifts) gifts = gifts.concat(dayGifts.map((g) => ({ ...g, day })));
        const daySubs = await store.get(`subscriptions:${day}`, { type: 'json' });
        if (daySubs) subscriptions = subscriptions.concat(daySubs.map((s) => ({ ...s, day })));
        const dayAlerts = await store.get(`alerts:${day}`, { type: 'json' });
        if (dayAlerts) alerts = alerts.concat(dayAlerts.map((a) => ({ ...a, day })));
      }
      result.gifts = gifts;
      result.subscriptions = subscriptions;
      result.alerts = alerts;
    }

    if (auth.requirePermission(me, 'viewSocial')) {
      let events = [];
      let pageViews = [];
      for (const day of dayKeys) {
        const dayEvents = await store.get(`events:${day}`, { type: 'json' });
        if (dayEvents) events = events.concat(dayEvents.map((e) => ({ ...e, day })));
        const dayViews = await store.get(`pageviews:${day}`, { type: 'json' });
        if (dayViews) pageViews = pageViews.concat(dayViews.map((v) => ({ ...v, day })));
      }
      result.events = events;
      result.pageViews = pageViews;
    }

    return auth.json(200, result);
  } catch (err) {
    console.error(err);
    return auth.json(500, { ok: false, error: 'Could not load dashboard data.' });
  }
};
