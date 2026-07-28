import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';

// ─── GET /api/hubspot-deals?q=<text> ──────────────────────────────────────────
// Searches HubSpot deals by name (full-text) and returns each deal's REAL stage
// (from its HubSpot pipeline, including won/lost) plus the ordered pipeline stages
// so the Engagements UI can draw a faithful stage tracker. Read-only.
//
// Staff-only: requires a valid Firebase ID token (Authorization: Bearer …) from a
// @nearwork.co account. Uses the same HUBSPOT_ACCESS_TOKEN as /api/hs (scopes:
// crm.objects.deals.read, crm.objects.owners.read, crm.schemas.deals.read).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HS = 'https://api.hubapi.com';

type StageType = 'open' | 'won' | 'lost';
type PipelineStage = { id: string; label: string; type: StageType; order: number };

function stageType(meta: { isClosed?: string; probability?: string } | undefined): StageType {
  const closed = meta?.isClosed === 'true';
  const prob = parseFloat(meta?.probability ?? '');
  if (closed && prob === 0) return 'lost';
  if (closed && prob === 1) return 'won';
  return 'open';
}

function fmtCloseDate(raw: string | undefined): string {
  if (!raw) return '';
  const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function requireStaff(req: Request): Promise<boolean> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return typeof decoded.email === 'string' && decoded.email.toLowerCase().endsWith('@nearwork.co');
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ ok: false, reason: 'unauthorized', deals: [] }, { status: 401 });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, reason: 'not_configured', deals: [] });

  const q = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (q.length < 2) return NextResponse.json({ ok: true, deals: [] });

  try {
    const searchRes = await fetch(`${HS}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        properties: ['dealname', 'amount', 'dealstage', 'closedate', 'hubspot_owner_id', 'pipeline'],
        limit: 8,
      }),
    });
    const data = await searchRes.json();
    if (!searchRes.ok) {
      const missingScope = searchRes.status === 403;
      return NextResponse.json({ ok: false, reason: missingScope ? 'missing_scope' : 'search_failed', message: data?.message || '', deals: [] });
    }

    type HsDeal = { id: string; properties: Record<string, string | undefined> };
    const results: HsDeal[] = data.results || [];

    // Owners.
    const ownerIds = [...new Set(results.map((r) => r.properties?.hubspot_owner_id).filter(Boolean))] as string[];
    const ownerMap: Record<string, string> = {};
    await Promise.all(
      ownerIds.map(async (id) => {
        const r = await fetch(`${HS}/crm/v3/owners/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) { const o = await r.json(); ownerMap[id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || ''; }
      })
    );

    // Pipelines → ordered stages (with won/lost type).
    const pipelineStages: Record<string, PipelineStage[]> = {};
    const stageIndex: Record<string, PipelineStage> = {};
    const pRes = await fetch(`${HS}/crm/v3/pipelines/deals`, { headers: { Authorization: `Bearer ${token}` } });
    if (pRes.ok) {
      const p = await pRes.json();
      (p.results || []).forEach((pl: { id: string; stages?: { id: string; label: string; displayOrder: number; metadata?: { isClosed?: string; probability?: string } }[] }) => {
        const stages: PipelineStage[] = (pl.stages || [])
          .map((st) => ({ id: st.id, label: st.label, type: stageType(st.metadata), order: st.displayOrder }))
          .sort((a, b) => a.order - b.order);
        pipelineStages[pl.id] = stages;
        stages.forEach((s) => { stageIndex[s.id] = s; });
      });
    }

    const deals = results.map((r) => {
      const p = r.properties || {};
      const stages = (p.pipeline && pipelineStages[p.pipeline]) || [];
      const current = (p.dealstage && stageIndex[p.dealstage]) || undefined;
      return {
        id: r.id,
        title: p.dealname || '(untitled deal)',
        value: p.amount ? Math.round(Number(p.amount)) : 0,
        ownerName: (p.hubspot_owner_id && ownerMap[p.hubspot_owner_id]) || '',
        closeDate: fmtCloseDate(p.closedate),
        stageLabel: current?.label || '',
        stageType: current?.type || 'open',
        stages: stages.map((s) => ({ label: s.label, type: s.type, current: s.id === p.dealstage })),
      };
    });

    return NextResponse.json({ ok: true, deals });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'error', message: (err as Error).message, deals: [] });
  }
}
