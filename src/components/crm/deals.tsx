'use client';

// ============================================================
// Deals — every deal in one place (board or list), plus the per-company Deals
// tab. Stages: Prospect → Meeting booked → Proposal → Contract sent → Client / Lost.
// Moving a deal to Client opens its Engagement (contracts, openings, payments)
// and marks the company a client. Firestore: deals.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { PageHeader, Card, CardHead, SegTabs, Table, Th, Td, TableRow } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { Modal } from '@/components/ui/modal';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useToast } from '@/components/ui/toast';
import { actorEmail, actorName, fmtUsd, DEAL_STAGE_STYLE } from '@/lib/crm';
import { DEAL_STAGES, type Deal, type DealStage, type Organization } from '@/lib/types';
import { crmField, Field, DealStagePill, Empty, Stat, saveErrorMessage } from './ui';
import { useStaff } from './use-staff';

const OPEN_STAGES: DealStage[] = ['Prospect', 'Meeting booked', 'Proposal', 'Contract sent'];
const orgLink = (orgId: string) => `/organizations?id=${encodeURIComponent(orgId)}&tab=deals`;

export function useDeals(orgId?: string) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const q = orgId ? query(collection(db, 'deals'), where('orgId', '==', orgId)) : collection(db, 'deals');
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Deal);
      list.sort((a, b) => (a.closeDate || '9999').localeCompare(b.closeDate || '9999'));
      setDeals(list);
    } catch (e) {
      console.error('[deals] load failed', e);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  // Load from Firestore on mount and when the company changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { deals, setDeals, loading, reload };
}

// Winning a deal: open its Engagement (once) and mark the company a client.
async function onWon(deal: Deal): Promise<string | undefined> {
  let engagementId = deal.engagementId;
  if (!engagementId) {
    const ref = await addDoc(collection(db, 'engagements'), {
      orgId: deal.orgId, orgName: deal.orgName || null, title: deal.title, stage: 'Closed won',
      value: deal.value || 0, currency: 'USD', ownerName: deal.ownerName || null,
      closeDate: deal.closeDate || null, openingCodes: [], dealId: deal.id,
      createdAt: serverTimestamp(), createdBy: actorName(),
    });
    engagementId = ref.id;
  }
  await updateDoc(doc(db, 'organizations', deal.orgId), { companyStage: 'client', updatedAt: serverTimestamp() });
  return engagementId;
}

async function setStage(deal: Deal, stage: DealStage): Promise<Partial<Deal>> {
  const patch: Record<string, unknown> = { stage, stageChangedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  if (stage === 'Client') patch.engagementId = await onWon({ ...deal, stage });
  await updateDoc(doc(db, 'deals', deal.id), patch);
  return { stage, engagementId: patch.engagementId as string | undefined };
}

// ── Deal card (board) ─────────────────────────────────────────────────────────
function DealCard({ deal, onOpen, dragging }: { deal: Deal; onOpen: () => void; dragging?: boolean }) {
  return (
    <div
      onClick={onOpen}
      style={{
        background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12, cursor: 'grab',
        boxShadow: dragging ? '0 10px 24px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black, lineHeight: 1.3 }}>{deal.orgName || 'Unknown company'}</div>
      <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>{deal.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12 }}>
        {deal.mrr ? <span style={{ fontWeight: 600, color: NW.teal700 }}>{fmtUsd(deal.mrr)}/mo</span> : null}
        {deal.value ? <span style={{ color: NW.gray700 }}>{fmtUsd(deal.value)}</span> : null}
        <div style={{ flex: 1 }} />
        {deal.closeDate && <span style={{ color: NW.gray500 }}>{deal.closeDate.slice(5)}</span>}
      </div>
      {deal.ownerName && <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 6 }}>{deal.ownerName}</div>}
    </div>
  );
}

function DraggableDeal({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 10 : undefined, position: 'relative', opacity: isDragging ? 0.9 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <DealCard deal={deal} onOpen={onOpen} dragging={isDragging} />
    </div>
  );
}

function StageColumn({ stage, deals, onOpen }: { stage: DealStage; deals: Deal[]; onOpen: (d: Deal) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const s = DEAL_STAGE_STYLE[stage];
  const mrr = deals.reduce((n, d) => n + (Number(d.mrr) || 0), 0);
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 230, flex: '1 0 230px', background: isOver ? NW.teal50 : NW.gray50, borderRadius: 14,
        padding: 10, border: `1px solid ${isOver ? NW.teal500 : 'transparent'}`, transition: 'background 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 10px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fg }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{stage}</span>
        <span style={{ fontSize: 12, color: NW.gray500 }}>{deals.length}</span>
        <div style={{ flex: 1 }} />
        {mrr > 0 && <span style={{ fontSize: 11.5, color: NW.teal700, fontWeight: 600 }}>{fmtUsd(mrr)}/mo</span>}
      </div>
      <div style={{ display: 'grid', gap: 8, minHeight: 60 }}>
        {deals.map((d) => <DraggableDeal key={d.id} deal={d} onOpen={() => onOpen(d)} />)}
      </div>
    </div>
  );
}

function DealsBoard({ deals, onOpen, onMove }: { deals: Deal[]; onOpen: (d: Deal) => void; onMove: (d: Deal, s: DealStage) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function handleDragEnd(e: DragEndEvent) {
    const deal = deals.find((d) => d.id === e.active.id);
    const stage = e.over?.id as DealStage | undefined;
    if (deal && stage && stage !== deal.stage) onMove(deal, stage);
  }
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {DEAL_STAGES.map((s) => <StageColumn key={s} stage={s} deals={deals.filter((d) => d.stage === s)} onOpen={onOpen} />)}
      </div>
    </DndContext>
  );
}

function DealsTable({ deals, onOpen, showCompany = true }: { deals: Deal[]; onOpen: (d: Deal) => void; showCompany?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          {showCompany && <Th>Company</Th>}
          <Th>Deal</Th><Th>Stage</Th><Th align="right">MRR</Th><Th align="right">One-time</Th><Th>Owner</Th><Th>Close date</Th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => (
          <TableRow key={d.id} onClick={() => onOpen(d)}>
            {showCompany && <Td><span style={{ fontWeight: 600 }}>{d.orgName || '—'}</span></Td>}
            <Td>{d.title}</Td>
            <Td><DealStagePill stage={d.stage} /></Td>
            <Td align="right">{d.mrr ? fmtUsd(d.mrr) : '—'}</Td>
            <Td align="right">{d.value ? fmtUsd(d.value) : '—'}</Td>
            <Td>{d.ownerName || '—'}</Td>
            <Td>{d.closeDate || '—'}</Td>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

// ── Create / edit ─────────────────────────────────────────────────────────────
function DealModal({
  deal, orgs, fixedOrg, onClose, onDone,
}: {
  deal: Deal | null;
  orgs: Pick<Organization, 'id' | 'name'>[];
  fixedOrg?: Pick<Organization, 'id' | 'name'>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const staff = useStaff();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [f, setF] = useState({
    orgId: deal?.orgId ?? fixedOrg?.id ?? '',
    title: deal?.title ?? '',
    stage: (deal?.stage ?? 'Prospect') as DealStage,
    mrr: deal?.mrr ? String(deal.mrr) : '',
    value: deal?.value ? String(deal.value) : '',
    ownerEmail: deal?.ownerEmail ?? actorEmail(),
    closeDate: deal?.closeDate ?? '',
    lostReason: deal?.lostReason ?? '',
  });
  const num = (s: string) => { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };

  async function save() {
    const org = fixedOrg && fixedOrg.id === f.orgId ? fixedOrg : orgs.find((o) => o.id === f.orgId);
    if (!org) { showToast('Pick a company', 'error'); return; }
    if (!f.title.trim()) { showToast('Name the deal', 'error'); return; }
    setSaving(true);
    const owner = staff.find((s) => s.email === f.ownerEmail);
    const data = {
      orgId: org.id, orgName: org.name, title: f.title.trim(), mrr: num(f.mrr), value: num(f.value),
      ownerEmail: f.ownerEmail || null,
      ownerName: owner?.name || (f.ownerEmail === actorEmail() ? actorName() : deal?.ownerName || null),
      closeDate: f.closeDate || null, lostReason: f.stage === 'Lost' ? f.lostReason.trim() || null : null,
    };
    try {
      if (deal) {
        await updateDoc(doc(db, 'deals', deal.id), { ...data, updatedAt: serverTimestamp() });
        if (f.stage !== deal.stage) await setStage({ ...deal, ...data } as Deal, f.stage);
      } else {
        const ref = await addDoc(collection(db, 'deals'), {
          ...data, stage: f.stage, source: 'manual', createdAt: serverTimestamp(), createdBy: actorName(),
          stageChangedAt: serverTimestamp(),
        });
        if (f.stage === 'Client') await setStage({ ...data, id: ref.id, stage: 'Prospect' } as Deal, 'Client');
      }
      if (f.stage === 'Client' && deal?.stage !== 'Client') showToast('Deal won: its Engagement is open on the company page');
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!deal) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'deals', deal.id));
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={deal ? 'Edit deal' : 'New deal'} size="lg">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Company" span>
          {fixedOrg ? (
            <div style={{ ...crmField, background: NW.gray50 }}>{fixedOrg.name}</div>
          ) : (
            <select style={crmField} value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value })}>
              <option value="">Pick a company…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Deal name" span><input style={crmField} value={f.title} placeholder="Finance team, 3 hires" autoFocus={!deal} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Stage">
          <select style={crmField} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as DealStage })}>
            {DEAL_STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <select style={crmField} value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })}>
            {!staff.some((s) => s.email === f.ownerEmail) && f.ownerEmail && <option value={f.ownerEmail}>{deal?.ownerName || 'Me'}</option>}
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Expected MRR (USD/month)"><input style={crmField} value={f.mrr} inputMode="decimal" placeholder="7000" onChange={(e) => setF({ ...f, mrr: e.target.value })} /></Field>
        <Field label="One-time value (USD)"><input style={crmField} value={f.value} inputMode="decimal" placeholder="0" onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Expected close date"><input style={crmField} type="date" value={f.closeDate} onChange={(e) => setF({ ...f, closeDate: e.target.value })} /></Field>
        {f.stage === 'Lost' && <Field label="Why was it lost?"><input style={crmField} value={f.lostReason} placeholder="Went with an in-house hire" onChange={(e) => setF({ ...f, lostReason: e.target.value })} /></Field>}
      </div>
      {f.stage === 'Client' && !deal?.engagementId && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: NW.teal700, background: NW.teal50, borderRadius: 10, padding: '9px 12px', marginTop: 14 }}>
          <Icon name="info" size={14} color={NW.teal700} />
          Saving as Client opens an Engagement for this deal and marks the company a client.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {deal && <HoldToDelete onConfirm={remove} busy={deleting} size="sm" label="Hold to delete" />}
        {deal && !fixedOrg && <Button variant="ghost" size="sm" iconRight="arrow-up-right" onClick={() => { window.location.href = orgLink(deal.orgId); }}>Open company</Button>}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

// ── /deals ────────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const { showToast } = useToast();
  const { deals, setDeals, loading, reload } = useDeals();
  const [orgs, setOrgs] = useState<Pick<Organization, 'id' | 'name'>[]>([]);
  const [view, setViewState] = useState<'board' | 'list'>('board');
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState<Deal | 'new' | null>(null);

  useEffect(() => {
    // Restore the saved view after mount (localStorage isn't available during prerender).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = localStorage.getItem('nw_admin_dealview'); if (v === 'board' || v === 'list') setViewState(v); } catch {}
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || '' })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => null);
  }, []);
  const setView = (v: 'board' | 'list') => { setViewState(v); try { localStorage.setItem('nw_admin_dealview', v); } catch {} };

  const shown = useMemo(() => (mine ? deals.filter((d) => d.ownerEmail === actorEmail()) : deals), [deals, mine]);
  const open = shown.filter((d) => OPEN_STAGES.includes(d.stage));
  const openMrr = open.reduce((n, d) => n + (Number(d.mrr) || 0), 0);
  const openValue = open.reduce((n, d) => n + (Number(d.value) || 0), 0);
  const won = shown.filter((d) => d.stage === 'Client');
  const decided = won.length + shown.filter((d) => d.stage === 'Lost').length;

  async function move(deal: Deal, stage: DealStage) {
    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, stage } : d)));
    try {
      await setStage(deal, stage);
      if (stage === 'Client') showToast(`${deal.orgName} won: its Engagement is open`);
      reload();
    } catch (e) {
      setDeals(prev);
      showToast(saveErrorMessage(e), 'error');
    }
  }

  return (
    <MainLayout>
      <PageHeader
        overline="Sales"
        title="Deals"
        subtitle="Every deal from first meeting to signed client. Drag a card to move it."
        actions={<Button icon="plus" onClick={() => setEditing('new')}>New deal</Button>}
      />
      <Card pad={18} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Stat label="Open deals" value={open.length} />
          <Stat label="Open pipeline MRR" value={fmtUsd(openMrr)} color={NW.teal700} sub={`${fmtUsd(openMrr * 12)} ARR if all close`} />
          <Stat label="Open one-time value" value={fmtUsd(openValue)} />
          <Stat label="Win rate" value={decided ? `${Math.round((won.length / decided) * 100)}%` : '—'} sub={`${won.length} won of ${decided} decided`} />
        </div>
      </Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <SegTabs tabs={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List', count: shown.length }]} active={view} onChange={setView} />
        <SegTabs tabs={[{ id: 'all', label: 'All deals' }, { id: 'mine', label: 'My deals' }]} active={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} />
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: NW.gray500, padding: 20 }}>Loading deals…</div>
      ) : deals.length === 0 ? (
        <Card><Empty icon="handshake" title="No deals yet" sub="Create the first one, or open a company and add a deal from its Deals tab." action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>New deal</Button>} /></Card>
      ) : view === 'board' ? (
        <DealsBoard deals={shown} onOpen={setEditing} onMove={move} />
      ) : (
        <Card pad={6}><DealsTable deals={shown} onOpen={setEditing} /></Card>
      )}
      {editing && (
        <DealModal
          deal={editing === 'new' ? null : editing}
          orgs={orgs}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </MainLayout>
  );
}

// ── Deals tab on a company ────────────────────────────────────────────────────
export function OrgDealsTab({ org, onChanged }: { org: Organization; onChanged?: () => void }) {
  const { deals, loading, reload } = useDeals(org.id);
  const [editing, setEditing] = useState<Deal | 'new' | null>(null);
  const fixed = { id: org.id, name: org.name };
  return (
    <div style={{ marginTop: 20 }}>
      <Card pad={18}>
        <CardHead icon="handshake" title="Deals" sub="Open and past deals with this company" action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>New deal</Button>} />
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 12 }}>Loading…</div>
        ) : deals.length === 0 ? (
          <Empty icon="handshake" title="No deals yet" sub="Add a deal to track it from first meeting to signed client." />
        ) : (
          <DealsTable deals={deals} onOpen={setEditing} showCompany={false} />
        )}
      </Card>
      {editing && (
        <DealModal
          deal={editing === 'new' ? null : editing}
          orgs={[fixed]}
          fixedOrg={fixed}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
