import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { Candidate } from '@/lib/types';

// ── GET /api/cv-file/[id] ─────────────────────────────────────────────────────
// Streams a candidate's CV through our own origin so it can be shown in an
// iframe next to the extracted profile.
//
// Why proxy instead of pointing the iframe at the storage URL:
//   • Our CSP allows framing 'self' only — Firebase Storage isn't in frame-src,
//     and widening it would be a security change for one review screen.
//   • The signed storage URL (and its token) never reaches the browser.
//
// Auth note: <iframe> can't carry an Authorization header, so this relies on the
// Firebase session cookie/ID token in the query. Staff-only either way.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get('t') || '';

  let email = '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    email = String(decoded.email || '').toLowerCase();
  } catch {
    return new Response('Not authorized', { status: 401 });
  }
  if (!email.endsWith('@nearwork.co')) return new Response('Staff only', { status: 403 });

  const snap = await adminDb().collection('candidates').doc(id).get();
  if (!snap.exists) return new Response('Not found', { status: 404 });

  const c = snap.data() as Candidate;
  const url = c.resumeUrl || c.cvUrl;
  if (!url) return new Response('No CV on file', { status: 404 });

  const upstream = await fetch(url);
  if (!upstream.ok) return new Response('Could not fetch the CV', { status: 502 });

  const type = upstream.headers.get('content-type') || 'application/pdf';
  return new Response(upstream.body, {
    headers: {
      'content-type': type,
      // Render in place rather than prompting a download.
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=300',
    },
  });
}
