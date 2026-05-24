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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email, firstName, continueUrl } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const redirectUrl = String(continueUrl || 'https://app.nearwork.co/reset-password');

  try {
    initAdmin();

    // Generate the Firebase password reset link via Admin SDK.
    // This produces the same working link as sendPasswordResetEmail()
    // but gives us the URL so we can embed it in our branded email.
    let resetLink;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail, {
        url: redirectUrl,
        handleCodeInApp: false
      });
    } catch (err) {
      // auth/user-not-found: silently return ok so we don't leak whether the email exists
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        return res.status(200).json({ ok: true });
      }
      throw err;
    }

    // Try to look up the user's display name to personalise the email
    let resolvedFirstName = firstName;
    if (!resolvedFirstName) {
      try {
        const userRecord = await admin.auth().getUserByEmail(normalizedEmail);
        if (userRecord.displayName) {
          resolvedFirstName = userRecord.displayName.trim().split(/\s+/)[0];
        }
      } catch {
        // Not critical — fall through to default
      }
    }

    // Send the branded email via the existing send-email endpoint
    const emailApiUrl = process.env.NEARWORK_EMAIL_API_URL || 'https://admin.nearwork.co/api/send-email';
    const emailResponse = await fetch(emailApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: normalizedEmail,
        templateId: 'password_reset',
        data: {
          firstName: resolvedFirstName || 'there',
          resetLink
        }
      })
    });

    const emailResult = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) {
      throw new Error(emailResult.error || emailResult.message || 'Email send failed');
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('send-password-reset error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Password reset failed' });
  }
};
