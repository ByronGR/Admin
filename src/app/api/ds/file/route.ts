import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminAuth } from '@/lib/firebase-admin';

// GET /api/ds/file?path=<storage path>   or   ?url=<firebase download url>
//
// Hands back a short-lived signed URL for a file in Supabase Storage.
//
// The bucket is private, because it holds CVs and photographs of real people
// and a public bucket would put every one of them behind a guessable URL. So
// nothing can be linked to directly: each view is signed for the person asking,
// after their Firebase token has been checked, and the link expires.
//
// Paths were preserved exactly on the way across, so a Firebase download URL
// and its Supabase object differ only by host. That is why this accepts either:
// a row still holding its original Firebase URL resolves without a lookup table.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'nearwork';
const TTL_SECONDS = 300;

async function requireStaff(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

/** The object path inside a Firebase download URL, or null if it is not one. */
export function pathFromFirebaseUrl(url: string): string | null {
  const m = /\/o\/([^?]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const raw = params.get('path') ?? params.get('url') ?? '';
  if (!raw) return NextResponse.json({ error: 'Nothing asked for' }, { status: 400 });

  const path = raw.startsWith('http') ? pathFromFirebaseUrl(raw) : raw;
  if (!path) {
    return NextResponse.json({ error: 'Not a recognisable file reference' }, { status: 400 });
  }
  // A leading slash or a .. segment would reach outside the bucket prefix.
  if (path.startsWith('/') || path.split('/').includes('..')) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'No such file' }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl, expiresIn: TTL_SECONDS });
}
