// Exercises the real mapping and the real upsert, skipping only the HTTP and
// auth layers. Creates a test opening, edits one field, checks the edit did not
// blank the rest, then deletes it.
import { createClient } from '@supabase/supabase-js';
import { MAPPINGS, type Ctx, type Doc } from '../../src/lib/ds-mapping';
import * as fs from 'fs';

const E: Record<string, string> = {};
for (const l of fs.readFileSync('.env.migration', 'utf8').split('\n')) {
  const t = l.trim();
  if (t && !t.startsWith('#') && t.includes('=')) {
    const i = t.indexOf('='); E[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
const base = createClient(E.SUPABASE_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function idMap(table: string, schema?: string) {
  const db = schema ? base.schema(schema) : base;
  const { data } = await db.from(table).select('id, legacy_id').not('legacy_id', 'is', null).limit(5000);
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[r.legacy_id as string] = r.id as string;
  return out;
}

async function ctx(): Promise<Ctx> {
  const [orgs, openings, pipelines, candidates] = await Promise.all([
    idMap('organizations'), idMap('openings', 'n365'),
    idMap('pipelines', 'n365'), idMap('candidates', 'n365'),
  ]);
  const { data: nw } = await base.from('organizations').select('id').eq('slug', 'nearwork').maybeSingle();
  return { nearworkOrgId: (nw?.id as string) ?? null, orgs, openings, pipelines, candidates };
}

async function put(collection: string, id: string, data: Doc, merge: boolean) {
  const m = MAPPINGS[collection];
  const db = m.schema ? base.schema(m.schema) : base;
  let doc: Doc = { ...data };
  if (merge) {
    const { data: ex } = await db.from(m.table).select('raw').eq('legacy_id', id).maybeSingle();
    if (ex?.raw) doc = { ...(ex.raw as Doc), ...data };
  }
  const row = { ...m.columns(doc, await ctx()), legacy_id: id, raw: doc };
  const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
  const { error } = await db.from(m.table).upsert(clean, { onConflict: 'legacy_id' });
  if (error) throw new Error(`${collection}: ${error.message}`);
}

const CODE = 'TEST-WRITE-PATH';
(async () => {
  console.log('1. create an opening');
  await put('openings', CODE, {
    code: CODE, title: 'Write path test', status: 'draft', published: false,
    orgId: '', recruiter: 'Byron Giraldo', salaryMin: 1000, salaryMax: 2000,
    salaryCurrency: 'USD', skills: ['testing'], contract: 'Freelance',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, false);

  const read = async () => (await base.schema('n365').from('openings')
    .select('title,status,recruiter,salary_min,employment_type,skills,raw')
    .eq('legacy_id', CODE).maybeSingle()).data as Record<string, unknown> | null;

  let r = await read();
  console.log('   ->', { title: r?.title, status: r?.status, recruiter: r?.recruiter,
                         salary_min: r?.salary_min, employment_type: r?.employment_type });

  console.log('2. change ONLY the status, the way a screen would');
  await put('openings', CODE, { status: 'open' }, true);
  r = await read();
  console.log('   ->', { title: r?.title, status: r?.status, recruiter: r?.recruiter,
                         salary_min: r?.salary_min, employment_type: r?.employment_type });

  const kept = r?.title === 'Write path test' && r?.recruiter === 'Byron Giraldo'
            && Number(r?.salary_min) === 1000 && r?.employment_type === 'contract';
  console.log(kept ? '   PASS — the other fields survived the edit'
                   : '   FAIL — a one-field edit wiped other columns');

  console.log('3. delete');
  await base.schema('n365').from('openings').delete().eq('legacy_id', CODE);
  console.log('   gone:', (await read()) === null);
  process.exit(kept ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
