/**
 * POST /api/delete-resources
 *
 * Unified delete endpoint for org users (Firebase Auth) and Storage files.
 * Body: { type: 'users' | 'storage', ...typeSpecificFields }
 *
 * type='users':   { uids: string[] }          — requires Nearwork admin auth token
 * type='storage': { path?: string, paths?: string[] }
 *
 * Merged from delete-org-users.js + delete-storage-file.js to stay within
 * Vercel Hobby plan's 12 serverless-function limit.
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const HARDCODED_ADMINS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];

function initAdmin() {
  if (admin.apps.length) return admin.app();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
      storageBucket: STORAGE_BUCKET,
    });
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket: STORAGE_BUCKET,
    });
  }
  throw new Error('Firebase Admin credentials are not configured');
}

const ALLOWED_STORAGE_PREFIXES = ['cvs/', 'candidate-cvs/', 'candidate-photos/', 'org-assets/', 'assessment-files/'];

async function deleteUsers(req, res) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return res.status(401).json({ ok: false, error: 'Missing auth token' });

  const adminApp = initAdmin();
  const authAdmin = admin.auth(adminApp);
  const decoded = await authAdmin.verifyIdToken(idToken);
  const callerEmail = (decoded.email || '').toLowerCase();
  const isNearworkAdmin = callerEmail.endsWith('@nearwork.co') || HARDCODED_ADMINS.includes(callerEmail);
  if (!isNearworkAdmin) return res.status(403).json({ ok: false, error: 'Forbidden: caller is not a Nearwork admin' });

  const { uids = [] } = req.body || {};
  if (!Array.isArray(uids) || !uids.length) return res.status(200).json({ ok: true, deleted: 0 });

  let deleted = 0;
  const errors = [];
  for (let i = 0; i < uids.length; i += 100) {
    const result = await authAdmin.deleteUsers(uids.slice(i, i + 100));
    deleted += result.successCount;
    result.errors.forEach((e) => errors.push({ uid: e.index, reason: e.error.message }));
  }
  return res.status(200).json({ ok: true, deleted, errors });
}

async function deleteStorageFiles(req, res) {
  const { path, paths } = req.body || {};
  const filePaths = paths || (path ? [path] : []);
  if (!filePaths.length) return res.status(400).json({ ok: false, error: 'Provide path or paths in the request body' });

  const invalid = filePaths.filter((p) => !ALLOWED_STORAGE_PREFIXES.some((prefix) => p.startsWith(prefix)));
  if (invalid.length) return res.status(400).json({ ok: false, error: `Paths not in allowed prefix list: ${invalid.join(', ')}` });

  initAdmin();
  const bucket = admin.storage().bucket();
  const results = await Promise.allSettled(
    filePaths.map((p) => bucket.file(p).delete().catch((err) => { if (err.code === 404) return; throw err; }))
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.error('delete-storage partial failure:', failed.map((f) => f.reason?.message));

  return res.status(200).json({
    ok: failed.length === 0,
    deleted: results.length - failed.length,
    failed: failed.length,
    errors: failed.map((f) => f.reason?.message || 'Unknown error'),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { type } = req.body || {};
  try {
    initAdmin();
    if (type === 'storage') return await deleteStorageFiles(req, res);
    return await deleteUsers(req, res); // default — backwards-compat with existing callers
  } catch (err) {
    console.error('[delete-resources]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
