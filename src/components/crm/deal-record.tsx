'use client';

// ============================================================
// Deal record (/deals/[id]) — HubSpot-style three columns:
// left = the deal's properties, stage and stage history; middle = the
// timeline (calls, emails, meetings, notes, tasks linked to this deal);
// right = the company, the people on the deal, and its Engagement once won.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, doc, getDoc } from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Card, CardHead, BackBar } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { useToast } from '@/components/ui/toast';
import { fmtUsd, fmtDay, fmtDayTime, dealTracking, normalizeDealStage } from '@/lib/crm';
import {
  DEAL_STAGES, DEAL_STAGE_PROBABILITY, CRM_PRIORITY_LABELS, COMPANY_STAGE_LABELS,
  type Deal, type DealStage, type Organization,
} from '@/lib/types';
import { Timeline, useTimeline, useOrgRecords } from './timeline';
import { DealModal, setStage } from './deals';
import { DealStagePill, Empty, Stat, overline, saveErrorMessage } from './ui';
import { contactHref } from '@/lib/crm';

const orgHref = (orgId: string, tab = 'overview') => `/organizations?id=${encodeURIComponent(orgId)}&tab=${tab}`;

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${NW.gray100}` }}>
      <div style={{ fontSize: 11, color: NW.gray500 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: NW.black, marginTop: 2 }}>{children}</div>
    </div>
  );
}

export default function DealRecordPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const { showToast } = useToast();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const tl = useTimeline({ kind: 'deal', dealId: id });
  const { contacts } = useOrgRecords(deal?.orgId);

  const load = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'deals', id));
      if (!snap.exists()) { setMissing(true); return; }
      const raw = { ...snap.data(), id: snap.id } as Deal;
      const d = { ...raw, stage: normalizeDealStage(raw.stage), stageHistory: raw.stageHistory?.map((h) => ({ ...h, stage: normalizeDealStage(h.stage) })) };
      setDeal(d);
      const o = await getDoc(doc(db, 'organizations', d.orgId));
      setOrg(o.exists() ? ({ ...o.data(), id: o.id } as Organization) : null);
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }, [id, showToast]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function changeStage(stage: DealStage) {
    if (!deal || stage === deal.stage) return;
    setMoving(true);
    try {
      await setStage(deal, stage);
      if (stage === 'Won') showToast('Deal won: its Engagement is open on the company page');
      await load();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    } finally {
      setMoving(false);
    }
  }

  if (missing) {
    return (
      <MainLayout>
        <BackBar label="Deals" href="/deals" />
        <Card><Empty icon="handshake" title="Deal not found" sub="It may have been deleted." /></Card>
      </MainLayout>
    );
  }
  if (!deal) {
    return <MainLayout><div style={{ fontSize: 13, color: NW.gray500, padding: 20 }}>Loading deal…</div></MainLayout>;
  }

  const tr = dealTracking(deal, tl.activities, tl.tasks);
  const people = (deal.contactIds || []).map((cid) => contacts.find((c) => c.id === cid)).filter(Boolean) as typeof contacts;
  const history = [...(deal.stageHistory || [])].sort((a, b) => b.at.localeCompare(a.at));
  const mrr = Number(deal.mrr) || 0;

  return (
    <MainLayout>
      <BackBar label="Deals" href="/deals" />
      <div className="nw-grid-3col" style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 290px', gap: 16, alignItems: 'start' }}>
        {/* ── Left: the deal ── */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card pad={18}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: NW.teal50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="handshake" size={18} color={NW.teal700} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: NW.black, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{deal.title}</div>
                <button onClick={() => router.push(orgHref(deal.orgId))} style={{ fontSize: 13, color: NW.teal600, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', marginTop: 3 }}>
                  {deal.orgName || 'Company'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 22, marginTop: 16 }}>
              <Stat label="MRR" value={fmtUsd(mrr)} color={mrr ? NW.teal700 : NW.gray400} />
              <Stat label="ARR" value={fmtUsd(mrr * 12)} color={mrr ? NW.teal700 : NW.gray400} />
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={overline}>Stage</div>
              <select
                value={deal.stage}
                disabled={moving}
                onChange={(e) => changeStage(e.target.value as DealStage)}
                style={{ marginTop: 6, width: '100%', fontSize: 13.5, padding: '9px 12px', border: `1px solid ${NW.gray200}`, borderRadius: 10, background: NW.white }}
              >
                {DEAL_STAGES.map((s) => <option key={s} value={s}>{s} ({Math.round(DEAL_STAGE_PROBABILITY[s] * 100)}%)</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)} fullWidth>Edit deal</Button>
            </div>
          </Card>

          <Card pad={18}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>About this deal</div>
            <Prop label="Deal owner">{deal.ownerName || '—'}</Prop>
            <Prop label="Close date">{deal.closeDate ? fmtDay(deal.closeDate) : '—'}</Prop>
            <Prop label="One-time value">{deal.value ? fmtUsd(deal.value) : '—'}</Prop>
            <Prop label="Deal type">{deal.dealType === 'existing' ? 'Existing business' : 'New business'}</Prop>
            <Prop label="Priority">{CRM_PRIORITY_LABELS[deal.priority ?? 'none']}</Prop>
            <Prop label="Chance of closing">{Math.round(DEAL_STAGE_PROBABILITY[deal.stage] * 100)}%</Prop>
            <Prop label="Last activity">{tr.lastActivityAt ? fmtDayTime(tr.lastActivityAt) : 'Nothing logged yet'}</Prop>
            <Prop label="Next step">
              {tr.nextTask ? tr.nextTask.title : <span style={{ color: deal.stage === 'Won' || deal.stage === 'Lost' ? NW.gray500 : '#C0392B', fontWeight: 600 }}>None set</span>}
            </Prop>
            {deal.stage === 'Lost' && <Prop label="Lost reason">{deal.lostReason || '—'}</Prop>}
            <Prop label="Created">{deal.createdBy ? `By ${deal.createdBy}` : '—'}</Prop>
          </Card>

          <Card pad={18}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Stage history</div>
            {history.length === 0 ? (
              <div style={{ fontSize: 12.5, color: NW.gray500 }}>No moves recorded yet.</div>
            ) : history.map((h, i) => (
              <div key={`${h.at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${NW.gray100}` }}>
                <DealStagePill stage={h.stage} />
                <span style={{ fontSize: 11.5, color: NW.gray500, flex: 1, textAlign: 'right' }}>{fmtDay(h.at)}{h.by ? ` · ${h.by}` : ''}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* ── Middle: timeline ── */}
        <Timeline
          scope={{ kind: 'deal', dealId: deal.id }}
          context={{ orgId: deal.orgId, orgName: deal.orgName, dealIds: [deal.id], contactIds: deal.contactIds || [] }}
          onChanged={tl.reload}
        />

        {/* ── Right: associations ── */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card pad={18}>
            <CardHead title="Company" />
            <div onClick={() => router.push(orgHref(deal.orgId))} style={{ cursor: 'pointer', border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{org?.name || deal.orgName}</div>
              <div style={{ fontSize: 12, color: NW.gray500, marginTop: 3 }}>
                {[org?.companyStage ? COMPANY_STAGE_LABELS[org.companyStage] : null, [org?.city, org?.country].filter(Boolean).join(', '), org?.website].filter(Boolean).join(' · ') || 'Open company'}
              </div>
            </div>
          </Card>
          <Card pad={18}>
            <CardHead title={`People (${people.length})`} action={<Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>} />
            {people.length === 0 ? (
              <div style={{ fontSize: 12.5, color: NW.gray500 }}>Nobody linked yet. Use Edit to add the people on this deal.</div>
            ) : people.map((c) => (
              <div key={c.id} onClick={() => router.push(contactHref(c.id))} style={{ padding: '9px 0', borderTop: `1px solid ${NW.gray100}`, cursor: 'pointer' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{c.name}</div>
                <div style={{ fontSize: 12, color: NW.gray500 }}>{[c.title, c.email].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            ))}
          </Card>
          <Card pad={18}>
            <CardHead title="Engagement" />
            {deal.engagementId ? (
              <Button variant="secondary" size="sm" iconRight="arrow-up-right" onClick={() => router.push(orgHref(deal.orgId, 'engagements'))}>Open contracts &amp; payments</Button>
            ) : (
              <div style={{ fontSize: 12.5, color: NW.gray500 }}>Opens automatically when the deal is won.</div>
            )}
          </Card>
        </div>
      </div>

      {editing && (
        <DealModal
          deal={deal}
          orgs={[{ id: deal.orgId, name: deal.orgName || '' }]}
          fixedOrg={{ id: deal.orgId, name: deal.orgName || '' }}
          onClose={() => setEditing(false)}
          onDone={(savedId) => { setEditing(false); if (savedId) load(); else router.push('/deals'); }}
        />
      )}
    </MainLayout>
  );
}
