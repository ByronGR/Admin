'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { sortByTimestamp, generateCode } from '@/lib/utils';
import type { Opening, Organization } from '@/lib/types';
import { useAuth } from '@/hooks/use-auth';
import { ApprovalBadge } from './opening-detail';
import { Search, Plus, ChevronRight } from 'lucide-react';

export default function OpeningsPage() {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const router = useRouter();

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    title: '', orgId: '', recruiter: '', priority: 'medium',
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
      // The opening's Firestore doc ID = the pipeline code (NW-XXXXXX).
      // This single ID is shared across Admin, Jobs, and Talent.
      const code = generateCode('NW');

      await setDoc(doc(db, 'openings', code), {
        title: form.title,
        code,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        recruiter: form.recruiter,
        priority: form.priority,
        status: 'draft',
        approvalStatus: 'draft',
        published: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'pipelines', code), {
        code,
        title: form.title,
        openingId: code,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        recruiter: form.recruiter,
        status: 'active',
        candidates: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewModal(false);
      setForm({ title: '', orgId: '', recruiter: '', priority: 'medium' });
      // Go straight to the kick-off brief so the recruiter captures the role details.
      router.push(`/kickoff?code=${encodeURIComponent(code)}`);
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
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Openings</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {openings.length} opening{openings.length !== 1 ? 's' : ''} across all organizations
            </p>
          </div>
          <button
            onClick={() => setNewModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
            style={{ background: 'var(--green)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            New opening
          </button>
        </div>

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
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <div>Opening</div>
              <div>ID</div>
              <div>Organization</div>
              <div>Recruiter</div>
              <div>Status</div>
              <div />
            </div>
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--light)]">
                No openings found.
              </div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                  onClick={() => router.push(`/openings/${o.code ?? o.id}`)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-600 text-[var(--black)]">{o.title}</p>
                    <p className="text-[10px] text-[var(--light)]">
                      {o.department ?? '—'} · {o.location ?? 'Remote'}
                    </p>
                  </div>
                  <div className="text-[10px] font-600 text-[var(--mid)] font-mono">{o.code ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{o.orgName ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{o.recruiter ?? '—'}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge label={o.status} variant="status" />
                    <ApprovalBadge status={o.approvalStatus} />
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* New opening modal — title + org only; detail captured in kickoff brief */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="New opening">
        <p className="mb-4 text-xs text-[var(--light)]">
          After creating the opening you'll be taken straight to the kick-off brief to capture the role details.
        </p>
        <div className="grid gap-4">
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Job title *</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Customer Success Manager"
              autoFocus
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
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
            <StaffPicker
              value={form.recruiter}
              onChange={(name) => setForm((f) => ({ ...f, recruiter: name }))}
              placeholder="Search team for recruiter"
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
            Create → Go to kick-off brief
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}
