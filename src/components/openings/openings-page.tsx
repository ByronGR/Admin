'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate } from '@/lib/utils';
import type { Opening, Organization } from '@/lib/types';
import { Search, Plus, X, Edit3, Briefcase } from 'lucide-react';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpeningsPage() {
  const { showToast } = useToast();

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Opening | null>(null);

  // New opening modal
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    title: '', orgId: '', orgName: '', department: '', location: '',
    type: 'full_time', salaryMin: '', salaryMax: '', salaryCurrency: 'USD',
    description: '', requirements: '', recruiter: '', priority: 'medium',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'openings'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'organizations')),
    ]).then(([openSnap, orgSnap]) => {
      setOpenings(openSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
      setOrgs(orgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization)));
      setLoading(false);
    }).catch(() => {
      showToast('Failed to load openings', 'error');
      setLoading(false);
    });
  }, []);

  const filtered = openings.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.title, o.orgName, o.recruiter, o.department].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function saveOpening() {
    if (!form.title || !form.orgId) {
      showToast('Title and organization are required', 'error');
      return;
    }
    setSaving(true);
    const org = orgs.find((o) => o.id === form.orgId);
    try {
      await addDoc(collection(db, 'openings'), {
        title: form.title,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        department: form.department,
        location: form.location,
        type: form.type,
        salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
        salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
        salaryCurrency: form.salaryCurrency,
        description: form.description,
        requirements: form.requirements.split('\n').filter(Boolean),
        recruiter: form.recruiter,
        priority: form.priority,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Opening created', 'success');
      setNewModal(false);
      // Reload
      const snap = await getDocs(query(collection(db, 'openings'), orderBy('createdAt', 'desc')));
      setOpenings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
    } catch {
      showToast('Failed to create opening', 'error');
    } finally {
      setSaving(false);
    }
  }

  const priorityColors: Record<string, string> = {
    urgent: 'text-red-600',
    high: 'text-amber-600',
    medium: 'text-blue-600',
    low: 'text-gray-500',
  };

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              {selected ? selected.title : 'Openings'}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {selected
                ? `${selected.orgName ?? '—'} · ${selected.status}`
                : `${openings.length} opening${openings.length !== 1 ? 's' : ''} across all organizations`}
            </p>
          </div>
          <div className="flex gap-2">
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <X className="h-3.5 w-3.5" />
                All openings
              </button>
            )}
            {!selected && (
              <button
                onClick={() => setNewModal(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                New opening
              </button>
            )}
          </div>
        </div>

        {selected ? (
          <OpeningDetail opening={selected} orgs={orgs} onClose={() => setSelected(null)} onRefresh={async () => {
            const snap = await getDocs(query(collection(db, 'openings'), orderBy('createdAt', 'desc')));
            setOpenings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
          }} />
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search openings..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="paused">Paused</option>
                <option value="filled">Filled</option>
                <option value="cancelled">Cancelled</option>
                <option value="draft">Draft</option>
              </select>
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div>Opening</div>
                  <div>Organization</div>
                  <div>Recruiter</div>
                  <div>Priority</div>
                  <div>Status</div>
                </div>
                {filtered.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">
                    No openings found.
                  </div>
                ) : (
                  filtered.map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                      onClick={() => setSelected(o)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-600 text-[var(--black)]">{o.title}</p>
                        <p className="text-[10px] text-[var(--light)]">
                          {o.department ?? '—'} · {o.location ?? 'Remote'}
                        </p>
                      </div>
                      <div className="text-xs text-[var(--mid)]">{o.orgName ?? '—'}</div>
                      <div className="text-xs text-[var(--mid)]">{o.recruiter ?? '—'}</div>
                      <div className={`text-xs font-600 capitalize ${priorityColors[o.priority ?? 'medium'] ?? 'text-[var(--mid)]'}`}>
                        {o.priority ?? 'medium'}
                      </div>
                      <div>
                        <Badge label={o.status} variant="status" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* New opening modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="New opening" size="xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Title *</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Customer Success Manager"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Organization *</label>
            <select
              value={form.orgId}
              onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              <option value="">Select organization...</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Department</label>
            <input
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              placeholder="Sales"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="Remote / Bogotá"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
            <input
              value={form.recruiter}
              onChange={(e) => setForm((f) => ({ ...f, recruiter: e.target.value }))}
              placeholder="Recruiter name"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Salary (min) USD</label>
            <input
              type="number"
              value={form.salaryMin}
              onChange={(e) => setForm((f) => ({ ...f, salaryMin: e.target.value }))}
              placeholder="1500"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Salary (max) USD</label>
            <input
              type="number"
              value={form.salaryMax}
              onChange={(e) => setForm((f) => ({ ...f, salaryMax: e.target.value }))}
              placeholder="2500"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Priority</label>
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Role description..."
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setNewModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
            Cancel
          </button>
          <button
            onClick={saveOpening}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {saving && <Spinner size="sm" />}
            Create opening
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}

// ─── Opening detail ───────────────────────────────────────────────────────────

function OpeningDetail({
  opening,
  orgs,
  onClose,
  onRefresh,
}: {
  opening: Opening;
  orgs: Organization[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: opening.title,
    description: opening.description ?? '',
    recruiter: opening.recruiter ?? '',
    status: opening.status,
    priority: opening.priority ?? 'medium',
    salaryMin: String(opening.salaryMin ?? ''),
    salaryMax: String(opening.salaryMax ?? ''),
    location: opening.location ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        ...editForm,
        salaryMin: editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax: editForm.salaryMax ? Number(editForm.salaryMax) : null,
        updatedAt: serverTimestamp(),
      });
      showToast('Opening updated', 'success');
      setEditing(false);
      await onRefresh();
    } catch {
      showToast('Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  }

  const org = orgs.find((o) => o.id === opening.orgId);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
      <div className="mb-5 flex items-center gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-lg"
          style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
        >
          <Briefcase className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-700 text-[var(--black)]">{opening.title}</h2>
          <p className="text-xs text-[var(--light)]">
            {org?.name ?? opening.orgName ?? '—'} · {opening.department ?? 'General'}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge label={opening.status} variant="status" />
          <button
            onClick={() => setEditing((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>
      </div>

      {!editing ? (
        <div className="grid gap-4 sm:grid-cols-3 text-xs">
          {[
            { label: 'Location', value: opening.location },
            { label: 'Type', value: opening.type?.replace('_', ' ') },
            { label: 'Priority', value: opening.priority },
            { label: 'Salary', value: opening.salaryMin && opening.salaryMax ? `$${opening.salaryMin}–$${opening.salaryMax}/mo` : '—' },
            { label: 'Recruiter', value: opening.recruiter },
            { label: 'Created', value: fmtDate(opening.createdAt) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</p>
              <p className="mt-0.5 capitalize text-[var(--black)]">{value ?? '—'}</p>
            </div>
          ))}
          {opening.description && (
            <div className="sm:col-span-3">
              <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Description</p>
              <p className="mt-0.5 text-[var(--mid)]">{opening.description}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { key: 'title', label: 'Title' },
            { key: 'location', label: 'Location' },
            { key: 'recruiter', label: 'Recruiter' },
            { key: 'salaryMin', label: 'Salary min', type: 'number' },
            { key: 'salaryMax', label: 'Salary max', type: 'number' },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</label>
              <input
                type={type ?? 'text'}
                value={(editForm as Record<string, string>)[key]}
                onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
            <select
              value={editForm.status}
              onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Opening['status'] }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
            >
              <option value="open">Open</option>
              <option value="paused">Paused</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Description</label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
            />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {saving && <Spinner size="sm" />}
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
