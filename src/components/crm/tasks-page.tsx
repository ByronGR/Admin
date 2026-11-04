'use client';

// ============================================================
// Tasks (/tasks) — HubSpot-style task queue across every company:
// Overdue, Due today, Upcoming and No due date, for me or the whole team.
// Firestore: crmTasks.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, collection, getDocs } from '@/lib/firebase';
import { NW, Button } from '@/components/nw/primitives';
import { PageHeader, Card, SegTabs } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { useToast } from '@/components/ui/toast';
import { actorEmail, todayIso } from '@/lib/crm';
import type { CrmTask } from '@/lib/types';
import { Empty, Stat, saveErrorMessage } from './ui';
import { TaskModal, TaskRow, toggleTaskDone } from './timeline';

type Who = 'mine' | 'all';
type Status = 'open' | 'done';

export default function TasksPage() {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState<Who>('mine');
  const [status, setStatus] = useState<Status>('open');
  const [editing, setEditing] = useState<CrmTask | 'new' | null>(null);

  const reload = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'crmTasks'));
      setTasks(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as CrmTask));
    } catch (e) {
      console.error('[tasks] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const me = actorEmail();
  const today = todayIso();
  const scoped = useMemo(() => (who === 'mine' ? tasks.filter((t) => t.ownerEmail === me) : tasks), [tasks, who, me]);
  const open = scoped.filter((t) => !t.done);
  const byDue = (a: CrmTask, b: CrmTask) => `${a.dueDate || '9999'}${a.dueTime || ''}`.localeCompare(`${b.dueDate || '9999'}${b.dueTime || ''}`);
  const groups = [
    { title: 'Overdue', items: open.filter((t) => t.dueDate && t.dueDate < today).sort(byDue), color: '#C0392B' },
    { title: 'Due today', items: open.filter((t) => t.dueDate === today).sort(byDue), color: NW.teal700 },
    { title: 'Upcoming', items: open.filter((t) => t.dueDate && t.dueDate > today).sort(byDue), color: NW.gray600 },
    { title: 'No due date', items: open.filter((t) => !t.dueDate), color: NW.gray500 },
  ];
  const done = scoped.filter((t) => t.done).sort((a, b) => (b.doneAt?.seconds ?? 0) - (a.doneAt?.seconds ?? 0));

  async function toggle(t: CrmTask) {
    try {
      await toggleTaskDone(t);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  return (
    <MainLayout>
      <PageHeader
        overline="Sales"
        title="Tasks"
        subtitle="Every follow-up across all companies and deals."
        actions={<Button icon="plus" onClick={() => setEditing('new')}>Create task</Button>}
      />
      <Card pad={18} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>
          <Stat label="Overdue" value={groups[0].items.length} color={groups[0].items.length ? '#C0392B' : NW.gray400} />
          <Stat label="Due today" value={groups[1].items.length} color={groups[1].items.length ? NW.teal700 : NW.gray400} />
          <Stat label="Upcoming" value={groups[2].items.length} />
          <Stat label="Open" value={open.length} />
        </div>
      </Card>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <SegTabs tabs={[{ id: 'mine', label: 'My tasks' }, { id: 'all', label: 'All tasks' }]} active={who} onChange={setWho} />
        <SegTabs tabs={[{ id: 'open', label: 'Open', count: open.length }, { id: 'done', label: 'Completed', count: done.length }]} active={status} onChange={setStatus} />
      </div>
      <Card pad={18}>
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500 }}>Loading tasks…</div>
        ) : status === 'done' ? (
          done.length === 0 ? <Empty icon="check-square" title="Nothing completed yet" /> : done.map((t) => (
            <TaskRow key={t.id} t={t} showCompany onToggle={() => toggle(t)} onOpen={() => setEditing(t)} />
          ))
        ) : open.length === 0 ? (
          <Empty icon="check-square" title="All clear" sub={who === 'mine' ? 'No open tasks assigned to you.' : 'No open tasks.'} action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>Create task</Button>} />
        ) : (
          groups.filter((g) => g.items.length).map((g) => (
            <div key={g.title} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: g.color, padding: '6px 0' }}>
                {g.title} · {g.items.length}
              </div>
              {g.items.map((t) => <TaskRow key={t.id} t={t} showCompany onToggle={() => toggle(t)} onOpen={() => setEditing(t)} />)}
            </div>
          ))
        )}
      </Card>
      {editing && (
        <TaskModal
          task={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </MainLayout>
  );
}
