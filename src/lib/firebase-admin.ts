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

let cachedFirestore: ReturnType<typeof getFirestore> | null = null;

export function adminDb(): ReturnType<typeof getFirestore> {
  if (cachedFirestore) return cachedFirestore;

  const audience = process.env.GCP_WIF_AUDIENCE;
  if (audience) {
    // firebase-admin v12's getFirestore() rejects any credential that is not
    // ServiceAccountCredential or ApplicationDefaultCredential (see firestore-internal.js).
    // Bypass that check by constructing @google-cloud/firestore directly with the
    // ExternalAccountClient — exactly what firebase-admin does internally, minus the gate.
    const saEmail = process.env.FIREBASE_SA_EMAIL || DEFAULT_SA_EMAIL;
    const authClient = ExternalAccountClient.fromJSON({
      type: 'external_account',
      audience,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url:
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      subject_token_supplier: {
        getSubjectToken: async () => getVercelOidcToken(),
      },
    });
    if (authClient) {
      // google-gax (used internally by @google-cloud/firestore for gRPC) expects a
      // GoogleAuth instance and calls several methods that ExternalAccountClient doesn't
      // implement. Shim each missing method so validation passes.
      const patchedClient = authClient as unknown as Record<string, unknown>;
      // getUniverseDomain — google-gax/grpc.js:312 validates we're on googleapis.com
      if (typeof patchedClient.getUniverseDomain !== 'function') {
        patchedClient.getUniverseDomain = () => Promise.resolve('googleapis.com');
      }
      // getClient — google-gax/grpc.js calls this to retrieve the underlying auth client;
      // GoogleAuth wraps the real client and returns it here. We ARE the client, so return self.
      if (typeof patchedClient.getClient !== 'function') {
        patchedClient.getClient = () => Promise.resolve(authClient);
      }
      // getProjectId — may be called to resolve the project; return the configured project.
      if (typeof patchedClient.getProjectId !== 'function') {
        patchedClient.getProjectId = () => Promise.resolve(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID);
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const GCFirestore = require('@google-cloud/firestore').Firestore;
      cachedFirestore = new GCFirestore({
        projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
        auth: authClient,
      }) as ReturnType<typeof getFirestore>;
      return cachedFirestore;
    }
  }

  cachedFirestore = getFirestore(adminApp());
  return cachedFirestore;
}
