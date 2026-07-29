import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { normSlug } from '@/lib/xray';
import { FRESHPRINTS_SEED } from '@/lib/freshprints-seed';

// ─── POST /api/sourcing/import-freshprints ────────────────────────────────────
// One-time import of the FreshPrints sheet into the two openings' Sourcing tabs.
// Each lead's role ('account' / 'lifecycle') is auto-mapped to the matching Admin
// opening (by code NW-2038 / NW-7823, else by title). Deduped against whatever is
// already sourced for that opening (by LinkedIn slug AND name) — the existing
// (X-ray) row always wins. Idempotent: re-running only adds still-missing leads.
// Staff-only (@nearwork.co ID token).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const normName = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

async function requireStaff(req: Request): Promise<boolean> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  try { const d = await adminAuth().verifyIdToken(token); return typeof d.email === 'string' && d.email.toLowerCase().endsWith('@nearwork.co'); }
  catch { return false; }
}

export async function POST(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const db = adminDb();

  const opsSnap = await db.collection('openings').get();
  const ops = opsSnap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string });
  const find = (role: 'account' | 'lifecycle') => {
    const code = role === 'account' ? 'NW-2038' : 'NW-7823';
    const kw = role === 'account' ? 'account manager' : 'lifecycle';
    return ops.find(o => o.code === code) || ops.find(o => String(o.title || '').toLowerCase().includes(kw));
  };

  const result: { ok: boolean; added: number; skipped: number; byRole: Record<string, unknown>; missing: string[] } = { ok: true, added: 0, skipped: 0, byRole: {}, missing: [] };

  for (const role of ['account', 'lifecycle'] as const) {
    const op = find(role);
    if (!op) { result.missing.push(role); continue; }
    const exSnap = await db.collection('sourcedCandidates').where('openingId', '==', op.id).get();
    const seenSlug = new Set<string>(), seenName = new Set<string>();
    exSnap.docs.forEach(d => {
      const x = d.data();
      const s = normSlug(String(x.li || '').replace('/in/', '')); if (s) seenSlug.add(s);
      const n = normName(String(x.name || '')); if (n) seenName.add(n);
    });

    const leads = FRESHPRINTS_SEED.filter(l => l.role === role);
    let added = 0, skipped = 0;
    const batch = db.batch();
    const col = db.collection('sourcedCandidates');
    for (const l of leads) {
      const slug = normSlug(l.li.replace('/in/', '')); const nm = normName(l.name);
      if ((slug && seenSlug.has(slug)) || (nm && seenName.has(nm))) { skipped++; continue; }
      seenSlug.add(slug); seenName.add(nm);
      batch.set(col.doc(), {
        openingId: op.id, name: l.name, li: l.li, linkedin: l.linkedin, location: l.location, country: l.country,
        source: 'Manual', owner: l.owner || '', status: l.status, reason: l.reason || '', salary: l.salary || '',
        applied: l.status === 'Applied', last: 'from sheet', notes: l.notes || '',
        createdAt: GCFieldValue.serverTimestamp(), updatedAt: GCFieldValue.serverTimestamp(),
      });
      added++;
    }
    if (added) await batch.commit();
    result.added += added; result.skipped += skipped;
    result.byRole[role] = { opening: op.title || op.id, added, skipped };
  }

  return NextResponse.json(result);
}
