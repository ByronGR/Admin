'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { fmtDate, sortByTimestamp, generateCode } from '@/lib/utils';
import type { Opening, Organization, WorkMode } from '@/lib/types';
import { WORK_MODE_LABELS } from '@/lib/types';
import { useAuth } from '@/hooks/use-auth';
import { Search, Plus, X, Edit3, Briefcase, Trash2, CheckCircle, Clock, AlertCircle, ChevronRight, FileText, Globe, ExternalLink } from 'lucide-react';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpeningsPage() {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const router = useRouter();

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
    description: '', requirements: '',
    sourcer: '', recruiter: '', hiringManager: '', accountManager: '',
    priority: 'medium',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'openings')),
      getDocs(collection(db, 'organizations')),
    ]).then(([openSnap, orgSnap]) => {
      setOpenings(sortByTimestamp(openSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)), 'createdAt'));
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
      // Generate the shared opening/pipeline code up front so Admin, Jobs and
      // Talent all reference the same ID (and the kickoff brief can find it).
      const pipelineCode = generateCode('NW');

      const openingRef = await addDoc(collection(db, 'openings'), {
        title: form.title,
        code: pipelineCode,
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
        sourcer: form.sourcer,
        recruiter: form.recruiter,
        hiringManager: form.hiringManager,
        accountManager: form.accountManager || null,
        priority: form.priority,
        status: 'open',
        approvalStatus: 'draft',
        published: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Auto-create a linked pipeline for every new opening
      await addDoc(collection(db, 'pipelines'), {
        code: pipelineCode,
        title: form.title,
        openingId: openingRef.id,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        sourcer: form.sourcer,
        recruiter: form.recruiter,
        hiringManager: form.hiringManager,
        accountManager: form.accountManager || null,
        department: form.department,
        location: form.location,
        status: 'active',
        candidates: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast(`Opening created · Pipeline ${pipelineCode} — opening kick-off brief`, 'success');
      setNewModal(false);
      setForm({
        title: '', orgId: '', orgName: '', department: '', location: '',
        type: 'full_time', salaryMin: '', salaryMax: '', salaryCurrency: 'USD',
        description: '', requirements: '',
        sourcer: '', recruiter: '', hiringManager: '', accountManager: '',
        priority: 'medium',
      });
      // Go straight to the kick-off brief for the new opening so the recruiter can
      // capture the kick-off call before sourcing. The brief is keyed by pipelineCode.
      router.push(`/kickoff?code=${encodeURIComponent(pipelineCode)}`);
      return;
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
          <OpeningDetail opening={selected} orgs={orgs} currentRole={profile?.role} onClose={() => setSelected(null)} onRefresh={async () => {
            const snap = await getDocs(collection(db, 'openings'));
            setOpenings(sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)), 'createdAt'));
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge label={o.status} variant="status" />
                        <ApprovalBadge status={o.approvalStatus} />
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
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Sourcer</label>
            <input
              value={form.sourcer}
              onChange={(e) => setForm((f) => ({ ...f, sourcer: e.target.value }))}
              placeholder="Sourcer name"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
            <StaffPicker
              value={form.recruiter}
              onChange={(name) => setForm((f) => ({ ...f, recruiter: name }))}
              placeholder="Search team for recruiter"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Hiring Manager</label>
            <input
              value={form.hiringManager}
              onChange={(e) => setForm((f) => ({ ...f, hiringManager: e.target.value }))}
              placeholder="Hiring manager name"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Account Manager <span className="normal-case font-400">(optional)</span>
            </label>
            <StaffPicker
              value={form.accountManager}
              onChange={(name) => setForm((f) => ({ ...f, accountManager: name }))}
              placeholder="Search team for account manager"
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

function ApprovalBadge({ status }: { status?: string }) {
  if (!status || status === 'draft') return null;
  if (status === 'pending_review') return (
    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-700 text-amber-700">
      <Clock className="h-2.5 w-2.5" />Review
    </span>
  );
  if (status === 'approved') return (
    <span className="flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-700 text-blue-700">
      <CheckCircle className="h-2.5 w-2.5" />Approved
    </span>
  );
  if (status === 'published') return (
    <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-700 text-green-700">
      <CheckCircle className="h-2.5 w-2.5" />Published
    </span>
  );
  return null;
}

function OpeningDetail({
  opening,
  orgs,
  currentRole,
  onClose,
  onRefresh,
}: {
  opening: Opening;
  orgs: Organization[];
  currentRole?: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editForm, setEditForm] = useState({
    title: opening.title,
    description: opening.description ?? '',
    sourcer: opening.sourcer ?? '',
    recruiter: opening.recruiter ?? '',
    hiringManager: opening.hiringManager ?? '',
    accountManager: opening.accountManager ?? '',
    status: opening.status,
    priority: opening.priority ?? 'medium',
    salaryMin: String(opening.salaryMin ?? ''),
    salaryMax: String(opening.salaryMax ?? ''),
    location: opening.location ?? '',
  });
  const [saving, setSaving] = useState(false);

  // ── Opening sheet (Stage 2) — candidate-facing content ────────────────────
  const [sheet, setSheet] = useState({
    publicSummary: opening.publicSummary ?? opening.description ?? '',
    skills: (opening.skills ?? []).join(', '),
    industry: opening.industry ?? '',
    seniority: opening.seniority ?? '',
    workMode: (opening.workMode ?? (opening.remote ? 'remote' : 'onsite')) as WorkMode,
    city: opening.city ?? opening.location ?? '',
    benefits: opening.benefits ?? '',
  });
  const [sheetSaving, setSheetSaving] = useState(false);

  // Build the denormalized fields jobs.nearwork.co reads, from the sheet.
  function buildSheetFields() {
    const skills = sheet.skills.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      publicSummary: sheet.publicSummary.trim(),
      skills,
      industry: sheet.industry.trim(),
      seniority: sheet.seniority.trim(),
      workMode: sheet.workMode,
      city: sheet.city.trim(),
      benefits: sheet.benefits.trim(),
      // Jobs-schema mirrors:
      currency: opening.salaryCurrency ?? 'USD',
      wfh: WORK_MODE_LABELS[sheet.workMode],
      exp: sheet.seniority.trim(),
      'sb-exp': sheet.seniority.trim(),
    };
  }

  const sheetReady =
    sheet.publicSummary.trim().length > 0 &&
    sheet.skills.split(',').some((s) => s.trim());

  async function saveSheet() {
    setSheetSaving(true);
    try {
      const fields = buildSheetFields();
      await updateDoc(doc(db, 'openings', opening.id), {
        ...fields,
        updatedAt: serverTimestamp(),
      });
      showToast(
        opening.published ? 'Opening sheet saved & live listing updated' : 'Opening sheet saved',
        'success',
      );
      await onRefresh();
    } catch {
      showToast('Failed to save opening sheet', 'error');
    } finally {
      setSheetSaving(false);
    }
  }

  // Publish → write the Jobs projection so jobs.nearwork.co shows the role.
  async function publishToJobs() {
    if (!sheetReady) {
      showToast('Add a public summary and at least one skill before publishing', 'error');
      return;
    }
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        ...buildSheetFields(),
        published: true,
        publishedAt: serverTimestamp(),
        approvalStatus: 'published',
        status: 'open',
        code: opening.code ?? opening.id,
        updatedAt: serverTimestamp(),
      });
      showToast('Published to jobs.nearwork.co', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to publish', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  // Unpublish → pull the role from jobs.nearwork.co (URL stays, Apply disabled).
  async function unpublish() {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        published: false,
        approvalStatus: 'approved',
        updatedAt: serverTimestamp(),
      });
      showToast('Removed from jobs.nearwork.co', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to unpublish', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      // Paused / cancelled / filled openings must not stay live on Jobs.
      const goneFromJobs = ['paused', 'cancelled', 'filled'].includes(editForm.status);
      await updateDoc(doc(db, 'openings', opening.id), {
        title: editForm.title,
        location: editForm.location,
        description: editForm.description,
        sourcer: editForm.sourcer,
        recruiter: editForm.recruiter,
        hiringManager: editForm.hiringManager,
        accountManager: editForm.accountManager || null,
        status: editForm.status,
        priority: editForm.priority,
        salaryMin: editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax: editForm.salaryMax ? Number(editForm.salaryMax) : null,
        ...(goneFromJobs && opening.published ? { published: false } : {}),
        updatedAt: serverTimestamp(),
      });
      showToast(
        goneFromJobs && opening.published
          ? 'Opening updated · removed from jobs.nearwork.co'
          : 'Opening updated',
        'success',
      );
      setEditing(false);
      await onRefresh();
    } catch {
      showToast('Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'openings', opening.id));
      showToast('Opening deleted', 'success');
      await onRefresh();
      onClose();
    } catch {
      showToast('Failed to delete opening', 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function updateApproval(newStatus: string) {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        approvalStatus: newStatus,
        updatedAt: serverTimestamp(),
      });
      showToast(
        newStatus === 'pending_review' ? 'Submitted for review' :
        newStatus === 'approved' ? 'Opening approved' :
        newStatus === 'published' ? 'Opening published' : 'Status updated',
        'success',
      );
      await onRefresh();
    } catch {
      showToast('Failed to update approval status', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  const org = orgs.find((o) => o.id === opening.orgId);
  const approvalStatus = opening.approvalStatus ?? 'draft';
  const isAdmin = currentRole === 'super_admin' || currentRole === 'admin';

  const APPROVAL_STEPS = ['draft', 'pending_review', 'approved', 'published'] as const;
  const stepIdx = APPROVAL_STEPS.indexOf(approvalStatus as typeof APPROVAL_STEPS[number]);

  return (
    <div className="space-y-4">
      {/* Approval flow bar */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Step indicators */}
          <div className="flex items-center gap-1">
            {([
              { key: 'draft', label: 'Draft' },
              { key: 'pending_review', label: 'In Review' },
              { key: 'approved', label: 'Approved' },
              { key: 'published', label: 'Published' },
            ] as const).map((step, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={step.key} className="flex items-center gap-1">
                  <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-700 ${
                    done ? 'bg-green-100 text-green-700' :
                    active ? 'bg-[var(--green)] text-white' :
                    'bg-[var(--bg)] text-[var(--light)]'
                  }`}>
                    {done && <CheckCircle className="h-3 w-3" />}
                    {active && step.key === 'pending_review' && <Clock className="h-3 w-3" />}
                    {active && step.key === 'draft' && <AlertCircle className="h-3 w-3" />}
                    {step.label}
                  </div>
                  {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />}
                </div>
              );
            })}
          </div>

          {/* Action button */}
          <div className="flex items-center gap-2">
            {approvalStatus === 'draft' && (
              <button
                onClick={() => updateApproval('pending_review')}
                disabled={approvalSaving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {approvalSaving ? <Spinner size="sm" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Submit for review
              </button>
            )}
            {approvalStatus === 'pending_review' && isAdmin && (
              <button
                onClick={() => updateApproval('approved')}
                disabled={approvalSaving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {approvalSaving ? <Spinner size="sm" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Approve opening
              </button>
            )}
            {approvalStatus === 'pending_review' && !isAdmin && (
              <span className="text-xs text-[var(--light)]">Awaiting admin approval</span>
            )}
            {approvalStatus === 'approved' && (
              <div className="flex items-center gap-2">
                {!sheetReady && (
                  <span className="text-[10px] text-[var(--light)]">Fill the opening sheet first</span>
                )}
                <button
                  onClick={publishToJobs}
                  disabled={approvalSaving || !sheetReady}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-50"
                  style={{ background: 'var(--green)' }}
                >
                  {approvalSaving ? <Spinner size="sm" /> : <Globe className="h-3.5 w-3.5" />}
                  Publish to Jobs
                </button>
              </div>
            )}
            {approvalStatus === 'published' && (
              <div className="flex items-center gap-2">
                <a
                  href={`https://jobs.nearwork.co/apply.html?code=${opening.code ?? opening.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--green)] hover:border-[var(--green)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on Jobs
                </a>
                <button
                  onClick={unpublish}
                  disabled={approvalSaving}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-red-300 hover:text-red-600 disabled:opacity-60"
                >
                  {approvalSaving ? <Spinner size="sm" /> : <X className="h-3.5 w-3.5" />}
                  Unpublish
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
        <div className="flex items-center gap-2 flex-wrap">
          <Badge label={opening.status} variant="status" />
          <button
            onClick={() => setEditing((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 font-500">Delete this opening?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-[var(--mid)] hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-500 hover:border-red-400 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="grid gap-4 sm:grid-cols-3 text-xs">
          {[
            { label: 'Location', value: opening.location },
            { label: 'Type', value: opening.type?.replace('_', ' ') },
            { label: 'Priority', value: opening.priority },
            { label: 'Salary', value: opening.salaryMin && opening.salaryMax ? `$${opening.salaryMin}–$${opening.salaryMax}/mo` : '—' },
            { label: 'Sourcer', value: opening.sourcer },
            { label: 'Recruiter', value: opening.recruiter },
            { label: 'Hiring Manager', value: opening.hiringManager },
            { label: 'Account Manager', value: opening.accountManager },
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
            { key: 'sourcer', label: 'Sourcer' },
            { key: 'hiringManager', label: 'Hiring Manager' },
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
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
            <StaffPicker
              compact
              value={editForm.recruiter}
              onChange={(name) => setEditForm((f) => ({ ...f, recruiter: name }))}
              placeholder="Search team for recruiter"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Account Manager (optional)</label>
            <StaffPicker
              compact
              value={editForm.accountManager}
              onChange={(name) => setEditForm((f) => ({ ...f, accountManager: name }))}
              placeholder="Search team for account manager"
            />
          </div>
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

      {/* ── Opening sheet (Stage 2) — public listing on jobs.nearwork.co ─────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="mb-4 flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
          >
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-700 text-[var(--black)]">Opening sheet</h3>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              The public, candidate-facing listing shown on jobs.nearwork.co. Fill it in, then publish.
            </p>
          </div>
          {opening.published && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-700 text-green-700">
              <Globe className="h-3 w-3" />Live
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Public summary <span className="text-red-500">*</span>
            </label>
            <textarea
              value={sheet.publicSummary}
              onChange={(e) => setSheet((s) => ({ ...s, publicSummary: e.target.value }))}
              rows={4}
              placeholder="What the role is, who it's for, and why it's exciting — written for candidates."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Skills <span className="text-red-500">*</span> <span className="normal-case font-400">(comma-separated)</span>
            </label>
            <input
              value={sheet.skills}
              onChange={(e) => setSheet((s) => ({ ...s, skills: e.target.value }))}
              placeholder="React, TypeScript, Node.js, GraphQL"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Industry</label>
            <input
              value={sheet.industry}
              onChange={(e) => setSheet((s) => ({ ...s, industry: e.target.value }))}
              placeholder="SaaS / Fintech"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Seniority</label>
            <input
              value={sheet.seniority}
              onChange={(e) => setSheet((s) => ({ ...s, seniority: e.target.value }))}
              placeholder="Mid / Senior / Lead"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Work mode</label>
            <select
              value={sheet.workMode}
              onChange={(e) => setSheet((s) => ({ ...s, workMode: e.target.value as WorkMode }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((m) => (
                <option key={m} value={m}>{WORK_MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City</label>
            <input
              value={sheet.city}
              onChange={(e) => setSheet((s) => ({ ...s, city: e.target.value }))}
              placeholder="Bogotá"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Benefits</label>
            <textarea
              value={sheet.benefits}
              onChange={(e) => setSheet((s) => ({ ...s, benefits: e.target.value }))}
              rows={2}
              placeholder="Health insurance, remote stipend, learning budget…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={saveSheet}
            disabled={sheetSaving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {sheetSaving ? <Spinner size="sm" /> : <FileText className="h-3.5 w-3.5" />}
            Save sheet
          </button>
          {!sheetReady && (
            <span className="text-[10px] text-[var(--light)]">
              Public summary + at least one skill are required to publish.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
