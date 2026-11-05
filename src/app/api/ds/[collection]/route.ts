import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminAuth } from '@/lib/firebase-admin';

// GET /api/ds/<collection>
//
// Reads a migrated collection out of Supabase, for Admin screens running with
// NEXT_PUBLIC_DATA_SOURCE=supabase.
//
// This route exists because of who the caller is. Admin's staff are signed in
// to FIREBASE, not Supabase, so a browser hitting Supabase directly arrives as
// an anonymous stranger: `anon` holds no privilege on the n365 schema and every
// policy there asks is_staff(), so the honest answer would be zero rows. Rather
// than issue staff a second identity before the auth migration has happened,
// the server verifies the Firebase token it already trusts and then reads with
// the service key.
//
// Read-only on purpose. Until cutover every write still goes to Firebase, so
// the two databases cannot drift while we are comparing them.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLES: Record<string, { table: string; schema?: string }> = {
  organizations:         { table: 'organizations' },
  openings:              { table: 'openings',               schema: 'n365' },
  pipelines:             { table: 'pipelines',              schema: 'n365' },
  sourcedCandidates:     { table: 'sourced_candidates',     schema: 'n365' },
  kickoffBriefs:         { table: 'kickoff_briefs',         schema: 'n365' },
  engagements:           { table: 'engagements',            schema: 'n365' },
  organizationDocuments: { table: 'organization_documents', schema: 'n365' },
  candidates:            { table: 'candidates',             schema: 'n365' },
  applications:          { table: 'applications',           schema: 'n365' },
  candidateActivity:     { table: 'candidate_activity',     schema: 'n365' },
  candidateNotes:        { table: 'notes',                  schema: 'n365' },
  pipeline_messages:     { table: 'messages',               schema: 'n365' },
  pipelineRequests:      { table: 'requests',               schema: 'n365' },
  notifications:         { table: 'notifications',          schema: 'n365' },
};

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ collection: string }> },
) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  const { collection } = await params;
  const target = TABLES[collection];
  if (!target) {
    return NextResponse.json({ error: `Unknown collection "${collection}"` }, { status: 404 });
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const base = createClient(url, key, { auth: { persistSession: false } });
  const db = target.schema ? base.schema(target.schema) : base;

  const { data, error } = await db
    .from(target.table)
    .select('legacy_id, raw')
    .not('legacy_id', 'is', null)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // `raw` is the untouched Firestore document, so the screens receive exactly
  // what getDocs() used to hand them. Rows without one were created by 365
  // itself and have no Firestore shape to offer.
  const rows = (data ?? [])
    .filter((r) => r.raw)
    .map((r) => {
      const raw = { ...(r.raw as Record<string, unknown>) };
      delete raw.__id;
      return { ...raw, id: r.legacy_id as string };
    });

  return NextResponse.json({ rows });
}
