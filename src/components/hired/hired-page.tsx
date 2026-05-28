'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtCurrency, sortByTimestamp } from '@/lib/utils';
import type { Placement, ContractorProfile, PerformanceReview } from '@/lib/types';
import {
  Search, Plus, Trophy, Shield, DollarSign, X, Calendar,
  Star, Briefcase, Heart, ChevronRight, Edit3,
} from 'lucide-react';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HiredPage() {
  const { showToast } = useToast();

  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [guaranteeFilter, setGuaranteeFilter] = useState('');
  const [tab, setTab] = useState<'placements' | 'payroll' | 'referral'>('placements');
  const [selected, setSelected] = useState<Placement | null>(null);

  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    candidateName: '', candidateEmail: '', orgName: '', openingTitle: '',
    pipelineCode: '', startDate: '', salaryAmount: '', salaryCurrency: 'USD',
    guaranteeDays: '90', referralSource: '', referralFee: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'placements'));
      setPlacements(sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)), 'createdAt'));
    } catch {
      showToast('Failed to load placements', 'error');
    } finally {
      setLoading(false);
    }
  }

  function guaranteeStatus(p: Placement): { label: string; variant: 'green' | 'amber' | 'red' | 'neutral' } {
    if (!p.guaranteeEndDate && !p.guaranteeDays) return { label: 'N/A', variant: 'neutral' };
    const end = p.guaranteeEndDate
      ? new Date(p.guaranteeEndDate)
      : p.startDate
        ? new Date(new Date(p.startDate).getTime() + (p.guaranteeDays ?? 90) * 86400000)
        : null;
    if (!end) return { label: 'N/A', variant: 'neutral' };
    const now = new Date();
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
    if (daysLeft < 0) return { label: 'Expired', variant: 'red' };
    if (daysLeft <= 14) return { label: `${daysLeft}d left`, variant: 'amber' };
    return { label: `${daysLeft}d left`, variant: 'green' };
  }

  const filtered = placements.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [p.candidateName, p.orgName, p.openingTitle, p.pipelineCode].join(' ').toLowerCase().includes(q);
    if (guaranteeFilter === 'active') {
      const gs = guaranteeStatus(p);
      return matchSearch && gs.label !== 'Expired' && gs.label !== 'N/A';
    }
    if (guaranteeFilter === 'expired') {
      const gs = guaranteeStatus(p);
      return matchSearch && gs.label === 'Expired';
    }
    return matchSearch;
  });

  async function savePlacement() {
    if (!form.candidateName || !form.orgName || !form.startDate) {
      showToast('Candidate, org, and start date are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const guaranteeEndDate = form.startDate && form.guaranteeDays
        ? new Date(new Date(form.startDate).getTime() + Number(form.guaranteeDays) * 86400000).toISOString().slice(0, 10)
        : undefined;
      await addDoc(collection(db, 'placements'), {
        candidateName: form.candidateName,
        candidateEmail: form.candidateEmail,
        orgName: form.orgName,
        orgId: '',
        openingTitle: form.openingTitle,
        pipelineCode: form.pipelineCode,
        startDate: form.startDate,
        salaryAmount: form.salaryAmount ? Number(form.salaryAmount) : 0,
        salaryCurrency: form.salaryCurrency,
        guaranteeDays: form.guaranteeDays ? Number(form.guaranteeDays) : 90,
        guaranteeEndDate,
        referralSource: form.referralSource,
        referralFee: form.referralFee ? Number(form.referralFee) : null,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Placement recorded', 'success');
      setNewModal(false);
      load();
    } catch {
      showToast('Failed to save placement', 'error');
    } finally {
      setSaving(false);
    }
  }

  const activeCount = placements.filter((p) => p.status === 'active').length;
  const atRiskCount = placements.filter((p) => {
    const gs = guaranteeStatus(p);
    return gs.label.includes('d left') && parseInt(gs.label) <= 14;
  }).length;
  const totalSalary = placements
    .filter((p) => p.salaryCurrency === 'USD' && p.status === 'active')
    .reduce((s, p) => s + (p.salaryAmount ?? 0), 0);

  if (selected) {
    return (
      <MainLayout>
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <X className="h-3.5 w-3.5" />
              All placements
            </button>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              {selected.candidateName ?? 'Contractor'}
            </h1>
            <p className="text-xs text-[var(--light)]">{selected.orgName}</p>
          </div>
          <ContractorDetail placement={selected} />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Hired</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              Placement tracking, contractor profiles, and guarantee periods.
            </p>
          </div>
          <button
            onClick={() => setNewModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
            style={{ background: 'var(--green)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            New placement
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Active placements', value: activeCount, icon: <Trophy className="h-5 w-5" />, dark: true },
            { label: 'Guarantees at risk', value: atRiskCount, icon: <Shield className="h-5 w-5" /> },
            { label: 'Monthly payroll (USD)', value: `$${totalSalary.toLocaleString()}`, icon: <DollarSign className="h-5 w-5" /> },
          ].map(({ label, value, icon, dark }) => (
            <div
              key={label}
              className={`rounded-2xl p-5 ${dark ? 'text-white' : 'border border-[var(--border)] bg-white'}`}
              style={dark ? { background: 'var(--black)' } : {}}
            >
              <div className={`mb-2 flex items-center gap-2 text-xs font-500 ${dark ? 'text-white/60' : 'text-[var(--light)]'}`}>
                {icon}{label}
              </div>
              <div className={`text-2xl font-800 ${dark ? 'text-white' : 'text-[var(--black)]'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 w-fit">
          {(['placements', 'payroll', 'referral'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-600 capitalize transition-colors ${
                tab === t ? 'bg-white text-[var(--black)] shadow-sm' : 'text-[var(--light)] hover:text-[var(--mid)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate, company, role..."
              className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
            />
          </div>
          {tab === 'placements' && (
            <select
              value={guaranteeFilter}
              onChange={(e) => setGuaranteeFilter(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
            >
              <option value="">All guarantees</option>
              <option value="active">Active guarantee</option>
              <option value="expired">Expired</option>
            </select>
          )}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : tab === 'placements' ? (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_24px] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <div>Candidate</div>
              <div>Organization</div>
              <div>Start date</div>
              <div>Salary</div>
              <div>Guarantee</div>
              <div></div>
            </div>
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--light)]">No placements found.</div>
            ) : (
              filtered.map((p) => {
                const gs = guaranteeStatus(p);
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_24px] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                    onClick={() => setSelected(p)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</p>
                      <p className="truncate text-[10px] text-[var(--light)]">{p.openingTitle ?? '—'}</p>
                    </div>
                    <div className="text-xs text-[var(--mid)]">{p.orgName ?? '—'}</div>
                    <div className="text-xs text-[var(--mid)]">{fmtDate(p.startDate)}</div>
                    <div className="text-xs font-600 text-[var(--black)]">
                      {fmtCurrency(p.salaryAmount, p.salaryCurrency)}
                    </div>
                    <div>
                      {gs.label !== 'N/A' ? (
                        <Badge label={gs.label} variant={gs.variant === 'neutral' ? 'neutral' : gs.variant} className="text-[9px]" />
                      ) : (
                        <span className="text-[10px] text-[var(--light)]">N/A</span>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />
                  </div>
                );
              })
            )}
          </div>
        ) : tab === 'referral' ? (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <div>Candidate</div>
              <div>Organization</div>
              <div>Referral source</div>
              <div>Referral fee</div>
            </div>
            {placements.filter((p) => p.referralSource).length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--light)]">No referral data yet.</div>
            ) : (
              placements.filter((p) => p.referralSource).map((p) => (
                <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <div className="text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{p.orgName ?? '—'}</div>
                  <div className="text-xs text-[var(--mid)]">{p.referralSource}</div>
                  <div className="text-xs font-600 text-[var(--black)]">
                    {p.referralFee ? fmtCurrency(p.referralFee) : '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-white py-16 text-center">
            <p className="text-sm text-[var(--light)]">Payroll register — coming soon.</p>
          </div>
        )}
      </div>

      {/* New placement modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="New placement" size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { key: 'candidateName', label: 'Candidate name *', placeholder: 'Jane Smith' },
            { key: 'candidateEmail', label: 'Candidate email', placeholder: 'jane@example.com', type: 'email' },
            { key: 'orgName', label: 'Organization *', placeholder: 'Acme Inc.' },
            { key: 'openingTitle', label: 'Role title', placeholder: 'CSM' },
            { key: 'pipelineCode', label: 'Pipeline code', placeholder: 'PL-1234' },
            { key: 'startDate', label: 'Start date *', type: 'date' },
            { key: 'salaryAmount', label: 'Monthly salary (USD)', type: 'number', placeholder: '2000' },
            { key: 'guaranteeDays', label: 'Guarantee period (days)', type: 'number', placeholder: '90' },
            { key: 'referralSource', label: 'Referral source', placeholder: 'LinkedIn / Internal' },
            { key: 'referralFee', label: 'Referral fee (USD)', type: 'number', placeholder: '500' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</label>
              <input
                type={type ?? 'text'}
                value={(form as Record<string, string>)[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setNewModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          <button
            onClick={savePlacement}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {saving && <Spinner size="sm" />}
            Save placement
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}

// ─── Contractor detail ────────────────────────────────────────────────────────

function ContractorDetail({ placement }: { placement: Placement }) {
  const { showToast } = useToast();
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewForm, setReviewForm] = useState({ period: '', score: '4', feedback: '' });
  const [addingReview, setAddingReview] = useState(false);

  const [editForm, setEditForm] = useState({
    ptoDaysPerYear: '',
    ptoUsed: '',
    rolScore: '',
    rolFeedback: '',
    isEOR: false,
    eorProvider: '',
    status: 'active',
  });

  useEffect(() => {
    loadProfile();
  }, [placement.id]);

  async function loadProfile() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'contractors'), where('placementId', '==', placement.id)));
      if (!snap.empty) {
        const data = { id: snap.docs[0].id, ...snap.docs[0].data() } as ContractorProfile;
        setProfile(data);
        setEditForm({
          ptoDaysPerYear: String(data.ptoDaysPerYear ?? 15),
          ptoUsed: String(data.ptoUsed ?? 0),
          rolScore: String(data.rolScore ?? 75),
          rolFeedback: data.rolFeedback ?? '',
          isEOR: data.isEOR ?? false,
          eorProvider: data.eorProvider ?? '',
          status: data.status ?? 'active',
        });
      }
    } catch {
      showToast('Failed to load contractor profile', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createProfile() {
    setSaving(true);
    try {
      const data: Partial<ContractorProfile> = {
        candidateName: placement.candidateName,
        candidateEmail: placement.candidateEmail,
        orgName: placement.orgName,
        orgId: placement.orgId,
        openingTitle: placement.openingTitle,
        placementId: placement.id,
        startDate: placement.startDate,
        salaryAmount: placement.salaryAmount,
        salaryCurrency: placement.salaryCurrency,
        ptoDaysPerYear: 15,
        ptoUsed: 0,
        rolScore: 75,
        isEOR: false,
        performanceReviews: [],
        status: 'active',
      };
      const ref = await addDoc(collection(db, 'contractors'), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setProfile({ ...data, id: ref.id } as ContractorProfile);
      showToast('Contractor profile created', 'success');
      loadProfile();
    } catch {
      showToast('Failed to create profile', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'contractors', profile.id), {
        ptoDaysPerYear: Number(editForm.ptoDaysPerYear) || 15,
        ptoUsed: Number(editForm.ptoUsed) || 0,
        rolScore: Number(editForm.rolScore) || 0,
        rolFeedback: editForm.rolFeedback,
        isEOR: editForm.isEOR,
        eorProvider: editForm.eorProvider,
        status: editForm.status,
        updatedAt: serverTimestamp(),
      });
      showToast('Profile updated', 'success');
      setEditing(false);
      loadProfile();
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addReview() {
    if (!profile || !reviewForm.period) {
      showToast('Period is required', 'error');
      return;
    }
    setAddingReview(true);
    try {
      const review: PerformanceReview = {
        id: crypto.randomUUID(),
        period: reviewForm.period,
        score: Number(reviewForm.score),
        feedback: reviewForm.feedback,
        reviewedAt: new Date().toISOString(),
      };
      const reviews = [...(profile.performanceReviews ?? []), review];
      await updateDoc(doc(db, 'contractors', profile.id), {
        performanceReviews: reviews,
        updatedAt: serverTimestamp(),
      });
      showToast('Review added', 'success');
      setReviewModal(false);
      setReviewForm({ period: '', score: '4', feedback: '' });
      loadProfile();
    } catch {
      showToast('Failed to add review', 'error');
    } finally {
      setAddingReview(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const ptoDaysRemaining = (profile?.ptoDaysPerYear ?? 15) - (profile?.ptoUsed ?? 0);
  const ptoPct = profile ? Math.round(((profile.ptoUsed ?? 0) / (profile.ptoDaysPerYear || 15)) * 100) : 0;
  const rolScore = profile?.rolScore ?? 0;
  const rolColor = rolScore >= 75 ? 'text-green-600' : rolScore >= 50 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="space-y-4">
      {/* Placement summary */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-700 text-[var(--black)]">{placement.candidateName}</p>
                <p className="text-xs text-[var(--light)]">{placement.openingTitle ?? 'Contractor'} · {placement.orgName}</p>
              </div>
            </div>
          </div>
          <Badge label={placement.status ?? 'active'} variant="status" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-5 text-xs">
          {[
            { label: 'Start date', value: fmtDate(placement.startDate) },
            { label: 'Salary', value: fmtCurrency(placement.salaryAmount, placement.salaryCurrency) },
            { label: 'Pipeline', value: placement.pipelineCode ?? '—' },
            { label: 'Email', value: placement.candidateEmail ?? '—' },
            { label: 'End date', value: placement.endDate ? fmtDate(placement.endDate) : 'Ongoing' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</p>
              <p className="mt-0.5 font-500 text-[var(--black)] truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {!profile ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-8 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-[var(--light)]" />
          <p className="text-sm font-600 text-[var(--black)]">No contractor profile yet</p>
          <p className="mt-1 text-xs text-[var(--light)]">Create a profile to track PTO, ROL score, EOR status, and performance reviews.</p>
          <button
            onClick={createProfile}
            disabled={saving}
            className="mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white mx-auto disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {saving && <Spinner size="sm" />}
            Create contractor profile
          </button>
        </div>
      ) : (
        <>
          {/* PTO + ROL + EOR stats */}
          <div className="grid gap-4 sm:grid-cols-3">
            {/* PTO */}
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-[var(--light)]" />
                <p className="text-xs font-700 text-[var(--black)]">PTO</p>
              </div>
              <div className="flex items-end gap-1">
                <span className="text-2xl font-800 text-[var(--black)]">{profile.ptoUsed ?? 0}</span>
                <span className="mb-0.5 text-sm text-[var(--light)]">/ {profile.ptoDaysPerYear ?? 15} days used</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                <div
                  className={`h-1.5 rounded-full transition-all ${ptoPct > 80 ? 'bg-red-500' : ptoPct > 60 ? 'bg-amber-500' : 'bg-[var(--green)]'}`}
                  style={{ width: `${Math.min(100, ptoPct)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--light)]">{ptoDaysRemaining} days remaining</p>
            </div>

            {/* ROL Score */}
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="h-4 w-4 text-[var(--light)]" />
                <p className="text-xs font-700 text-[var(--black)]">ROL Score</p>
              </div>
              <div className={`text-3xl font-800 ${rolColor}`}>{rolScore}<span className="text-sm font-500 text-[var(--light)]">/100</span></div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                <div
                  className={`h-1.5 rounded-full transition-all ${rolScore >= 75 ? 'bg-green-500' : rolScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${rolScore}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--light)]">
                {rolScore >= 75 ? 'High retention likelihood' : rolScore >= 50 ? 'Moderate — watch closely' : 'At-risk — needs attention'}
              </p>
            </div>

            {/* EOR */}
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-[var(--light)]" />
                <p className="text-xs font-700 text-[var(--black)]">EOR Status</p>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-700 ${profile.isEOR ? 'bg-green-100 text-green-700' : 'bg-[var(--bg)] text-[var(--light)]'}`}>
                  {profile.isEOR ? 'EOR Active' : 'Not EOR'}
                </span>
              </div>
              {profile.isEOR && profile.eorProvider && (
                <p className="text-xs text-[var(--mid)]">Provider: {profile.eorProvider}</p>
              )}
              {!profile.isEOR && (
                <p className="text-[10px] text-[var(--light)]">Employer of Record not set up</p>
              )}
            </div>
          </div>

          {/* Edit profile form */}
          {editing ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
              <h3 className="mb-4 text-sm font-600 text-[var(--black)]">Edit profile</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">PTO days/year</label>
                  <input type="number" value={editForm.ptoDaysPerYear} onChange={(e) => setEditForm((f) => ({ ...f, ptoDaysPerYear: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">PTO days used</label>
                  <input type="number" value={editForm.ptoUsed} onChange={(e) => setEditForm((f) => ({ ...f, ptoUsed: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">ROL score (0–100)</label>
                  <input type="number" min="0" max="100" value={editForm.rolScore} onChange={(e) => setEditForm((f) => ({ ...f, rolScore: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
                  <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]">
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="ended">Ended</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">ROL notes</label>
                  <textarea value={editForm.rolFeedback} onChange={(e) => setEditForm((f) => ({ ...f, rolFeedback: e.target.value }))}
                    rows={2} className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                </div>
                <div className="sm:col-span-2 flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.isEOR} onChange={(e) => setEditForm((f) => ({ ...f, isEOR: e.target.checked }))} className="rounded" />
                    <span className="text-xs font-600 text-[var(--black)]">EOR active</span>
                  </label>
                  {editForm.isEOR && (
                    <input value={editForm.eorProvider} onChange={(e) => setEditForm((f) => ({ ...f, eorProvider: e.target.value }))}
                      placeholder="EOR provider name"
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                  )}
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={saveProfile} disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                  style={{ background: 'var(--green)' }}>
                  {saving && <Spinner size="sm" />}Save
                </button>
                <button onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
                <Edit3 className="h-3.5 w-3.5" />
                Edit profile
              </button>
            </div>
          )}

          {/* Performance reviews */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-700 text-[var(--black)]">Performance reviews</h3>
              <button
                onClick={() => setReviewModal(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add review
              </button>
            </div>

            {(profile.performanceReviews?.length ?? 0) === 0 ? (
              <p className="text-xs text-[var(--light)]">No performance reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {[...(profile.performanceReviews ?? [])].reverse().map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-700 text-[var(--black)]">{r.period}</span>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`h-3 w-3 ${s <= r.score ? 'fill-amber-400 text-amber-400' : 'text-[var(--border)]'}`} />
                          ))}
                        </div>
                      </div>
                      {r.feedback && <p className="text-[11px] text-[var(--mid)]">{r.feedback}</p>}
                    </div>
                    <span className="shrink-0 text-[10px] text-[var(--light)]">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Add review modal */}
      <Modal open={reviewModal} onClose={() => setReviewModal(false)} title="Add performance review" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Period *</label>
            <input value={reviewForm.period} onChange={(e) => setReviewForm((f) => ({ ...f, period: e.target.value }))}
              placeholder="Q1 2026"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Score (1–5)</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setReviewForm((f) => ({ ...f, score: String(s) }))}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-700 transition-colors ${
                    Number(reviewForm.score) === s
                      ? 'border-[var(--green)] bg-[var(--green)] text-white'
                      : 'border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Feedback</label>
            <textarea value={reviewForm.feedback} onChange={(e) => setReviewForm((f) => ({ ...f, feedback: e.target.value }))}
              rows={3} placeholder="Performance notes..."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setReviewModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          <button onClick={addReview} disabled={addingReview}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}>
            {addingReview && <Spinner size="sm" />}
            Save review
          </button>
        </div>
      </Modal>
    </div>
  );
}
