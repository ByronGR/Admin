'use client';

// ============================================================
// Timeline — the HubSpot-style activity feed shared by company, deal and
// contact pages. Log a note, email, call, meeting or task once; link it to the
// company, any of its deals and any of its contacts; it then shows on every
// record it is linked to. Upcoming (open) tasks sit above the history.
// Firestore: crmActivities (orgId + dealIds[] + contactIds[]) / crmTasks.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type IconName } from 'lucide-react/dynamic';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Card } from '@/components/nw/shell-ui';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { actorEmail, actorName, dueInfo, fmtDayTime, todayIso } from '@/lib/crm';
import {
  CALL_OUTCOMES, MEETING_OUTCOMES, CRM_TASK_TYPE_LABELS, CRM_PRIORITY_LABELS,
  type CallOutcome, type MeetingOutcome, type ActivityDirection, type CrmActivity, type CrmActivityKind,
  type CrmTask, type CrmTaskType, type CrmPriority, type Contact, type Deal, type Organization,
} from '@/lib/types';
import { crmField, Field, Pill, Empty, saveErrorMessage } from './ui';
import { useStaff } from './use-staff';

// ── What a timeline is about ─────────────────────────────────────────────────
export type TimelineScope =
  | { kind: 'org'; orgId: string }
  | { kind: 'deal'; dealId: string }
  | { kind: 'contact'; contactId: string };

// Defaults for anything logged from this page: the company, and the deal or
// contact the page is about (pre-ticked, can be changed).
export interface LogContext {
  orgId: string;
  orgName?: string;
  dealIds?: string[];
  contactIds?: string[];
}

const KIND_META: Record<CrmActivityKind, { label: string; icon: IconName }> = {
  note: { label: 'Note', icon: 'sticky-note' },
  email: { label: 'Email', icon: 'mail' },
  call: { label: 'Call', icon: 'phone' },
  meeting: { label: 'Meeting', icon: 'calendar' },
};
const TASK_TYPE_ICON: Record<CrmTaskType, IconName> = { todo: 'check-square', call: 'phone', email: 'mail' };
const PRIORITY_STYLE: Record<CrmPriority, { fg: string; bg: string }> = {
  none: { fg: NW.gray500, bg: NW.gray50 },
  low: { fg: '#1D4ED8', bg: '#EFF6FF' },
  medium: { fg: '#A16207', bg: NW.yellow50 },
  high: { fg: '#C0392B', bg: '#FEF0F0' },
};
const OUTCOME_GOOD = new Set(['Connected', 'Completed', 'Scheduled']);

const safe = async <T,>(p: Promise<T>) => { try { return await p; } catch (e) { console.error('[timeline] load failed', e); return null; } };

export function useTimeline(scope: TimelineScope) {
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const key = scope.kind === 'org' ? scope.orgId : scope.kind === 'deal' ? scope.dealId : scope.contactId;

  const reload = useCallback(async () => {
    const acts = collection(db, 'crmActivities');
    const tks = collection(db, 'crmTasks');
    const [aSnap, tSnap] = await Promise.all(
      scope.kind === 'org'
        ? [safe(getDocs(query(acts, where('orgId', '==', key)))), safe(getDocs(query(tks, where('orgId', '==', key))))]
        : scope.kind === 'deal'
          ? [safe(getDocs(query(acts, where('dealIds', 'array-contains', key)))), safe(getDocs(query(tks, where('dealId', '==', key))))]
          : [safe(getDocs(query(acts, where('contactIds', 'array-contains', key)))), safe(getDocs(query(tks, where('contactId', '==', key))))],
    );
    const a = aSnap ? aSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmActivity) : [];
    a.sort((x, y) => (y.at || '').localeCompare(x.at || ''));
    const t = tSnap ? tSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmTask) : [];
    t.sort((x, y) => (x.dueDate || '9999').localeCompare(y.dueDate || '9999'));
    setActivities(a);
    setTasks(t);
    setLoading(false);
  }, [scope.kind, key]);

  // Load from Firestore on mount and when the record changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { activities, tasks, setTasks, loading, reload };
}

// The company's deals and contacts, for the "linked to" pickers.
export function useOrgRecords(orgId?: string) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      safe(getDocs(query(collection(db, 'deals'), where('orgId', '==', orgId)))),
      safe(getDocs(query(collection(db, 'contacts'), where('orgId', '==', orgId)))),
    ]).then(([d, c]) => {
      setDeals(d ? d.docs.map((x) => ({ ...x.data(), id: x.id }) as Deal) : []);
      setContacts(c ? c.docs.map((x) => ({ ...x.data(), id: x.id }) as Contact).sort((a, b) => a.name.localeCompare(b.name)) : []);
    });
  }, [orgId]);
  return { deals, contacts };
}

export async function toggleTaskDone(t: CrmTask): Promise<void> {
  await updateDoc(doc(db, 'crmTasks', t.id), { done: !t.done, doneAt: !t.done ? serverTimestamp() : null });
}

// ── Pickers ───────────────────────────────────────────────────────────────────
function CheckList<T extends { id: string }>({ items, picked, onChange, label, empty }: {
  items: T[]; picked: string[]; onChange: (ids: string[]) => void; label: (x: T) => string; empty: string;
}) {
  if (!items.length) return <div style={{ fontSize: 12.5, color: NW.gray400, padding: '6px 0' }}>{empty}</div>;
  return (
    <div style={{ display: 'grid', gap: 4, maxHeight: 132, overflowY: 'auto', border: `1px solid ${NW.gray100}`, borderRadius: 10, padding: '6px 10px' }}>
      {items.map((x) => (
        <label key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NW.black, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={picked.includes(x.id)}
            onChange={(e) => onChange(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))}
          />
          {label(x)}
        </label>
      ))}
    </div>
  );
}

const splitAt = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

// ── Log / edit an activity ────────────────────────────────────────────────────
export function LogActivityModal({ kind, context, activity, onClose, onDone }: {
  kind: CrmActivityKind;
  context: LogContext;
  activity?: CrmActivity;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const { deals, contacts } = useOrgRecords(context.orgId);
  const start = splitAt(activity?.at);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    body: activity?.body ?? '',
    subject: activity?.subject ?? '',
    date: start.date,
    time: start.time,
    callOutcome: (activity?.callOutcome ?? 'Connected') as CallOutcome,
    meetingOutcome: (activity?.meetingOutcome ?? 'Completed') as MeetingOutcome,
    direction: (activity?.direction ?? 'outbound') as ActivityDirection,
    duration: activity?.durationMin ? String(activity.durationMin) : '',
    dealIds: activity?.dealIds ?? context.dealIds ?? [],
    contactIds: activity?.contactIds ?? context.contactIds ?? [],
  });
  const meta = KIND_META[kind];

  async function save() {
    if (!f.body.trim() && !f.subject.trim()) { showToast('Add a few words about it first', 'error'); return; }
    setSaving(true);
    const at = new Date(`${f.date}T${f.time || '12:00'}:00`).toISOString();
    const minutes = parseInt(f.duration, 10);
    const data: Record<string, unknown> = {
      kind, body: f.body.trim(), at, dealIds: f.dealIds, contactIds: f.contactIds,
      subject: kind === 'email' || kind === 'meeting' ? f.subject.trim() || null : null,
      callOutcome: kind === 'call' ? f.callOutcome : null,
      meetingOutcome: kind === 'meeting' ? f.meetingOutcome : null,
      direction: kind === 'call' || kind === 'email' ? f.direction : null,
      durationMin: (kind === 'call' || kind === 'meeting') && Number.isFinite(minutes) ? minutes : null,
    };
    try {
      if (activity) {
        await updateDoc(doc(db, 'crmActivities', activity.id), data);
      } else {
        await addDoc(collection(db, 'crmActivities'), {
          ...data, orgId: context.orgId, orgName: context.orgName || null,
          createdBy: actorName(), createdByEmail: actorEmail(), createdAt: serverTimestamp(),
        });
      }
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!activity) return;
    try { await deleteDoc(doc(db, 'crmActivities', activity.id)); onDone(); } catch (e) { showToast(saveErrorMessage(e), 'error'); }
  }

  const title = `${activity ? 'Edit' : 'Log'} ${meta.label.toLowerCase()}`;
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {kind === 'call' && (<>
          <Field label="Outcome">
            <select style={crmField} value={f.callOutcome} onChange={(e) => setF({ ...f, callOutcome: e.target.value as CallOutcome })}>
              {CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Direction">
            <select style={crmField} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as ActivityDirection })}>
              <option value="outbound">Outbound</option><option value="inbound">Inbound</option>
            </select>
          </Field>
          <Field label="Duration (min)"><input style={crmField} inputMode="numeric" value={f.duration} placeholder="15" onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
        </>)}
        {kind === 'meeting' && (<>
          <Field label="Outcome">
            <select style={crmField} value={f.meetingOutcome} onChange={(e) => setF({ ...f, meetingOutcome: e.target.value as MeetingOutcome })}>
              {MEETING_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Duration (min)"><input style={crmField} inputMode="numeric" value={f.duration} placeholder="30" onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
          <div />
        </>)}
        {kind === 'email' && (<>
          <Field label="Direction">
            <select style={crmField} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as ActivityDirection })}>
              <option value="outbound">Sent by us</option><option value="inbound">Received</option>
            </select>
          </Field>
          <div /><div />
        </>)}
        {(kind === 'email' || kind === 'meeting') && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label={kind === 'email' ? 'Subject' : 'Meeting title'}>
              <input style={crmField} value={f.subject} placeholder={kind === 'email' ? 'Re: Finance team proposal' : 'Discovery call'} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label="Date"><input type="date" style={crmField} value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value || todayIso() })} /></Field>
        <Field label="Time"><input type="time" style={crmField} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <div />
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label={kind === 'note' ? 'Note' : kind === 'email' ? 'Email (paste or summarise)' : 'Notes'}>
            <textarea
              style={{ ...crmField, minHeight: 110, resize: 'vertical', fontFamily: 'inherit' }}
              value={f.body}
              autoFocus
              placeholder={kind === 'call' ? 'What was discussed?' : kind === 'meeting' ? 'Agenda, decisions, next steps' : ''}
              onChange={(e) => setF({ ...f, body: e.target.value })}
            />
          </Field>
        </div>
        <div style={{ gridColumn: '1 / span 2' }}>
          <Field label={kind === 'meeting' ? 'Attendees' : 'Contacts'}>
            <CheckList items={contacts} picked={f.contactIds} onChange={(ids) => setF({ ...f, contactIds: ids })} label={(c) => c.title ? `${c.name} · ${c.title}` : c.name} empty="No contacts at this company yet" />
          </Field>
        </div>
        <Field label="Deals">
          <CheckList items={deals} picked={f.dealIds} onChange={(ids) => setF({ ...f, dealIds: ids })} label={(d) => d.title} empty="No deals yet" />
        </Field>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {activity && <Button variant="ghost" size="sm" icon="trash-2" onClick={remove}>Delete</Button>}
        <span style={{ fontSize: 12, color: NW.gray500 }}>Also shows on {context.orgName || 'the company'}</span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : activity ? 'Save' : `Log ${meta.label.toLowerCase()}`}</Button>
      </div>
    </Modal>
  );
}

// ── Create / edit a task ──────────────────────────────────────────────────────
// With no `context`, the person picks the company first (Tasks page).
export function TaskModal({ context, task, onClose, onDone }: {
  context?: LogContext;
  task?: CrmTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const staff = useStaff();
  const [orgs, setOrgs] = useState<Pick<Organization, 'id' | 'name'>[]>([]);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    orgId: task?.orgId ?? context?.orgId ?? '',
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    type: (task?.type ?? 'todo') as CrmTaskType,
    priority: (task?.priority ?? 'none') as CrmPriority,
    dueDate: task?.dueDate ?? '',
    dueTime: task?.dueTime ?? '',
    ownerEmail: task?.ownerEmail ?? actorEmail(),
    dealId: task?.dealId ?? context?.dealIds?.[0] ?? '',
    contactId: task?.contactId ?? context?.contactIds?.[0] ?? '',
  });
  const { deals, contacts } = useOrgRecords(f.orgId || undefined);

  useEffect(() => {
    if (context || task) return;
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || '' })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => null);
  }, [context, task]);

  async function save() {
    if (!f.title.trim()) { showToast('Name the task', 'error'); return; }
    if (!f.orgId) { showToast('Pick a company', 'error'); return; }
    setSaving(true);
    const owner = staff.find((s) => s.email === f.ownerEmail);
    const deal = deals.find((d) => d.id === f.dealId);
    const contact = contacts.find((c) => c.id === f.contactId);
    const orgName = context?.orgName ?? task?.orgName ?? orgs.find((o) => o.id === f.orgId)?.name ?? null;
    const data = {
      orgId: f.orgId, orgName, title: f.title.trim(), notes: f.notes.trim() || null, type: f.type, priority: f.priority,
      dueDate: f.dueDate || null, dueTime: f.dueDate && f.dueTime ? f.dueTime : null,
      ownerEmail: f.ownerEmail || null,
      ownerName: owner?.name || (f.ownerEmail === actorEmail() ? actorName() : task?.ownerName || null),
      dealId: f.dealId || null, dealTitle: deal?.title || null,
      contactId: f.contactId || null, contactName: contact?.name || null,
    };
    try {
      if (task) await updateDoc(doc(db, 'crmTasks', task.id), data);
      else await addDoc(collection(db, 'crmTasks'), { ...data, done: false, createdAt: serverTimestamp(), createdBy: actorName() });
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!task) return;
    try { await deleteDoc(doc(db, 'crmTasks', task.id)); onDone(); } catch (e) { showToast(saveErrorMessage(e), 'error'); }
  }

  return (
    <Modal open onClose={onClose} title={task ? 'Edit task' : 'New task'} size="xl">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Task"><input style={crmField} value={f.title} autoFocus placeholder="Follow up with Ana about the proposal" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        </div>
        <Field label="Type">
          <select style={crmField} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CrmTaskType })}>
            {(Object.keys(CRM_TASK_TYPE_LABELS) as CrmTaskType[]).map((k) => <option key={k} value={k}>{CRM_TASK_TYPE_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select style={crmField} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as CrmPriority })}>
            {(Object.keys(CRM_PRIORITY_LABELS) as CrmPriority[]).map((k) => <option key={k} value={k}>{CRM_PRIORITY_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Assigned to">
          <select style={crmField} value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })}>
            {!staff.some((s) => s.email === f.ownerEmail) && f.ownerEmail && <option value={f.ownerEmail}>{task?.ownerName || 'Me'}</option>}
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input type="date" style={crmField} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Time (optional)"><input type="time" style={crmField} value={f.dueTime} disabled={!f.dueDate} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></Field>
        <div />
        <Field label="Company">
          {context || task ? (
            <div style={{ ...crmField, background: NW.gray50 }}>{context?.orgName || task?.orgName || '—'}</div>
          ) : (
            <select style={crmField} value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value, dealId: '', contactId: '' })}>
              <option value="">Pick a company…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Deal">
          <select style={crmField} value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })} disabled={!f.orgId}>
            <option value="">None</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </Field>
        <Field label="Contact">
          <select style={crmField} value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })} disabled={!f.orgId}>
            <option value="">None</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Notes"><textarea style={{ ...crmField, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {task && <Button variant="ghost" size="sm" icon="trash-2" onClick={remove}>Delete</Button>}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : task ? 'Save' : 'Create task'}</Button>
      </div>
    </Modal>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────────
export function TaskRow({ t, onToggle, onOpen, showCompany }: { t: CrmTask; onToggle: () => void; onOpen: () => void; showCompany?: boolean }) {
  const due = dueInfo(t.dueDate, t.dueTime);
  const pr = t.priority && t.priority !== 'none' ? t.priority : null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 4px', borderTop: `1px solid ${NW.gray100}` }}>
      <input type="checkbox" checked={t.done} onChange={onToggle} style={{ marginTop: 4, cursor: 'pointer' }} />
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name={TASK_TYPE_ICON[t.type ?? 'todo']} size={13} color={NW.gray500} />
          <span style={{ fontSize: 13.5, fontWeight: 500, color: t.done ? NW.gray400 : NW.black, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 11.5, color: NW.gray500 }}>
          {!t.done && due.late ? <Pill fg="#C0392B" bg="#FEF0F0">Overdue · {due.text}</Pill> : <span style={{ fontWeight: due.today ? 600 : 400, color: due.today ? NW.teal700 : NW.gray500 }}>{due.text}</span>}
          {pr && <Pill fg={PRIORITY_STYLE[pr].fg} bg={PRIORITY_STYLE[pr].bg}>{CRM_PRIORITY_LABELS[pr]}</Pill>}
          {showCompany && t.orgName && <span>· {t.orgName}</span>}
          {t.dealTitle && <span>· {t.dealTitle}</span>}
          {t.contactName && <span>· {t.contactName}</span>}
          {t.ownerName && <span>· {t.ownerName}</span>}
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ a, dealNames, contactNames, onOpen }: { a: CrmActivity; dealNames: Map<string, string>; contactNames: Map<string, string>; onOpen: () => void }) {
  const m = KIND_META[a.kind] || KIND_META.note;
  const outcome = a.callOutcome || a.meetingOutcome;
  const links = [
    ...(a.contactIds || []).map((id) => contactNames.get(id)).filter(Boolean),
    ...(a.dealIds || []).map((id) => dealNames.get(id)).filter(Boolean),
  ] as string[];
  return (
    <div onClick={onOpen} style={{ display: 'flex', gap: 12, padding: '14px 4px', borderTop: `1px solid ${NW.gray100}`, cursor: 'pointer' }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={m.icon} size={15} color={NW.gray600} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>
            {a.kind === 'call' ? `${a.direction === 'inbound' ? 'Inbound' : 'Outbound'} call` : a.kind === 'email' ? (a.direction === 'inbound' ? 'Email received' : 'Email sent') : m.label}
          </span>
          {outcome && <Pill fg={OUTCOME_GOOD.has(outcome) ? NW.teal700 : '#A16207'} bg={OUTCOME_GOOD.has(outcome) ? NW.teal50 : NW.yellow50}>{outcome}</Pill>}
          {a.durationMin ? <span style={{ fontSize: 11.5, color: NW.gray500 }}>{a.durationMin} min</span> : null}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: NW.gray500 }}>{fmtDayTime(a.at)}</span>
        </div>
        {a.subject && <div style={{ fontSize: 13.5, fontWeight: 500, color: NW.black, marginTop: 4 }}>{a.subject}</div>}
        {a.body && <div style={{ fontSize: 13.5, color: NW.gray700, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.body}</div>}
        <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 6 }}>
          {a.createdBy ? `Logged by ${a.createdBy}` : ''}{links.length ? `${a.createdBy ? ' · ' : ''}Linked to ${links.join(', ')}` : ''}
        </div>
      </div>
    </div>
  );
}

// ── The timeline ──────────────────────────────────────────────────────────────
type Filter = 'all' | CrmActivityKind | 'task';

export function Timeline({ scope, context, onChanged }: { scope: TimelineScope; context: LogContext; onChanged?: () => void }) {
  const { showToast } = useToast();
  const { activities, tasks, setTasks, loading, reload } = useTimeline(scope);
  const { deals, contacts } = useOrgRecords(context.orgId);
  const [filter, setFilter] = useState<Filter>('all');
  const [logging, setLogging] = useState<{ kind: CrmActivityKind; activity?: CrmActivity } | null>(null);
  const [taskModal, setTaskModal] = useState<CrmTask | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);

  const dealNames = useMemo(() => new Map(deals.map((d) => [d.id, d.title])), [deals]);
  const contactNames = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const shownActs = filter === 'all' ? activities : filter === 'task' ? [] : activities.filter((a) => a.kind === filter);
  const showTasks = filter === 'all' || filter === 'task';

  const changed = () => { reload(); onChanged?.(); };

  async function toggle(t: CrmTask) {
    try {
      await toggleTaskDone(t);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
      onChanged?.();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  const count = (k: CrmActivityKind) => activities.filter((a) => a.kind === k).length;
  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'Activity', n: activities.length + tasks.length },
    { id: 'note', label: 'Notes', n: count('note') },
    { id: 'email', label: 'Emails', n: count('email') },
    { id: 'call', label: 'Calls', n: count('call') },
    { id: 'task', label: 'Tasks', n: tasks.length },
    { id: 'meeting', label: 'Meetings', n: count('meeting') },
  ];

  return (
    <Card pad={0}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 22, padding: '0 18px', borderBottom: `1px solid ${NW.gray100}`, overflowX: 'auto' }}>
        {FILTERS.map((x) => {
          const on = x.id === filter;
          return (
            <button key={x.id} onClick={() => setFilter(x.id)} style={{ position: 'relative', border: 'none', background: 'transparent', cursor: 'pointer', padding: '13px 0', fontSize: 13, fontWeight: on ? 600 : 500, color: on ? NW.black : NW.gray500, whiteSpace: 'nowrap' }}>
              {x.label}{x.n ? <span style={{ marginLeft: 5, fontSize: 11.5, color: NW.gray400 }}>{x.n}</span> : null}
              {on && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: NW.teal500, borderRadius: 2 }} />}
            </button>
          );
        })}
      </div>

      {/* Log buttons */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 18px', flexWrap: 'wrap', borderBottom: `1px solid ${NW.gray100}` }}>
        {(['note', 'email', 'call', 'meeting'] as CrmActivityKind[]).map((k) => (
          <Button key={k} variant="secondary" size="sm" icon={KIND_META[k].icon} onClick={() => setLogging({ kind: k })}>
            {k === 'note' ? 'Create note' : `Log ${KIND_META[k].label.toLowerCase()}`}
          </Button>
        ))}
        <Button variant="secondary" size="sm" icon="check-square" onClick={() => setTaskModal('new')}>Create task</Button>
      </div>

      <div style={{ padding: '4px 18px 18px' }}>
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: '14px 0' }}>Loading…</div>
        ) : (<>
          {showTasks && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray400, padding: '14px 0 4px' }}>Upcoming</div>
              {open.length === 0 ? (
                <div style={{ fontSize: 12.5, color: NW.gray500, padding: '6px 0 4px' }}>No open tasks. Create one so there is always a next step.</div>
              ) : open.map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} onOpen={() => setTaskModal(t)} />)}
              {done.length > 0 && (
                <button onClick={() => setShowDone((v) => !v)} style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: NW.gray500, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {showDone ? 'Hide' : 'Show'} {done.length} completed task{done.length === 1 ? '' : 's'}
                </button>
              )}
              {showDone && done.map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} onOpen={() => setTaskModal(t)} />)}
            </>
          )}
          {filter !== 'task' && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray400, padding: '18px 0 4px' }}>History</div>
              {shownActs.length === 0 ? (
                <Empty icon="history" title="Nothing logged yet" sub="Log a call, email, meeting or note above. It also shows on every deal and contact you link it to." />
              ) : shownActs.map((a) => (
                <ActivityRow key={a.id} a={a} dealNames={dealNames} contactNames={contactNames} onOpen={() => setLogging({ kind: a.kind, activity: a })} />
              ))}
            </>
          )}
        </>)}
      </div>

      {logging && (
        <LogActivityModal
          kind={logging.kind}
          activity={logging.activity}
          context={context}
          onClose={() => setLogging(null)}
          onDone={() => { setLogging(null); changed(); }}
        />
      )}
      {taskModal && (
        <TaskModal
          context={context}
          task={taskModal === 'new' ? undefined : taskModal}
          onClose={() => setTaskModal(null)}
          onDone={() => { setTaskModal(null); changed(); }}
        />
      )}
    </Card>
  );
}
