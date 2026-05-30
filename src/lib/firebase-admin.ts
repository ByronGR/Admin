import { getApps, initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Server-only Firebase Admin SDK. Credentials are resolved at runtime, in order:
//   1. FIREBASE_SERVICE_ACCOUNT — a service-account JSON string (only works if the
//      GCP org policy that disables key creation is lifted; not the default path).
//   2. Application Default Credentials — what Workload Identity Federation provides
//      on Vercel (no downloaded key). This is the intended production path.
// Until one of these is configured the SDK still initializes, but Auth calls throw;
// /api/send-reset catches that and returns a clear "not configured" error.

let cachedApp: App | null = null;

function adminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    cachedApp = initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Vercel stores the key with literal "\n"; normalize to real newlines.
        privateKey: parsed.private_key?.replace(/\\n/g, '\n'),
      }),
    });
    return cachedApp;
  }

  cachedApp = initializeApp({ credential: applicationDefault() });
  return cachedApp;
}

export function adminAuth() {
  return getAuth(adminApp());
}
