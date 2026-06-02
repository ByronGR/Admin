import { getApps, initializeApp, applicationDefault, cert, type App, type Credential } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/functions/oidc';

// Server-only Firebase Admin SDK. Credentials are resolved at runtime, in order:
//   1. FIREBASE_SERVICE_ACCOUNT — a service-account JSON string (only works if the
//      GCP org policy that disables key creation is lifted; not the default path).
//   2. Vercel OIDC → GCP Workload Identity Federation — no downloaded key. The org
//      policy blocks key creation, so this is the intended production path. Active
//      when GCP_WIF_AUDIENCE is set; the per-invocation OIDC token is read from the
//      Vercel request context via getVercelOidcToken() (on Fluid Compute it arrives
//      as a request header, not a process.env var).
//   3. Application Default Credentials — fallback for any environment that already
//      has ADC (e.g. Cloud Run / Functions).
// Until one of these is configured the SDK still initializes, but Auth calls throw;
// /api/send-reset catches that and returns a clear "not configured" error.

const DEFAULT_SA_EMAIL = 'firebase-adminsdk-fbsvc@nearwork-97e3c.iam.gserviceaccount.com';
const DEFAULT_PROJECT_ID = 'nearwork-97e3c';

let cachedApp: App | null = null;

// Builds a Firebase credential backed by Vercel's per-invocation OIDC token,
// exchanged through GCP STS for an impersonated service-account access token.
// No key material is ever stored; the OIDC token is read fresh on each refresh.
function vercelWifCredential(): Credential | null {
  const audience = process.env.GCP_WIF_AUDIENCE;
  if (!audience) return null;

  const saEmail = process.env.FIREBASE_SA_EMAIL || DEFAULT_SA_EMAIL;
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    subject_token_supplier: {
      // Read fresh per refresh from the active Vercel request context. On Fluid
      // Compute the token is not in process.env — getVercelOidcToken() resolves
      // it from the request-scoped header, so this is concurrency-safe.
      getSubjectToken: async () => getVercelOidcToken(),
    },
  });
  if (!client) return null;

  return {
    async getAccessToken() {
      const { token } = await client.getAccessToken();
      const expiry = client.credentials.expiry_date ?? Date.now() + 3_600_000;
      return {
        access_token: token ?? '',
        expires_in: Math.max(0, Math.floor((expiry - Date.now()) / 1000)),
      };
    },
  };
}

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

  const wif = vercelWifCredential();
  if (wif) {
    cachedApp = initializeApp({
      credential: wif,
      projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    });
    return cachedApp;
  }

  cachedApp = initializeApp({ credential: applicationDefault() });
  return cachedApp;
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}
