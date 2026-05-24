const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';
const HARDCODED_ADMINS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];

function initAdmin() {
  if (admin.apps.length) return admin.app();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
    });
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  }
  throw new Error('Firebase Admin credentials are not configured');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return res.status(401).json({ ok: false, error: 'Missing auth token' });

  try {
    const adminApp = initAdmin();
    const authAdmin = admin.auth(adminApp);

    // Verify the caller's token and check they are a Nearwork admin
    const decoded = await authAdmin.verifyIdToken(idToken);
    const callerEmail = (decoded.email || '').toLowerCase();
    const isNearworkAdmin = callerEmail.endsWith('@nearwork.co') || HARDCODED_ADMINS.includes(callerEmail);
    if (!isNearworkAdmin) {
      return res.status(403).json({ ok: false, error: 'Forbidden: caller is not a Nearwork admin' });
    }

    const { uids = [] } = req.body || {};
    if (!Array.isArray(uids) || !uids.length) {
      return res.status(200).json({ ok: true, deleted: 0 });
    }

    // Firebase deleteUsers supports up to 1000 per call; batch just in case
    let deleted = 0;
    let errors = [];
    for (let i = 0; i < uids.length; i += 100) {
      const batch = uids.slice(i, i + 100);
      const result = await authAdmin.deleteUsers(batch);
      deleted += result.successCount;
      result.errors.forEach(e => errors.push({ uid: e.index, reason: e.error.message }));
    }

    return res.status(200).json({ ok: true, deleted, errors });
  } catch (err) {
    console.error('[delete-org-users]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
