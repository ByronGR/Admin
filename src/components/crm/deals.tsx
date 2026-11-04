'use client';

// ============================================================
// Deals — every deal in one place (board or list), plus the per-company Deals
// tab. Stages: Prospect → Meeting booked → Proposal → Contract sent → Client / Lost.
// Clicking a deal opens its record page (/deals/[id]). Every stage move is
// kept in the deal's stage history. Moving a deal to Client opens its
// Engagement and marks the company a client. Firestore: deals.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, arrayUnion,
} from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { PageHeader, Card, CardHead, SegTabs, Table, Th, Td, TableRow } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { Modal } from '@/components/ui/modal';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useToast } from '@/components/ui/toast';
import { actorEmail, actorName, fmtUsd, fmtDay, dueInfo, dealTracking, weightedMrr, DEAL_STAGE_STYLE } from '@/lib/crm';
import {
  DEAL_STAGES, DEAL_STAGE_PROBABILITY, CRM_PRIORITY_LABELS,
  type Contact, type CrmActivity, type CrmPriority, type CrmTask, type Deal, type DealStage, type Organization,
} from '@/lib/types';
import { crmField, Field, DealStagePill, Empty, Stat, saveErrorMessage } from './ui';
import { useStaff } from './use-staff';

export const OPEN_STAGES: DealStage[] = ['Prospect', 'Meeting booked', 'Proposal', 'Contract sent'];
export const dealHref = (id: string) => `/deals/${encodeURIComponent(id)}`;

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

// Every activity and task, for "last activity" / "next step" on the board and list.
export function useAllTracking() {
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const reload = useCallback(async () => {
    const [a, t] = await Promise.allSettled([getDocs(collection(db, 'crmActivities')), getDocs(collection(db, 'crmTasks'))]);
    setActivities(a.status === 'fulfilled' ? a.value.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmActivity) : []);
    setTasks(t.status === 'fulfilled' ? t.value.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmTask) : []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { activities, tasks, reload };
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

// Move a deal to a stage, recording who moved it and when.
export async function setStage(deal: Deal, stage: DealStage): Promise<Partial<Deal>> {
  const patch: Record<string, unknown> = {
    stage, stageChangedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    stageHistory: arrayUnion({ stage, at: new Date().toISOString(), by: actorName() }),
  };
  if (stage === 'Client') patch.engagementId = await onWon({ ...deal, stage });
  await updateDoc(doc(db, 'deals', deal.id), patch);
  return { stage, engagementId: patch.engagementId as string | undefined };
}

// ── "Next step" line, shared by the board and the list ─────────────────────────
function NextStep({ task, compact }: { task?: CrmTask; compact?: boolean }) {
  if (!task) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: compact ? 11 : 12, fontWeight: 600, color: '#C0392B' }}><Icon name="alert-circle" size={12} color="#C0392B" />No next step</span>;
  const due = dueInfo(task.dueDate, task.dueTime);
  return (
    <span style={{ fontSize: compact ? 11 : 12, color: due.late ? '#C0392B' : NW.gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
      {due.late ? 'Overdue: ' : ''}{task.title} · {due.text}
    </span>
  );
}

// ── Deal card (board) ─────────────────────────────────────────────────────────
function DealCard({ deal, nextTask, onOpen, dragging }: { deal: Deal; nextTask?: CrmTask; onOpen: () => void; dragging?: boolean }) {
  const open = OPEN_STAGES.includes(deal.stage);
  return (
    <div
      onClick={onOpen}
      style={{
        background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12, cursor: 'grab',
        boxShadow: dragging ? '0 10px 24px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black, lineHeight: 1.3 }}>{deal.title}</div>
      <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>{deal.orgName || 'Unknown company'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12 }}>
        {deal.mrr ? <span style={{ fontWeight: 600, color: NW.teal700 }}>{fmtUsd(deal.mrr)}/mo</span> : null}
        {deal.value ? <span style={{ color: NW.gray700 }}>{fmtUsd(deal.value)}</span> : null}
        <div style={{ flex: 1 }} />
        {deal.closeDate && <span style={{ color: NW.gray500 }}>{fmtDay(deal.closeDate).replace(/, \d{4}$/, '')}</span>}
      </div>
      {open && <div style={{ marginTop: 8 }}><NextStep task={nextTask} compact /></div>}
      {deal.ownerName && <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 6 }}>{deal.ownerName}</div>}
    </div>
  );
}

function DraggableDeal({ deal, nextTask, onOpen }: { deal: Deal; nextTask?: CrmTask; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 10 : undefined, position: 'relative', opacity: isDragging ? 0.9 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <DealCard deal={deal} nextTask={nextTask} onOpen={onOpen} dragging={isDragging} />
    </div>
  );
}

function StageColumn({ stage, deals, next, onOpen }: { stage: DealStage; deals: Deal[]; next: Map<string, CrmTask | undefined>; onOpen: (d: Deal) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const s = DEAL_STAGE_STYLE[stage];
  const mrr = deals.reduce((n, d) => n + (Number(d.mrr) || 0), 0);
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 240, flex: '1 0 240px', background: isOver ? NW.teal50 : NW.gray50, borderRadius: 14,
        padding: 10, border: `1px solid ${isOver ? NW.teal500 : 'transparent'}`, transition: 'background 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 2px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fg }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{stage}</span>
        <span style={{ fontSize: 12, color: NW.gray500 }}>{deals.length}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 10px', fontSize: 11.5, color: NW.gray500 }}>
        <span>{fmtUsd(mrr)}/mo</span>
        <span>· {Math.round(DEAL_STAGE_PROBABILITY[stage] * 100)}% likely</span>
      </div>
      <div style={{ display: 'grid', gap: 8, minHeight: 60 }}>
        {deals.map((d) => <DraggableDeal key={d.id} deal={d} nextTask={next.get(d.id)} onOpen={() => onOpen(d)} />)}
      </div>
    </div>
  );
}

function DealsBoard({ deals, next, onOpen, onMove }: { deals: Deal[]; next: Map<string, CrmTask | undefined>; onOpen: (d: Deal) => void; onMove: (d: Deal, s: DealStage) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function handleDragEnd(e: DragEndEvent) {
    const deal = deals.find((d) => d.id === e.active.id);
    const stage = e.over?.id as DealStage | undefined;
    if (deal && stage && stage !== deal.stage) onMove(deal, stage);
  }
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {DEAL_STAGES.map((s) => <StageColumn key={s} stage={s} deals={deals.filter((d) => d.stage === s)} next={next} onOpen={onOpen} />)}
      </div>
    </DndContext>
  );
}

export function DealsTable({ deals, onOpen, showCompany = true, tracking }: {
  deals: Deal[];
  onOpen: (d: Deal) => void;
  showCompany?: boolean;
  tracking?: Map<string, { lastActivityAt?: string; nextTask?: CrmTask }>;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Deal</Th>
          {showCompany && <Th>Company</Th>}
          <Th>Stage</Th><Th align="right">MRR</Th><Th>Owner</Th><Th>Close date</Th>
          {tracking && <Th>Last activity</Th>}
          {tracking && <Th>Next step</Th>}
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => {
          const tr = tracking?.get(d.id);
          return (
            <TableRow key={d.id} onClick={() => onOpen(d)}>
              <Td><span style={{ fontWeight: 600 }}>{d.title}</span></Td>
              {showCompany && <Td>{d.orgName || '—'}</Td>}
              <Td><DealStagePill stage={d.stage} /></Td>
              <Td align="right">{d.mrr ? fmtUsd(d.mrr) : '—'}</Td>
              <Td>{d.ownerName || '—'}</Td>
              <Td>{d.closeDate ? fmtDay(d.closeDate) : '—'}</Td>
              {tracking && <Td>{tr?.lastActivityAt ? fmtDay(tr.lastActivityAt) : '—'}</Td>}
              {tracking && <Td style={{ maxWidth: 220 }}>{OPEN_STAGES.includes(d.stage) ? <NextStep task={tr?.nextTask} /> : '—'}</Td>}
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}

// ── Create / edit ─────────────────────────────────────────────────────────────
// Like HubSpot's "Create deal": pick the company, the people on the deal, and
// optionally set the first follow-up task in the same step.
export function DealModal({
  deal, orgs, fixedOrg, presetContactId, onClose, onDone,
}: {
  deal: Deal | null;
  orgs: Pick<Organization, 'id' | 'name'>[];
  fixedOrg?: Pick<Organization, 'id' | 'name'>;
  presetContactId?: string;
  onClose: () => void;
  onDone: (id?: string) => void;
}) {
  const { showToast } = useToast();
  const staff = useStaff();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [orgContacts, setOrgContacts] = useState<Contact[]>([]);
  const [f, setF] = useState({
    orgId: deal?.orgId ?? fixedOrg?.id ?? '',
    title: deal?.title ?? '',
    stage: (deal?.stage ?? 'Prospect') as DealStage,
    mrr: deal?.mrr ? String(deal.mrr) : '',
    value: deal?.value ? String(deal.value) : '',
    ownerEmail: deal?.ownerEmail ?? actorEmail(),
    closeDate: deal?.closeDate ?? '',
    priority: (deal?.priority ?? 'none') as CrmPriority,
    dealType: (deal?.dealType ?? 'new') as 'new' | 'existing',
    lostReason: deal?.lostReason ?? '',
    contactIds: deal?.contactIds ?? (presetContactId ? [presetContactId] : []),
    taskTitle: '',
    taskDue: '',
  });
  const num = (s: string) => { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };

  useEffect(() => {
    if (!f.orgId) return;
    getDocs(query(collection(db, 'contacts'), where('orgId', '==', f.orgId)))
      .then((snap) => setOrgContacts(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setOrgContacts([]));
  }, [f.orgId]);

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
      closeDate: f.closeDate || null, priority: f.priority, dealType: f.dealType, contactIds: f.contactIds,
      lostReason: f.stage === 'Lost' ? f.lostReason.trim() || null : null,
    };
    try {
      let id = deal?.id;
      if (deal) {
        await updateDoc(doc(db, 'deals', deal.id), { ...data, updatedAt: serverTimestamp() });
        if (f.stage !== deal.stage) await setStage({ ...deal, ...data } as Deal, f.stage);
      } else {
        const won = f.stage === 'Client';
        const ref = await addDoc(collection(db, 'deals'), {
          ...data, stage: won ? 'Prospect' : f.stage, source: 'manual', createdAt: serverTimestamp(), createdBy: actorName(),
          stageChangedAt: serverTimestamp(),
          stageHistory: [{ stage: won ? 'Prospect' : f.stage, at: new Date().toISOString(), by: actorName() }],
        });
        id = ref.id;
        if (won) await setStage({ ...data, id: ref.id, stage: 'Prospect' } as Deal, 'Client');
        if (f.taskTitle.trim()) {
          await addDoc(collection(db, 'crmTasks'), {
            orgId: org.id, orgName: org.name, title: f.taskTitle.trim(), type: 'todo', priority: 'none',
            dueDate: f.taskDue || null, dueTime: null, ownerEmail: data.ownerEmail, ownerName: data.ownerName,
            dealId: ref.id, dealTitle: data.title, contactId: f.contactIds[0] || null,
            contactName: orgContacts.find((c) => c.id === f.contactIds[0])?.name || null,
            done: false, createdAt: serverTimestamp(), createdBy: actorName(),
          });
        }
      }
      if (f.stage === 'Client' && deal?.stage !== 'Client') showToast('Deal won: its Engagement is open on the company page');
      onDone(id);
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
    <Modal open onClose={onClose} title={deal ? 'Edit deal' : 'Create deal'} size="xl">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Deal name" span><input style={crmField} value={f.title} placeholder="Finance team, 3 hires" autoFocus={!deal} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Company">
          {fixedOrg ? (
            <div style={{ ...crmField, background: NW.gray50 }}>{fixedOrg.name}</div>
          ) : (
            <select style={crmField} value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value, contactIds: [] })}>
              <option value="">Pick a company…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Stage">
          <select style={crmField} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as DealStage })}>
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{s} ({Math.round(DEAL_STAGE_PROBABILITY[s] * 100)}%)</option>)}
          </select>
        </Field>
        <Field label="Deal owner">
          <select style={crmField} value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })}>
            {!staff.some((s) => s.email === f.ownerEmail) && f.ownerEmail && <option value={f.ownerEmail}>{deal?.ownerName || 'Me'}</option>}
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Expected MRR (USD/month)"><input style={crmField} value={f.mrr} inputMode="decimal" placeholder="7000" onChange={(e) => setF({ ...f, mrr: e.target.value })} /></Field>
        <Field label="One-time value (USD)"><input style={crmField} value={f.value} inputMode="decimal" placeholder="0" onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Close date"><input style={crmField} type="date" value={f.closeDate} onChange={(e) => setF({ ...f, closeDate: e.target.value })} /></Field>
        <Field label="Deal type">
          <select style={crmField} value={f.dealType} onChange={(e) => setF({ ...f, dealType: e.target.value as 'new' | 'existing' })}>
            <option value="new">New business</option><option value="existing">Existing business</option>
          </select>
        </Field>
        <Field label="Priority">
          <select style={crmField} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as CrmPriority })}>
            {(Object.keys(CRM_PRIORITY_LABELS) as CrmPriority[]).map((k) => <option key={k} value={k}>{CRM_PRIORITY_LABELS[k]}</option>)}
          </select>
        </Field>
        {f.stage === 'Lost' && <Field label="Why was it lost?"><input style={crmField} value={f.lostReason} placeholder="Went with an in-house hire" onChange={(e) => setF({ ...f, lostReason: e.target.value })} /></Field>}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="People on this deal">
            {!f.orgId ? (
              <div style={{ fontSize: 12.5, color: NW.gray400 }}>Pick a company first.</div>
            ) : orgContacts.filter((c) => c.orgId === f.orgId).length === 0 ? (
              <div style={{ fontSize: 12.5, color: NW.gray400 }}>No contacts at this company yet. Add them from the company&apos;s Contacts tab.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {orgContacts.filter((c) => c.orgId === f.orgId).map((c) => {
                  const on = f.contactIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setF({ ...f, contactIds: on ? f.contactIds.filter((x) => x !== c.id) : [...f.contactIds, c.id] })}
                      style={{ fontSize: 12.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? NW.teal500 : NW.gray200}`, background: on ? NW.teal50 : NW.white, color: on ? NW.teal700 : NW.gray600 }}>
                      {on ? '✓ ' : ''}{c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </div>
        {!deal && (
          <>
            <div style={{ gridColumn: '1 / span 2' }}>
              <Field label="First follow-up task (optional)"><input style={crmField} value={f.taskTitle} placeholder="Send proposal" onChange={(e) => setF({ ...f, taskTitle: e.target.value })} /></Field>
            </div>
            <Field label="Task due"><input style={crmField} type="date" value={f.taskDue} onChange={(e) => setF({ ...f, taskDue: e.target.value })} /></Field>
          </>
        )}
      </div>
      {f.stage === 'Client' && !deal?.engagementId && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: NW.teal700, background: NW.teal50, borderRadius: 10, padding: '9px 12px', marginTop: 14 }}>
          <Icon name="info" size={14} color={NW.teal700} />
          Saving as Client opens an Engagement for this deal and marks the company a client.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {deal && <HoldToDelete onConfirm={remove} busy={deleting} size="sm" label="Hold to delete" />}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : deal ? 'Save' : 'Create deal'}</Button>
      </div>
    </Modal>
  );
}

export function useOrgOptions() {
  const [orgs, setOrgs] = useState<Pick<Organization, 'id' | 'name'>[]>([]);
  useEffect(() => {
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || '' })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => null);
  }, []);
  return orgs;
}

// ── /deals ────────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { deals, setDeals, loading, reload } = useDeals();
  const { activities, tasks } = useAllTracking();
  const orgs = useOrgOptions();
  const [view, setViewState] = useState<'board' | 'list'>('board');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Restore the saved view after mount (localStorage isn't available during prerender).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = localStorage.getItem('nw_admin_dealview'); if (v === 'board' || v === 'list') setViewState(v); } catch {}
  }, []);
  const setView = (v: 'board' | 'list') => { setViewState(v); try { localStorage.setItem('nw_admin_dealview', v); } catch {} };

  const shown = useMemo(() => (mine ? deals.filter((d) => d.ownerEmail === actorEmail()) : deals), [deals, mine]);
  const tracking = useMemo(() => new Map(shown.map((d) => [d.id, dealTracking(d, activities, tasks)])), [shown, activities, tasks]);
  const next = useMemo(() => new Map([...tracking].map(([id, t]) => [id, t.nextTask])), [tracking]);
  const open = shown.filter((d) => OPEN_STAGES.includes(d.stage));
  const openMrr = open.reduce((n, d) => n + (Number(d.mrr) || 0), 0);
  const stalled = open.filter((d) => !tracking.get(d.id)?.nextTask).length;
  const won = shown.filter((d) => d.stage === 'Client');
  const decided = won.length + shown.filter((d) => d.stage === 'Lost').length;
  const openDeal = (d: Deal) => router.push(dealHref(d.id));

  async function move(deal: Deal, stage: DealStage) {
    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, stage } : d)));
    try {
      await setStage(deal, stage);
      if (stage === 'Client') showToast(`${deal.title} won: its Engagement is open`);
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
        subtitle="Every deal from first meeting to signed client. Drag a card to move it; click it to open the deal."
        actions={<Button icon="plus" onClick={() => setCreating(true)}>Create deal</Button>}
      />
      <Card pad={18} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Stat label="Open deals" value={open.length} />
          <Stat label="Open pipeline MRR" value={fmtUsd(openMrr)} color={NW.teal700} sub={`${fmtUsd(openMrr * 12)} ARR if all close`} />
          <Stat label="Weighted MRR" value={fmtUsd(weightedMrr(open))} sub="by each stage's chance of closing" />
          <Stat label="Win rate" value={decided ? `${Math.round((won.length / decided) * 100)}%` : '—'} sub={`${won.length} won of ${decided} decided`} />
          <Stat label="No next step" value={stalled} color={stalled ? '#C0392B' : NW.gray400} sub="open deals with no open task" />
        </div>
      </Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <SegTabs tabs={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List', count: shown.length }]} active={view} onChange={setView} />
        <SegTabs tabs={[{ id: 'all', label: 'All deals' }, { id: 'mine', label: 'My deals' }]} active={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} />
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: NW.gray500, padding: 20 }}>Loading deals…</div>
      ) : deals.length === 0 ? (
        <Card><Empty icon="handshake" title="No deals yet" sub="Create the first one, or open a company and add a deal from its Deals tab." action={<Button size="sm" icon="plus" onClick={() => setCreating(true)}>Create deal</Button>} /></Card>
      ) : view === 'board' ? (
        <DealsBoard deals={shown} next={next} onOpen={openDeal} onMove={move} />
      ) : (
        <Card pad={6}><DealsTable deals={shown} onOpen={openDeal} tracking={tracking} /></Card>
      )}
      {creating && (
        <DealModal
          deal={null}
          orgs={orgs}
          onClose={() => setCreating(false)}
          onDone={(id) => { setCreating(false); if (id) router.push(dealHref(id)); else reload(); }}
        />
      )}
    </MainLayout>
  );
}

// ── Deals tab on a company ────────────────────────────────────────────────────
export function OrgDealsTab({ org, onChanged }: { org: Organization; onChanged?: () => void }) {
  const router = useRouter();
  const { deals, loading, reload } = useDeals(org.id);
  const [creating, setCreating] = useState(false);
  const fixed = { id: org.id, name: org.name };
  return (
    <div style={{ marginTop: 20 }}>
      <Card pad={18}>
        <CardHead icon="handshake" title="Deals" sub="Open and past deals with this company" action={<Button size="sm" icon="plus" onClick={() => setCreating(true)}>Create deal</Button>} />
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 12 }}>Loading…</div>
        ) : deals.length === 0 ? (
          <Empty icon="handshake" title="No deals yet" sub="Add a deal to track it from first meeting to signed client." />
        ) : (
          <DealsTable deals={deals} onOpen={(d) => router.push(dealHref(d.id))} showCompany={false} />
        )}
      </Card>
      {creating && (
        <DealModal
          deal={null}
          orgs={[fixed]}
          fixedOrg={fixed}
          onClose={() => setCreating(false)}
          onDone={(id) => { setCreating(false); reload(); onChanged?.(); if (id) router.push(dealHref(id)); }}
        />
      )}
    </div>
  );
}

