/**
 * POST /api/kickoff
 *
 * Kick-off Brief management — create, save, submit for client review,
 * approve, request changes, and reopen a kick-off brief per pipeline/opening.
 *
 * Actions (sent as { action, code, ...data } in the request body):
 *   get              — fetch brief (any authenticated user)
 *   save             — save/update draft  (Nearwork staff only)
 *   submit           — submit for client review; status → submitted  (Nearwork staff only)
 *   reopen           — reopen for editing; status → draft  (Nearwork staff only)
 *   approve          — client approves; status → approved  (client only)
 *   request_changes  — client requests edits; status → changes_requested  (client only)
 *
 * Brief is keyed by pipeline/opening code in `kickoffBriefs/{code}`.
 * internalNotes field is always stripped from client responses.
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';

// ─── Firebase Admin init ───────────────────────────────────────────────────

function initAdmin() {
  if (admin.apps.length) return admin.app();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  throw new Error('Firebase Admin credentials are not configured');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function verifyToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    const err = new Error('Missing auth token');
    err.status = 401;
    throw err;
  }
  return admin.auth().verifyIdToken(token);
}

// System/meta fields that should NOT overwrite Firestore metadata
const META_FIELDS = new Set([
  'action', 'code', 'history', 'createdAt', 'updatedAt', 'submittedAt',
  'approvedAt', 'status', 'nearworkApprovedBy', 'clientApprovedBy', 'openingCode', 'orgId',
]);

// Extract only brief-content fields from the request body
function extractContent(data) {
  const content = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!META_FIELDS.has(k) && v !== undefined && v !== null && v !== '') {
      content[k] = v;
    }
  }
  return content;
}

function isoNow() {
  return new Date().toISOString();
}

// ─── Handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    initAdmin();
    const db = admin.firestore();
    const FSV = admin.firestore.FieldValue;

    const { action, code, orgId, note, ...formData } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: '"action" is required' });
    if (!code) return res.status(400).json({ ok: false, error: '"code" (pipeline/opening code) is required' });

    const decoded = await verifyToken(req);
    const callerEmail = (decoded.email || '').toLowerCase();
    const isNearwork = callerEmail.endsWith('@nearwork.co');
    const callerName = decoded.name || decoded.email || decoded.uid;

    const briefRef = db.collection('kickoffBriefs').doc(code);
    const now = FSV.serverTimestamp();

    // ── GET ────────────────────────────────────────────────────────────────
    if (action === 'get') {
      const snap = await briefRef.get();
      if (!snap.exists) return res.status(200).json({ ok: true, brief: null });
      const brief = { id: snap.id, ...snap.data() };
      if (!isNearwork) delete brief.internalNotes; // always hide from clients
      return res.status(200).json({ ok: true, brief });
    }

    // ── SAVE ───────────────────────────────────────────────────────────────
    if (action === 'save') {
      if (!isNearwork) return res.status(403).json({ ok: false, error: 'Only Nearwork staff can edit the brief' });
      const snap = await briefRef.get();
      const existing = snap.exists ? snap.data() : null;
      const currentStatus = existing?.status || 'draft';
      if (currentStatus === 'approved') {
        return res.status(400).json({ ok: false, error: 'Brief is approved — reopen it before making changes' });
      }
      const content = extractContent(formData);
      await briefRef.set({
        ...content,
        openingCode: code,
        ...(orgId ? { orgId } : {}),
        status: currentStatus,
        updatedAt: now,
        ...(!existing ? { createdAt: now } : {}),
      }, { merge: true });
      return res.status(200).json({ ok: true, action: 'saved' });
    }

    // ── SUBMIT ─────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!isNearwork) return res.status(403).json({ ok: false, error: 'Only Nearwork staff can submit the brief' });
      const snap = await briefRef.get();
      const existing = snap.exists ? snap.data() : null;
      if (existing?.status === 'approved') {
        return res.status(400).json({ ok: false, error: 'Brief is already approved — reopen it first' });
      }
      const content = extractContent(formData);
      await briefRef.set({
        ...content,
        openingCode: code,
        ...(orgId ? { orgId } : {}),
        status: 'submitted',
        submittedAt: now,
        updatedAt: now,
        nearworkApprovedBy: callerName,
        ...(!existing ? { createdAt: now } : {}),
        history: FSV.arrayUnion({
          action: 'submitted',
          by: callerName,
          byRole: 'nearwork',
          timestamp: isoNow(),
          note: 'Submitted for client review',
        }),
      }, { merge: true });
      return res.status(200).json({ ok: true, action: 'submitted' });
    }

    // ── REOPEN ─────────────────────────────────────────────────────────────
    if (action === 'reopen') {
      if (!isNearwork) return res.status(403).json({ ok: false, error: 'Only Nearwork staff can reopen the brief' });
      await briefRef.set({
        status: 'draft',
        updatedAt: now,
        history: FSV.arrayUnion({
          action: 'reopened',
          by: callerName,
          byRole: 'nearwork',
          timestamp: isoNow(),
          note: 'Reopened for editing',
        }),
      }, { merge: true });
      return res.status(200).json({ ok: true, action: 'reopened' });
    }

    // ── APPROVE (client) ───────────────────────────────────────────────────
    if (action === 'approve') {
      const snap = await briefRef.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'Brief not found — ask Nearwork to create it first' });
      const brief = snap.data();
      if (brief.status !== 'submitted') {
        return res.status(400).json({ ok: false, error: 'Brief must be in "Pending Review" status before it can be approved' });
      }
      // Verify the client belongs to the org that owns this brief
      const userSnap = await db.collection('users').doc(decoded.uid).get();
      if (!userSnap.exists) return res.status(403).json({ ok: false, error: 'User profile not found' });
      const userOrg = userSnap.data().orgId;
      if (brief.orgId && userOrg !== brief.orgId) {
        return res.status(403).json({ ok: false, error: 'You do not have access to this brief' });
      }
      const clientName = decoded.name || userSnap.data().name || decoded.email;
      await briefRef.set({
        status: 'approved',
        approvedAt: now,
        updatedAt: now,
        clientApprovedBy: clientName,
        history: FSV.arrayUnion({
          action: 'approved',
          by: clientName,
          byRole: 'client',
          timestamp: isoNow(),
          note: 'Approved by client',
        }),
      }, { merge: true });
      return res.status(200).json({ ok: true, action: 'approved' });
    }

    // ── REQUEST CHANGES (client) ───────────────────────────────────────────
    if (action === 'request_changes') {
      const snap = await briefRef.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'Brief not found' });
      const brief = snap.data();
      if (brief.status !== 'submitted') {
        return res.status(400).json({ ok: false, error: 'Brief must be in "Pending Review" status to request changes' });
      }
      const userSnap = await db.collection('users').doc(decoded.uid).get();
      if (!userSnap.exists) return res.status(403).json({ ok: false, error: 'User profile not found' });
      const userOrg = userSnap.data().orgId;
      if (brief.orgId && userOrg !== brief.orgId) {
        return res.status(403).json({ ok: false, error: 'You do not have access to this brief' });
      }
      const changeNote = String(note || '').trim();
      if (!changeNote) return res.status(400).json({ ok: false, error: 'Please describe what needs to be changed' });
      const clientName = decoded.name || userSnap.data().name || decoded.email;
      await briefRef.set({
        status: 'changes_requested',
        updatedAt: now,
        history: FSV.arrayUnion({
          action: 'changes_requested',
          by: clientName,
          byRole: 'client',
          timestamp: isoNow(),
          note: changeNote,
        }),
      }, { merge: true });
      return res.status(200).json({ ok: true, action: 'changes_requested' });
    }

    return res.status(400).json({ ok: false, error: `Unknown action: "${action}"` });

  } catch (err) {
    console.error('[kickoff]', err);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
};
