const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';

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

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, stripUndefined(item)]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  try {
    initAdmin();
    const db = admin.firestore();
    const { type, action = 'set', assessment, item, id } = req.body || {};
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (type === 'assessment') {
      if (!assessment?.id) return res.status(400).json({ ok:false, error:'Missing assessment id' });
      await db.collection('assessments').doc(assessment.id).set(stripUndefined({
        ...assessment,
        assessmentUrl: assessment.assessmentUrl || `https://talent.nearwork.co/assessment/${assessment.id}/start`,
        updatedAt: now,
        createdAt: assessment.createdAt || now
      }), { merge:true });
      return res.status(200).json({ ok:true });
    }

  if (type === 'question') {
      if (action === 'bulkSet') {
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ ok:false, error:'Missing question items' });
        for (let i = 0; i < items.length; i += 450) {
          const batch = db.batch();
          items.slice(i, i + 450).forEach((question) => {
            if (!question?.id) return;
            batch.set(db.collection('assessmentQuestionBank').doc(question.id), stripUndefined({
              ...question,
              updatedAt: now,
              createdAt: question.createdAt || now
            }), { merge:true });
          });
          await batch.commit();
        }
        return res.status(200).json({ ok:true, count:items.length });
      }
      if (action === 'delete') {
        if (!id) return res.status(400).json({ ok:false, error:'Missing question id' });
        await db.collection('assessmentQuestionBank').doc(id).delete();
        return res.status(200).json({ ok:true });
      }
      if (!item?.id) return res.status(400).json({ ok:false, error:'Missing question item' });
      await db.collection('assessmentQuestionBank').doc(item.id).set(stripUndefined({
        ...item,
        updatedAt: now,
        createdAt: item.createdAt || now
      }), { merge:true });
      return res.status(200).json({ ok:true });
    }

    return res.status(400).json({ ok:false, error:'Unknown sync type' });
  } catch (error) {
    console.error('sync-assessment-data error:', error);
    return res.status(500).json({ ok:false, error:error.message || 'Sync failed' });
  }
};
