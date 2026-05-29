const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';

function initAdmin() {
  if (admin.apps.length) return admin.app();

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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

function normalizeWords(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function toList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeSkill(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function skillOverlap(candidate, opening) {
  const openingSkills = new Set(toList(opening.skills || opening.requiredSkills || opening.tools)
    .map(normalizeSkill)
    .filter(Boolean));
  const candidateSkills = toList(candidate.skills)
    .map(normalizeSkill)
    .filter(Boolean);
  const matches = [...new Set(candidateSkills.filter((skill) => openingSkills.has(skill)))];
  return { matches, count: matches.length };
}

function firstName(candidate) {
  return String(candidate.firstName || candidate.name || 'there').trim().split(/\s+/)[0] || 'there';
}

function candidateAllowsEmail(candidate, prefDoc) {
  const prefs = {
    ...(candidate.notificationPreferences || {}),
    ...((prefDoc && prefDoc.preferences) || {})
  };
  const jobPref = prefs.jobAlerts || prefs.openingMovement || prefs.recruitmentUpdates || {};
  return jobPref.email !== false;
}

function matchScore(candidate, opening) {
  const openingSkills = normalizeWords(toList(opening.skills || opening.requiredSkills || opening.tools).join(' '));
  const openingText = normalizeWords([
    opening.title,
    opening.role,
    opening.roleLibraryRole,
    opening.roleLibraryDepartment,
    opening.industry,
    opening.content_skills,
    opening.content_qualifications
  ].join(' '));
  const candidateSkills = normalizeWords(toList(candidate.skills).join(' '));
  const candidateText = normalizeWords([
    candidate.role,
    candidate.targetRole,
    candidate.headline,
    candidate.summary,
    candidate.notes,
    candidate.english
  ].join(' '));
  const openingSet = new Set([...openingSkills, ...openingText]);
  const candidateSet = new Set([...candidateSkills, ...candidateText]);
  let score = 0;
  candidateSet.forEach((word) => {
    if (openingSet.has(word)) score += openingSkills.includes(word) ? 3 : 1;
  });
  return score;
}

async function sendEmail({ to, firstNameValue, roleTitle, openingCode }) {
  const endpoint = process.env.NEARWORK_EMAIL_API_URL || 'https://admin.nearwork.co/api/send-email';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      templateId: 'job_alert',
      data: {
        firstName: firstNameValue,
        roleTitle,
        openingCode,
        jobUrl: `https://jobs.nearwork.co/apply?code=${encodeURIComponent(openingCode)}`
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Email API failed');
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    const openingInput = req.body?.opening || {};
    const openingCode = String(req.body?.openingCode || openingInput.code || openingInput.id || '').trim();
    if (!openingCode) return res.status(400).json({ ok: false, error: 'openingCode is required' });

    const openingSnap = await db.collection('openings').doc(openingCode).get();
    const opening = openingSnap.exists ? { id: openingSnap.id, ...openingSnap.data(), ...openingInput } : openingInput;
    if (!opening.published) return res.status(200).json({ ok: true, skipped: true, reason: 'Opening is not published' });
    if (opening.jobAlertSentAt && !req.body?.force) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Role alert already sent for this opening' });
    }

    const prefSnaps = await db.collection('notificationPreferences').where('app', '==', 'talent.nearwork.co').limit(500).get();
    const prefsByUid = new Map(prefSnaps.docs.map((doc) => [doc.id, doc.data() || {}]));
    const userSnaps = await db.collection('users').where('role', '==', 'candidate').limit(500).get();
    const candidateSnaps = await db.collection('candidates').limit(500).get();
    const byEmail = new Map();
    [...userSnaps.docs, ...candidateSnaps.docs].forEach((doc) => {
      const data = { id: doc.id, ...doc.data() };
      const email = String(data.email || '').trim().toLowerCase();
      if (!email) return;
      byEmail.set(email, { ...(byEmail.get(email) || {}), ...data });
    });

    const roleTitle = opening.title || opening.role || opening.roleLibraryRole || openingCode;
    const sent = [];
    const skipped = [];
    for (const candidate of byEmail.values()) {
      const email = String(candidate.email || '').trim().toLowerCase();
      const prefDoc = prefsByUid.get(candidate.uid) || prefsByUid.get(candidate.ownerUid) || prefsByUid.get(candidate.id);
      const overlap = skillOverlap(candidate, opening);
      if (!candidateAllowsEmail(candidate, prefDoc)) {
        skipped.push({ email, reason: 'email preference off' });
        continue;
      }
      if (overlap.count < 3) {
        skipped.push({ email, reason: 'fewer than 3 matching skills', matchingSkills: overlap.matches });
        continue;
      }
      try {
        await sendEmail({ to: email, firstNameValue: firstName(candidate), roleTitle, openingCode });
        sent.push({ email, matchingSkills: overlap.matches, matchingSkillCount: overlap.count });
        await db.collection('notifications').add({
          recipientUid: candidate.uid || candidate.ownerUid || candidate.id || '',
          recipientEmail: email,
          title: 'A matching role just opened',
          message: `${roleTitle} matches ${overlap.count} of your skills.`,
          channel: 'job_alert',
          openingCode,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => null);
      } catch (error) {
        skipped.push({ email, reason: error.message });
      }
    }

    await db.collection('openings').doc(openingCode).set({
      jobAlertSentAt: admin.firestore.FieldValue.serverTimestamp(),
      jobAlertSentCount: sent.length,
      jobAlertSkippedCount: skipped.length
    }, { merge: true });

    return res.status(200).json({ ok: true, sentCount: sent.length, skippedCount: skipped.length, sent, skipped });
  } catch (error) {
    console.error('send-role-alerts error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Role alert failed' });
  }
}
