import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminAuth } from '@/lib/firebase-admin';
import { MAPPINGS, type Ctx, type Doc } from '@/lib/ds-mapping';

// POST /api/ds/write
//
// Saves a Firestore-shaped document into the relational tables, for Admin
// running with NEXT_PUBLIC_DATA_SOURCE=supabase.
//
//   { collection, id?, op: 'set' | 'merge' | 'update' | 'create' | 'delete', data }
//
// Every row is keyed by legacy_id — the Firestore document id the screens
// already use in their URLs and their state. That keeps a saved record findable
// by the same id it had before, and means the import and the app write to the
// same row rather than two.
//
// 'merge' and 'update' read the stored document first and merge into it, which
// is what updateDoc() means. Doing that server-side rather than in the browser
// keeps the whole operation on one side of the network, so a screen that
// updates one field cannot blank the rest.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Op = 'set' | 'merge' | 'update' | 'create' | 'delete';

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

function client(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** legacy_id -> uuid for one table, so a document's references can be resolved. */
async function idMap(
  base: SupabaseClient,
  table: string,
  schema?: string,
): Promise<Record<string, string>> {
  const db = schema ? base.schema(schema) : base;
  const { data } = await db.from(table).select('id, legacy_id').not('legacy_id', 'is', null).limit(5000);
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[r.legacy_id as string] = r.id as string;
  return out;
}

async function context(base: SupabaseClient): Promise<Ctx> {
  const [orgs, openings, pipelines, candidates] = await Promise.all([
    idMap(base, 'organizations'),
    idMap(base, 'openings', 'n365'),
    idMap(base, 'pipelines', 'n365'),
    idMap(base, 'candidates', 'n365'),
  ]);
  const { data: nw } = await base
    .from('organizations').select('id').eq('slug', 'nearwork').maybeSingle();
  return { nearworkOrgId: (nw?.id as string) ?? null, orgs, openings, pipelines, candidates };
}

/** A Firestore-shaped id for a document the app is creating now. */
function newId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: { collection?: string; id?: string; op?: Op; data?: Doc };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 });
  }

  const { collection = '', op = 'merge', data = {} } = body;
  const mapping = MAPPINGS[collection];
  if (!mapping) {
    return NextResponse.json(
      { error: `"${collection}" cannot be written to Supabase yet` },
      { status: 404 },
    );
  }

  const base = client();
  if (!base) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const db = mapping.schema ? base.schema(mapping.schema) : base;

  const id = body.id ?? newId();

  if (op === 'delete') {
    const { error } = await db.from(mapping.table).delete().eq('legacy_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id });
  }

  // For a partial write, the stored document is the base and `data` is laid
  // over it. Mapping the merged result rather than the patch is what stops a
  // one-field update from blanking every column derived from the others.
  let doc: Doc = { ...data };
  if (op === 'merge' || op === 'update') {
    const { data: existing } = await db
      .from(mapping.table).select('raw').eq('legacy_id', id).maybeSingle();
    if (existing?.raw) doc = { ...(existing.raw as Doc), ...data };
    else if (op === 'update') {
      return NextResponse.json({ error: 'No such record' }, { status: 404 });
    }
  }

  const ctx = await context(base);
  const row = {
    ...mapping.columns(doc, ctx),
    legacy_id: id,
    raw: doc,
  };

  // Drop nulls so a column default applies instead of an explicit null, which
  // a NOT NULL column rejects even when it has one.
  const clean = Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== null && v !== undefined),
  );

  const { error } = await db
    .from(mapping.table)
    .upsert(clean, { onConflict: 'legacy_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
