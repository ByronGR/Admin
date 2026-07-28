import { NextResponse } from 'next/server';

// ─── GET /api/hubspot-deals?q=<text> ──────────────────────────────────────────
// Searches HubSpot deals by name (full-text) and returns the fields the
// Engagements "New engagement" form needs, so staff pick a deal instead of
// typing an ID. Read-only. Uses the same HUBSPOT_ACCESS_TOKEN as /api/hs
// (needs scopes: crm.objects.deals.read, crm.objects.owners.read,
// crm.schemas.deals.read; companies.read is used later for org matching).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HS = 'https://api.hubapi.com';

// Map a HubSpot deal-stage label onto our four engagement stages.
function mapStage(label: string): 'Qualified' | 'Proposal' | 'Contract sent' | 'Closed won' {
  const s = (label || '').toLowerCase();
  if (s.includes('won')) return 'Closed won';
  if (s.includes('contract') || s.includes('sent') || s.includes('sign')) return 'Contract sent';
  if (s.includes('proposal') || s.includes('presentation') || s.includes('decision') || s.includes('negotiat') || s.includes('quote')) return 'Proposal';
  return 'Qualified';
}

function fmtCloseDate(raw: string | undefined): string {
  if (!raw) return '';
  const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function GET(req: Request) {
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
        properties: ['dealname', 'amount', 'dealstage', 'closedate', 'hubspot_owner_id'],
        limit: 8,
      }),
    });
    const data = await searchRes.json();
    if (!searchRes.ok) {
      // Most likely a missing scope on the token — surface it so the UI can explain.
      const missingScope = searchRes.status === 403;
      return NextResponse.json({ ok: false, reason: missingScope ? 'missing_scope' : 'search_failed', message: data?.message || '', deals: [] });
    }

    type HsDeal = { id: string; properties: Record<string, string | undefined> };
    const results: HsDeal[] = data.results || [];

    // Resolve owner names.
    const ownerIds = [...new Set(results.map((r) => r.properties?.hubspot_owner_id).filter(Boolean))] as string[];
    const ownerMap: Record<string, string> = {};
    await Promise.all(
      ownerIds.map(async (id) => {
        const r = await fetch(`${HS}/crm/v3/owners/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const o = await r.json();
          ownerMap[id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || '';
        }
      })
    );

    // Resolve deal-stage id → label (fetch the deal pipelines once).
    const stageLabel: Record<string, string> = {};
    const pRes = await fetch(`${HS}/crm/v3/pipelines/deals`, { headers: { Authorization: `Bearer ${token}` } });
    if (pRes.ok) {
      const p = await pRes.json();
      (p.results || []).forEach((pl: { stages?: { id: string; label: string }[] }) =>
        (pl.stages || []).forEach((st) => { stageLabel[st.id] = st.label; })
      );
    }

    const deals = results.map((r) => {
      const p = r.properties || {};
      const label = stageLabel[p.dealstage || ''] || p.dealstage || '';
      return {
        id: r.id,
        title: p.dealname || '(untitled deal)',
        value: p.amount ? Math.round(Number(p.amount)) : 0,
        ownerName: (p.hubspot_owner_id && ownerMap[p.hubspot_owner_id]) || '',
        stage: mapStage(label),
        stageLabel: label,
        closeDate: fmtCloseDate(p.closedate),
      };
    });

    return NextResponse.json({ ok: true, deals });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'error', message: (err as Error).message, deals: [] });
  }
}
