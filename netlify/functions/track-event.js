// netlify/functions/track-event.js
//
// Public endpoint called from the live site to log lightweight events:
//   - social_click     { platform: 'youtube'|'instagram'|'tiktok'|... }
//   - give_started      (fired when someone taps "Next" on the Give page)
//   - phone_verified     (fired right before checkout starts)
//   - page_view        { page, referrer, source }
//
// Actual completed gifts are logged separately by stripe-webhook.js,
// since that's the source of truth (a click here doesn't mean they paid).
//
// Events are appended to Netlify Blobs under events:YYYY-MM-DD (or
// pageviews:YYYY-MM-DD for page views) so the admin dashboard can page
// through by day without loading everything.

const { getStore } = require('@netlify/blobs');

const ALLOWED_TYPES = new Set(['social_click', 'give_started', 'phone_verified', 'page_view']);
const ALLOWED_PLATFORMS = new Set(['youtube', 'instagram', 'tiktok', 'facebook', 'podcast']);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const type = body.type;
    if (!ALLOWED_TYPES.has(type)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false }) };
    }
    if (type === 'social_click' && !ALLOWED_PLATFORMS.has(body.platform)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false }) };
    }

    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const store = getStore('adminEvents');

    if (type === 'page_view') {
      const record = {
        page: typeof body.page === 'string' ? body.page.slice(0, 200) : '/',
        source: typeof body.source === 'string' ? body.source.slice(0, 80) : 'direct',
        ts: Date.now(),
      };
      const key = `pageviews:${day}`;
      const existing = (await store.get(key, { type: 'json' })) || [];
      existing.push(record);
      await store.setJSON(key, existing);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const record = {
      type,
      platform: type === 'social_click' ? body.platform : undefined,
      ts: Date.now(),
    };
    const key = `events:${day}`;
    const existing = (await store.get(key, { type: 'json' })) || [];
    existing.push(record);
    await store.setJSON(key, existing);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    // Tracking should never break the user's experience — fail quietly.
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};
