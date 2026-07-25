'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db, collection, getDocs, doc, setDoc, serverTimestamp } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { generateCode } from '@/lib/utils';
import type { Organization } from '@/lib/types';
import { ChevronLeft, Radar } from 'lucide-react';

export default function NewOpeningPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [form, setForm] = useState({
    title: '',
    orgId: '',
    recruiter: '',
    recruiterEmail: '',
    priority: 'medium',
    skills: '',
    salaryMin: '',
    salaryMax: '',
    currency: 'USD',
    hideSalary: false,
    notifyCandidatesOnPublish: false,
    pipelineType: 'full' as 'full' | 'sourcing',
  });
  const [saving, setSaving] = useState(false);

  // ── Live "reach" estimate as skills are typed ──
  const [reachCount, setReachCount] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);

  useEffect(() => {
    getDocs(collection(db, 'organizations'))
      .then((snap) => setOrgs(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Organization))))
      .catch(() => showToast('Failed to load organizations', 'error'))
      .finally(() => setOrgsLoading(false));
  }, []);

  useEffect(() => {
    const skills = form.skills.split(',').map((s) => s.trim()).filter(Boolean);
    if (skills.length === 0) {
      setReachCount(null);
      setReachLoading(false);
      return;
    }
    // Only apply the latest request's result (guard against out-of-order responses).
    let cancelled = false;
    setReachLoading(true);
    const t = setTimeout(async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Not signed in');
        const res = await fetch('/api/job-match-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ skills, preview: true }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; count?: number };
        if (cancelled) return;
        if (res.ok && data.ok && typeof data.count === 'number') setReachCount(data.count);
      } catch {
        /* best-effort — never block the form */
      } finally {
        if (!cancelled) setReachLoading(false);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.skills]);

  async function handleCreate() {
    if (!form.title.trim() || !form.orgId) {
      showToast('Title and organization are required', 'error');
      return;
    }
    setSaving(true);
    const org = orgs.find((o) => o.id === form.orgId);
    try {
      const code = generateCode('NW');
      const skills = form.skills.split(',').map((s) => s.trim()).filter(Boolean);
      await setDoc(doc(db, 'openings', code), {
        title: form.title.trim(),
        code,
        orgId: form.orgId,
        orgName: org?.name ?? '',
        recruiter: form.recruiter,
        recruiterEmail: form.recruiterEmail,
        priority: form.priority,
        skills,
        salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
        salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
        salaryCurrency: form.currency,
        hideSalary: form.hideSalary,
        notifyCandidatesOnPublish: form.notifyCandidatesOnPublish,
        pipelineType: form.pipelineType,
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
        recruiterEmail: form.recruiterEmail,
        pipelineType: form.pipelineType,
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
              onPick={(opt) => setForm((f) => ({ ...f, recruiterEmail: opt?.email ?? '' }))}
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

          {/* Skills */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Key skills <span className="normal-case font-400">(comma-separated)</span>
            </label>
            <input
              value={form.skills}
              onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
              placeholder="React, TypeScript, Node.js, GraphQL"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--light)]">
              {reachLoading ? (
                <><Spinner size="sm" /> counting…</>
              ) : reachCount === null ? (
                <>Add skills to preview reach</>
              ) : (
                <><Radar className="h-3 w-3" style={{ color: 'var(--green)' }} /> ~{reachCount} candidate{reachCount === 1 ? '' : 's'} match these skills</>
              )}
            </div>
          </div>

          {/* Compensation — flows to the public job board (nearwork.co/jobs) */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Monthly salary <span className="normal-case font-400">(USD, shown on Jobs)</span>
            </label>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                type="number"
                min={0}
                value={form.salaryMin}
                onChange={(e) => setForm((f) => ({ ...f, salaryMin: e.target.value }))}
                placeholder="Min · e.g. 3000"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
              <input
                type="number"
                min={0}
                value={form.salaryMax}
                onChange={(e) => setForm((f) => ({ ...f, salaryMax: e.target.value }))}
                placeholder="Max · e.g. 5000"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2.5 text-sm outline-none focus:border-[var(--green)]"
              >
                <option value="USD">USD</option>
                <option value="COP">COP</option>
                <option value="MXN">MXN</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="mt-2 flex items-start gap-2">
              <input
                id="hideSalary"
                type="checkbox"
                checked={form.hideSalary}
                onChange={(e) => setForm((f) => ({ ...f, hideSalary: e.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
              />
              <label htmlFor="hideSalary" className="text-xs text-[var(--mid)]">
                Hide the amount on the public job board
                <span className="mt-0.5 block text-[11px] text-[var(--light)]">
                  Off is recommended — a visible salary boosts Google for Jobs ranking and applications. When on, the listing shows &quot;Salary on request.&quot;
                </span>
              </label>
            </div>
          </div>

          {/* Engagement type — full recruitment vs sourcing only */}
          <div>
            <label className="mb-1.5 block text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              Engagement type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'full', t: 'Full recruitment', d: 'We run the whole process — source, assess, interview, hand finalists to the client.' },
                { v: 'sourcing', t: 'Sourcing only', d: 'We source & submit; the client runs their own interviews, assessment and hiring.' },
              ] as const).map((opt) => {
                const on = form.pipelineType === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, pipelineType: opt.v }))}
                    className="rounded-lg border p-3 text-left transition-colors"
                    style={{
                      borderColor: on ? 'var(--green)' : 'var(--border)',
                      background: on ? 'var(--green-soft)' : 'white',
                    }}
                  >
                    <div className="text-[13px] font-700" style={{ color: on ? 'var(--green)' : 'var(--black)' }}>{opt.t}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--light)]">{opt.d}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notify candidates on publish */}
          <div className="flex items-start gap-2">
            <input
              id="notifyCandidatesOnPublish"
              type="checkbox"
              checked={form.notifyCandidatesOnPublish}
              onChange={(e) => setForm((f) => ({ ...f, notifyCandidatesOnPublish: e.target.checked }))}
              className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
            />
            <label htmlFor="notifyCandidatesOnPublish" className="text-xs text-[var(--mid)]">
              Notify matching candidates when this role is published
              <span className="mt-0.5 block text-[11px] text-[var(--light)]">
                Off until the role is ready. When on, publishing emails candidates whose skills strongly match.
              </span>
            </label>
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
