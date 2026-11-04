'use client';

// ============================================================
// Activity — the client's timeline (notes, calls, meetings, emails logged by
// staff) plus follow-up tasks. Emails from Radar and Outlook, and Bookings
// meetings, will land on this same timeline in Phases 2–3.
// Firestore: crmActivities / crmTasks.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from '@/lib/firebase';
import { type IconName } from 'lucide-react/dynamic';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { useToast } from '@/components/ui/toast';
import { actorEmail, actorName, todayIso } from '@/lib/crm';
import type { CrmActivity, CrmActivityKind, CrmTask, Organization } from '@/lib/types';
import { crmField, Empty, Pill, saveErrorMessage } from './ui';
import { useStaff } from './use-staff';

const KINDS: { id: CrmActivityKind; label: string; icon: IconName }[] = [
  { id: 'note', label: 'Note', icon: 'sticky-note' },
  { id: 'call', label: 'Call', icon: 'phone' },
  { id: 'meeting', label: 'Meeting', icon: 'calendar' },
  { id: 'email', label: 'Email', icon: 'mail' },
];
const kindMeta = (k: CrmActivityKind) => KINDS.find((x) => x.id === k) || KINDS[0];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function dueLabel(due?: string): { text: string; late: boolean } {
  if (!due) return { text: 'No due date', late: false };
  const today = todayIso();
  const d = new Date(due + 'T00:00:00');
  const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { text: due === today ? 'Today' : text, late: due < today };
}

export function ActivityTab({ org }: { org: Organization }) {
  const { showToast } = useToast();
  const staff = useStaff();
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Composer
  const [kind, setKind] = useState<CrmActivityKind>('note');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState(todayIso());
  const [posting, setPosting] = useState(false);

  // New task
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskOwner, setTaskOwner] = useState(actorEmail());
  const [addingTask, setAddingTask] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const reload = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>) => { try { return await p; } catch (e) { console.error('[activity] load failed', e); return null; } };
    const [aSnap, tSnap] = await Promise.all([
      safe(getDocs(query(collection(db, 'crmActivities'), where('orgId', '==', org.id)))),
      safe(getDocs(query(collection(db, 'crmTasks'), where('orgId', '==', org.id)))),
    ]);
    const acts = aSnap ? aSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmActivity) : [];
    acts.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const ts = tSnap ? tSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmTask) : [];
    ts.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    setActivities(acts);
    setTasks(ts);
    setLoading(false);
  }, [org.id]);
  // Load from Firestore on mount and when the company changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      // Keep the time of day for today's entries so they sort in order.
      const at = when === todayIso() ? new Date().toISOString() : new Date(when + 'T12:00:00').toISOString();
      await addDoc(collection(db, 'crmActivities'), {
        orgId: org.id, kind, body: body.trim(), at,
        createdBy: actorName(), createdByEmail: actorEmail(), createdAt: serverTimestamp(),
      });
      setBody('');
      setWhen(todayIso());
      await reload();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    } finally {
      setPosting(false);
    }
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    setAddingTask(true);
    const owner = staff.find((s) => s.email === taskOwner);
    try {
      await addDoc(collection(db, 'crmTasks'), {
        orgId: org.id, orgName: org.name, title: taskTitle.trim(), dueDate: taskDue || null,
        ownerEmail: taskOwner || null, ownerName: owner?.name || (taskOwner === actorEmail() ? actorName() : null),
        done: false, createdAt: serverTimestamp(), createdBy: actorName(),
      });
      setTaskTitle('');
      setTaskDue('');
      await reload();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    } finally {
      setAddingTask(false);
    }
  }

  async function toggleTask(t: CrmTask) {
    try {
      await updateDoc(doc(db, 'crmTasks', t.id), { done: !t.done, doneAt: !t.done ? serverTimestamp() : null });
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  async function removeActivity(a: CrmActivity) {
    try {
      await deleteDoc(doc(db, 'crmActivities', a.id));
      setActivities((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  async function removeTask(t: CrmTask) {
    try {
      await deleteDoc(doc(db, 'crmTasks', t.id));
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="nw-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginTop: 20, alignItems: 'start' }}>
      {/* Timeline */}
      <Card pad={18}>
        <CardHead icon="history" title="Activity" sub="Notes, calls, meetings and emails, newest first" />
        <div style={{ border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {KINDS.map((k) => {
              const on = k.id === kind;
              return (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: on ? 600 : 500, padding: '5px 11px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? NW.teal500 : NW.gray100}`, background: on ? NW.teal50 : NW.white, color: on ? NW.teal700 : NW.gray600 }}
                >
                  <Icon name={k.icon} size={13} color={on ? NW.teal700 : NW.gray500} />{k.label}
                </button>
              );
            })}
          </div>
          <textarea
            style={{ ...crmField, minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
            value={body}
            placeholder={kind === 'call' ? 'What was discussed on the call?' : kind === 'meeting' ? 'Meeting notes' : kind === 'email' ? 'Summary of the email' : 'Write a note'}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <input type="date" style={{ ...crmField, width: 160 }} value={when} max={todayIso()} onChange={(e) => setWhen(e.target.value || todayIso())} />
            <div style={{ flex: 1 }} />
            <Button size="sm" onClick={post} disabled={posting || !body.trim()}>{posting ? 'Saving…' : `Log ${kindMeta(kind).label.toLowerCase()}`}</Button>
          </div>
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 12 }}>Loading…</div>
        ) : activities.length === 0 ? (
          <Empty icon="history" title="Nothing logged yet" sub="Log a note, call or meeting above. Emails will appear here automatically in a later phase." />
        ) : (
          activities.map((a) => {
            const m = kindMeta(a.kind);
            return (
              <div key={a.id} style={{ display: 'flex', gap: 12, padding: '12px 2px', borderTop: `1px solid ${NW.gray100}` }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={m.icon} size={14} color={NW.gray600} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: NW.gray500 }}>
                    <span style={{ fontWeight: 600, color: NW.gray700 }}>{m.label}</span>
                    <span>· {fmtWhen(a.at)}</span>
                    {a.createdBy && <span>· {a.createdBy}</span>}
                    <div style={{ flex: 1 }} />
                    {a.createdByEmail === actorEmail() && (
                      <button onClick={() => removeActivity(a)} title="Delete" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}>
                        <Icon name="x" size={13} color={NW.gray400} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 13.5, color: NW.black, marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.body}</div>
                </div>
              </div>
            );
          })
        )}
      </Card>

      {/* Tasks */}
      <Card pad={18}>
        <CardHead icon="list-checks" title="Tasks" sub={`${open.length} open`} />
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <input style={crmField} value={taskTitle} placeholder="Follow up with Ana on Thursday" onChange={(e) => setTaskTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" style={{ ...crmField, flex: 1 }} value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
            <select style={{ ...crmField, flex: 1 }} value={taskOwner} onChange={(e) => setTaskOwner(e.target.value)}>
              {!staff.some((s) => s.email === actorEmail()) && <option value={actorEmail()}>Me</option>}
              {staff.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
            </select>
          </div>
          <Button size="sm" icon="plus" onClick={addTask} disabled={addingTask || !taskTitle.trim()}>{addingTask ? 'Adding…' : 'Add task'}</Button>
        </div>
        {open.length === 0 && !loading && <div style={{ fontSize: 12.5, color: NW.gray500, padding: '6px 2px' }}>No open tasks.</div>}
        {open.map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggleTask(t)} onDelete={() => removeTask(t)} />)}
        {done.length > 0 && (
          <button onClick={() => setShowDone((v) => !v)} style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: NW.gray500, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
        )}
        {showDone && done.map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggleTask(t)} onDelete={() => removeTask(t)} />)}
      </Card>
    </div>
  );
}

function TaskRow({ t, onToggle, onDelete }: { t: CrmTask; onToggle: () => void; onDelete: () => void }) {
  const due = dueLabel(t.dueDate);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 2px', borderTop: `1px solid ${NW.gray100}` }}>
      <input type="checkbox" checked={t.done} onChange={onToggle} style={{ marginTop: 3, cursor: 'pointer' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: t.done ? NW.gray400 : NW.black, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {!t.done && due.late ? <Pill fg="#C0392B" bg="#FEF0F0">Overdue · {due.text}</Pill> : <span style={{ fontSize: 11.5, color: NW.gray500 }}>{due.text}</span>}
          {t.ownerName && <span style={{ fontSize: 11.5, color: NW.gray500 }}>· {t.ownerName}</span>}
        </div>
      </div>
      <button onClick={onDelete} title="Delete task" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}>
        <Icon name="x" size={13} color={NW.gray400} />
      </button>
    </div>
  );
}
