import { adminAuth } from '@/lib/firebase-admin';

// ── Vera, proxied ────────────────────────────────────────────────────────────
// Admin's screens call this; it calls Vera.
//
// Vera runs on Supabase and Admin on Firebase, so a person signed in here has no
// Vera session and never will. Rather than syncing identities between two auth
// systems — two places to revoke somebody from, one of them eventually forgotten —
// Admin verifies its own user and then calls Vera as itself, naming who it is
// acting for.
//
// The service key never reaches a browser. That is the whole reason this runs on
// the server rather than the page calling Vera directly.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERA = (process.env.VERA_API_URL || '').replace(/\/$/, '');

/** Paths Admin is allowed to reach. An open proxy to another service is an open
 *  proxy, however friendly the two services are — and Vera has endpoints that
 *  spend money. */
const ALLOWED = [
  /^console$/,
  /^credits$/,
  /^assessments$/,
  /^client-questions$/,
  /^config$/,
  /^report$/,
  /^bank$/,
  /^bank\/preview$/,
];

async function caller(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = (decoded.email ?? '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

async function forward(req: Request, path: string[]): Promise<Response> {
  if (!VERA || !process.env.N365_SERVICE_KEY) {
    return Response.json({ error: 'Vera is not configured on this deployment' }, { status: 500 });
  }

  const email = await caller(req);
  if (!email) return Response.json({ error: 'Nearwork staff only' }, { status: 403 });

  const joined = path.join('/');
  if (!ALLOWED.some((re) => re.test(joined))) {
    return Response.json({ error: `Not a permitted Vera path: ${joined}` }, { status: 403 });
  }

  const url = new URL(req.url);
  const target = `${VERA}/api/${joined}${url.search}`;

  const res = await fetch(target, {
    method: req.method,
    headers: {
      'content-type': 'application/json',
      'x-n365-service-key': process.env.N365_SERVICE_KEY,
      // Who this is for. Vera records it, so an action taken through Admin is
      // attributed to a person rather than to a shared key.
      'x-n365-user': email,
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    cache: 'no-store',
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
