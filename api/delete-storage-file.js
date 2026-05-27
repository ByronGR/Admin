const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;

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

/**
 * DELETE /api/delete-storage-file
 *
 * Body: { path: "cvs/CAND-XXXXX/cv-12345.pdf" }
 *   or  { paths: ["cvs/CAND-A/cv-1.pdf", "cvs/CAND-B/cv-2.pdf"] }
 *
 * Returns: { ok: true, deleted: number }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const bucket = admin.storage().bucket();

    const { path, paths } = req.body || {};
    const filePaths = paths || (path ? [path] : []);

    if (!filePaths.length) {
      return res.status(400).json({ ok: false, error: 'Provide path or paths in the request body' });
    }

    // Validate paths — only allow known prefixes to prevent accidental wide deletions
    const ALLOWED_PREFIXES = ['cvs/', 'candidate-cvs/', 'candidate-photos/', 'org-assets/', 'assessment-files/'];
    const invalid = filePaths.filter((p) => !ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix)));
    if (invalid.length) {
      return res.status(400).json({ ok: false, error: `Paths not in allowed prefix list: ${invalid.join(', ')}` });
    }

    const results = await Promise.allSettled(
      filePaths.map((p) => bucket.file(p).delete().catch((err) => {
        // Ignore 404 — file already gone
        if (err.code === 404) return;
        throw err;
      }))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    const deleted = results.length - failed.length;

    if (failed.length) {
      console.error('delete-storage-file partial failure:', failed.map((f) => (f as PromiseRejectedResult).reason?.message));
    }

    return res.status(200).json({
      ok: failed.length === 0,
      deleted,
      failed: failed.length,
      errors: failed.map((f) => (f as PromiseRejectedResult).reason?.message || 'Unknown error'),
    });
  } catch (error) {
    console.error('delete-storage-file error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Could not delete file(s)' });
  }
};
