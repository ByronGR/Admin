'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs, doc, setDoc, serverTimestamp } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { generateCode } from '@/lib/utils';
import type { Organization } from '@/lib/types';
import { ChevronLeft } from 'lucide-react';

export default function NewOpeningPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [form, setForm] = useState({ title: '', orgId: '', recruiter: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization))))
      .catch(() => showToast('Failed to load organizations', 'error'))
      .finally(() => setOrgsLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.title.trim() || !form.orgId) {
      showToast('Title and organization are required', 'error');
      return;
    }
    setSaving(true);
    const org = orgs.find((o) => o.id === form.orgId);
    try {
      const code = generateCode('NW');
      await setDoc(doc(db, 'openings', code), {
        title: form.title.trim(),
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
        title: form.title.trim(),
        openingId: code,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        recruiter: form.recruiter,
        status: 'active',
        candidates: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.push(`/kickoff?code=${encodeURIComponent(code)}`);
    } catch {
      showToast('Failed to create opening', 'error');
      setSaving(false);
    }
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-xl space-y-6">
        {/* Back */}
        <button
          onClick={() => router.push('/openings')}
          className="flex items-center gap-1 text-xs text-[var(--light)] hover:text-[var(--green)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All openings
        </button>

        <div>
          <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">New opening</h1>
          <p className="mt-1 text-xs text-[var(--light)]">
            After creating the opening you'll go straight to the kick-off brief to capture the role details.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Job title <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Customer Success Manager"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>

          {/* Organization */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Organization <span className="text-red-500">*</span>
            </label>
            {orgsLoading ? (
              <div className="flex h-10 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : (
              <select
                value={form.orgId}
                onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
              >
                <option value="">Select organization…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Recruiter */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Recruiter
            </label>
            <StaffPicker
              value={form.recruiter}
              onChange={(name) => setForm((f) => ({ ...f, recruiter: name }))}
              placeholder="Search team…"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Priority
            </label>
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

        <div className="flex gap-3">
          <button
            onClick={() => router.push('/openings')}
            className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-500 text-[var(--mid)] hover:border-[var(--green)]"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !form.title.trim() || !form.orgId}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-600 text-white disabled:opacity-50"
            style={{ background: 'var(--green)' }}
          >
            {saving ? <Spinner size="sm" /> : null}
            {saving ? 'Creating…' : 'Create opening → Go to kick-off brief'}
          </button>
        </div>
      </div>
    </MainLayout>
  );
}
