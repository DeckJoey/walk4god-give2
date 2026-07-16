// netlify/functions/lib/auth.js
//
// Shared helpers for the admin auth system. Not a public endpoint itself —
// imported by the admin-* functions.
//
// Storage: Netlify Blobs, store name "adminAuth".
//   user:<userId>       -> { id, identifier, displayName, permissions, passwordHash, passwordSalt,
//                            createdAt, disabled }
//   sessions:<userId>   -> [ { sessionId, device, ip, createdAt, lastSeenAt, revoked } ]
//
// Required env vars:
//   ADMIN_OWNER_IDENTIFIER  - the email or phone the owner logs in with
//   ADMIN_MASTER_PASSWORD   - the owner's permanent recovery password
//   ADMIN_TOKEN_SECRET      - random long string used to sign session tokens
//
// Optional env vars:
//   ALERT_EMAIL             - where failed-recurring-payment alerts get emailed (via Resend)

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const PERMISSION_KEYS = ['viewGiving', 'viewSocial', 'manageAccounts'];

function store() {
  return getStore('adminAuth');
}

function normalizeIdentifier(id) {
  return (id || '').trim().toLowerCase();
}

// ---------- password hashing (scrypt, salted) ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // timing-safe compare
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- session tokens (HMAC-signed, stateful so they can be revoked) ----------

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.ADMIN_TOKEN_SECRET || '')
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyTokenSignature(token) {
  try {
    const [body, sig] = (token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto
      .createHmac('sha256', process.env.ADMIN_TOKEN_SECRET || '')
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { userId, sessionId, exp }
  } catch (e) {
    return null;
  }
}

// ---------- device label from user-agent (best-effort, no dependency) ----------

function deviceLabel(userAgent) {
  const ua = userAgent || '';
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/OPR|Brave/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  let os = 'Unknown device';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}

// ---------- user records ----------

async function findUserByIdentifier(identifier) {
  const s = store();
  const norm = normalizeIdentifier(identifier);
  const { blobs } = await s.list({ prefix: 'user:' });
  for (const b of blobs) {
    const raw = await s.get(b.key, { type: 'json' });
    if (raw && normalizeIdentifier(raw.identifier) === norm) {
      return raw;
    }
  }
  return null;
}

async function getUser(userId) {
  return store().get(`user:${userId}`, { type: 'json' });
}

async function saveUser(user) {
  await store().setJSON(`user:${user.id}`, user);
}

async function listUsers() {
  const s = store();
  const { blobs } = await s.list({ prefix: 'user:' });
  const users = [];
  for (const b of blobs) {
    const u = await s.get(b.key, { type: 'json' });
    if (u) users.push(u);
  }
  return users;
}

async function deleteUser(userId) {
  await store().delete(`user:${userId}`);
  await store().delete(`sessions:${userId}`);
}

// ---------- sessions / devices ----------

async function getSessions(userId) {
  const list = await store().get(`sessions:${userId}`, { type: 'json' });
  return list || [];
}

async function addSession(userId, session) {
  const sessions = await getSessions(userId);
  sessions.push(session);
  // keep at most the 20 most recent sessions per user
  const trimmed = sessions.slice(-20);
  await store().setJSON(`sessions:${userId}`, trimmed);
}

async function touchSession(userId, sessionId) {
  const sessions = await getSessions(userId);
  const s = sessions.find((x) => x.sessionId === sessionId);
  if (s) {
    s.lastSeenAt = Date.now();
    await store().setJSON(`sessions:${userId}`, sessions);
  }
}

async function revokeSession(userId, sessionId) {
  const sessions = await getSessions(userId);
  const s = sessions.find((x) => x.sessionId === sessionId);
  if (s) s.revoked = true;
  await store().setJSON(`sessions:${userId}`, sessions);
}

// ---------- request-level auth check ----------
// Verifies the Authorization: Bearer <token> header. Returns
// { userId, permissions, isOwner, displayName, identifier } or null.

async function authenticate(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = verifyTokenSignature(token);
  if (!payload) return null;

  if (payload.userId === 'owner') {
    await touchSession('owner', payload.sessionId);
    const sessions = await getSessions('owner');
    const s = sessions.find((x) => x.sessionId === payload.sessionId);
    if (!s || s.revoked) return null;
    return {
      userId: 'owner',
      identifier: process.env.ADMIN_OWNER_IDENTIFIER || '',
      displayName: 'Owner',
      isOwner: true,
      permissions: { viewGiving: true, viewSocial: true, manageAccounts: true },
    };
  }

  const user = await getUser(payload.userId);
  if (!user || user.disabled) return null;

  const sessions = await getSessions(user.id);
  const s = sessions.find((x) => x.sessionId === payload.sessionId);
  if (!s || s.revoked) return null;
  await touchSession(user.id, payload.sessionId);

  return {
    userId: user.id,
    identifier: user.identifier,
    displayName: user.displayName,
    isOwner: false,
    permissions: user.permissions,
  };
}

function requirePermission(authResult, key) {
  return !!(authResult && authResult.permissions && authResult.permissions[key]);
}

// ---------- activity log (audit trail for admin actions) ----------

async function logActivity(actor, action, detail) {
  try {
    const eventsStore = getStore('adminEvents');
    const day = new Date().toISOString().slice(0, 10);
    const key = `activity:${day}`;
    const existing = (await eventsStore.get(key, { type: 'json' })) || [];
    existing.push({ actor, action, detail: detail || '', ts: Date.now() });
    await eventsStore.setJSON(key, existing);
  } catch (e) {
    console.error('Could not log activity:', e);
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

module.exports = {
  PERMISSION_KEYS,
  store,
  normalizeIdentifier,
  hashPassword,
  verifyPassword,
  signToken,
  verifyTokenSignature,
  deviceLabel,
  findUserByIdentifier,
  getUser,
  saveUser,
  listUsers,
  deleteUser,
  getSessions,
  addSession,
  touchSession,
  revokeSession,
  authenticate,
  requirePermission,
  logActivity,
  json,
};
