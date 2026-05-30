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
  where,
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtCurrency } from '@/lib/utils';
import type { Placement, ContractorProfile, PerformanceReview, EngagementType, EORComplianceStatus } from '@/lib/types';
import { ENGAGEMENT_LABELS, EOR_COMPLIANCE_LABELS } from '@/lib/types';
import {
  Shield, Calendar, Star, Briefcase, Heart, ChevronRight, Edit3, Plus, Building2,
  Globe, FileText, DollarSign,
} from 'lucide-react';

const EOR_COMPLIANCE_STYLE: Record<EORComplianceStatus, { color: string; bg: string }> = {
  pending: { color: '#9E9E9E', bg: '#F5F5F5' },
  onboarding: { color: '#D68910', bg: '#FEF9E7' },
  compliant: { color: '#16A085', bg: '#E8F8F5' },
  issue: { color: '#C0392B', bg: '#FDEDEC' },
};

const ENGAGEMENT_STYLE: Record<EngagementType, { color: string; bg: string }> = {
  eor: { color: '#C0392B', bg: '#FEF0F0' },
  managed: { color: '#16A085', bg: '#E8F8F5' },
  spp: { color: '#D35400', bg: '#FEF5EB' },
  direct: { color: '#555555', bg: '#F5F5F5' },
};

function EngagementBadge({ type }: { type?: EngagementType }) {
  const t = type ?? 'direct';
  const s = ENGAGEMENT_STYLE[t];
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-700" style={{ color: s.color, background: s.bg }}>
      {ENGAGEMENT_LABELS[t]}
    </span>
  );
}

export function ContractorDetail({ placement }: { placement: Placement }) {
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
    eorCountry: '',
    eorComplianceStatus: 'pending' as EORComplianceStatus,
    eorMonthlyCost: '',
    eorContractUrl: '',
    eorBenefits: '',
    engagementType: 'direct' as EngagementType,
    status: 'active',
  });

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          eorCountry: data.eorCountry ?? '',
          eorComplianceStatus: data.eorComplianceStatus ?? 'pending',
          eorMonthlyCost: data.eorMonthlyCost != null ? String(data.eorMonthlyCost) : '',
          eorContractUrl: data.eorContractUrl ?? '',
          eorBenefits: (data.eorBenefits ?? []).join(', '),
          engagementType: data.engagementType ?? placement.engagementType ?? 'direct',
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
        engagementType: placement.engagementType ?? 'direct',
        ptoDaysPerYear: 15,
        ptoUsed: 0,
        rolScore: 75,
        isEOR: (placement.engagementType ?? 'direct') === 'eor',
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
        eorCountry: editForm.eorCountry,
        eorComplianceStatus: editForm.eorComplianceStatus,
        eorMonthlyCost: editForm.eorMonthlyCost ? Number(editForm.eorMonthlyCost) : null,
        eorContractUrl: editForm.eorContractUrl,
        eorBenefits: editForm.eorBenefits
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean),
        engagementType: editForm.engagementType,
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
  const engagement = profile?.engagementType ?? placement.engagementType ?? 'direct';

  return (
    <div className="space-y-4">
      {/* Placement summary */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
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
          <div className="flex items-center gap-2">
            <EngagementBadge type={engagement} />
            <Badge label={placement.status ?? 'active'} variant="status" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-xs sm:grid-cols-6">
          {[
            { label: 'Start date', value: fmtDate(placement.startDate) },
            { label: 'Salary', value: fmtCurrency(placement.salaryAmount, placement.salaryCurrency) },
            { label: 'Engagement', value: ENGAGEMENT_LABELS[engagement] },
            { label: 'Pipeline', value: placement.pipelineCode ?? '—' },
            { label: 'Email', value: placement.candidateEmail ?? '—' },
            { label: 'End date', value: placement.endDate ? fmtDate(placement.endDate) : 'Ongoing' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</p>
              <p className="mt-0.5 truncate font-500 text-[var(--black)]">{value}</p>
            </div>
          ))}
        </div>
        {placement.orgId && (
          <a
            href={`/organizations?id=${placement.orgId}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <Building2 className="h-3.5 w-3.5" />View organization<ChevronRight className="h-3 w-3" />
          </a>
        )}
      </div>

      {!profile ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-8 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-[var(--light)]" />
          <p className="text-sm font-600 text-[var(--black)]">No contractor profile yet</p>
          <p className="mt-1 text-xs text-[var(--light)]">Create a profile to track PTO, ROL score, EOR status, and performance reviews.</p>
          <button
            onClick={createProfile}
            disabled={saving}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
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
              <div className="mb-3 flex items-center gap-2">
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
              <div className="mb-3 flex items-center gap-2">
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
              <div className="mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-[var(--light)]" />
                <p className="text-xs font-700 text-[var(--black)]">EOR Status</p>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-700 ${profile.isEOR ? 'bg-green-100 text-green-700' : 'bg-[var(--bg)] text-[var(--light)]'}`}>
                  {profile.isEOR ? 'EOR Active' : 'Not EOR'}
                </span>
                {profile.isEOR && profile.eorComplianceStatus && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-700"
                    style={{
                      color: EOR_COMPLIANCE_STYLE[profile.eorComplianceStatus].color,
                      background: EOR_COMPLIANCE_STYLE[profile.eorComplianceStatus].bg,
                    }}
                  >
                    {EOR_COMPLIANCE_LABELS[profile.eorComplianceStatus]}
                  </span>
                )}
              </div>
              {!profile.isEOR ? (
                <p className="text-[10px] text-[var(--light)]">Employer of Record not set up</p>
              ) : (
                <div className="space-y-1.5 text-[11px] text-[var(--mid)]">
                  {profile.eorProvider && (
                    <p className="flex items-center gap-1.5"><Building2 className="h-3 w-3 text-[var(--light)]" />{profile.eorProvider}</p>
                  )}
                  {profile.eorCountry && (
                    <p className="flex items-center gap-1.5"><Globe className="h-3 w-3 text-[var(--light)]" />{profile.eorCountry}</p>
                  )}
                  {typeof profile.eorMonthlyCost === 'number' && profile.eorMonthlyCost > 0 && (
                    <p className="flex items-center gap-1.5"><DollarSign className="h-3 w-3 text-[var(--light)]" />{fmtCurrency(profile.eorMonthlyCost, 'USD')}/mo fee</p>
                  )}
                  {profile.eorContractUrl && (
                    <a href={profile.eorContractUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-600 text-[var(--green)] hover:underline">
                      <FileText className="h-3 w-3" />View contract
                    </a>
                  )}
                  {(profile.eorBenefits?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {profile.eorBenefits!.map((b) => (
                        <span key={b} className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[9px] font-600 text-[var(--mid)]">{b}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Edit profile form */}
          {editing ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
              <h3 className="mb-4 text-sm font-600 text-[var(--black)]">Edit profile</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Engagement type</label>
                  <select value={editForm.engagementType} onChange={(e) => setEditForm((f) => ({ ...f, engagementType: e.target.value as EngagementType }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]">
                    <option value="direct">Direct Placement</option>
                    <option value="managed">Managed Team</option>
                    <option value="eor">EOR</option>
                    <option value="spp">Strategic Partner</option>
                  </select>
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
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">ROL notes</label>
                  <textarea value={editForm.rolFeedback} onChange={(e) => setEditForm((f) => ({ ...f, rolFeedback: e.target.value }))}
                    rows={2} className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                </div>
                {/* EOR module */}
                <div className="sm:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={editForm.isEOR} onChange={(e) => setEditForm((f) => ({ ...f, isEOR: e.target.checked }))} className="rounded" />
                    <span className="flex items-center gap-1.5 text-xs font-700 text-[var(--black)]"><Shield className="h-3.5 w-3.5 text-[var(--light)]" />Employer of Record (EOR)</span>
                  </label>
                  {editForm.isEOR && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Provider</label>
                        <input value={editForm.eorProvider} onChange={(e) => setEditForm((f) => ({ ...f, eorProvider: e.target.value }))}
                          placeholder="Deel, Remote, Oyster…"
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Country of employment</label>
                        <input value={editForm.eorCountry} onChange={(e) => setEditForm((f) => ({ ...f, eorCountry: e.target.value }))}
                          placeholder="Colombia"
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Compliance status</label>
                        <select value={editForm.eorComplianceStatus} onChange={(e) => setEditForm((f) => ({ ...f, eorComplianceStatus: e.target.value as EORComplianceStatus }))}
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]">
                          <option value="pending">Pending setup</option>
                          <option value="onboarding">Onboarding</option>
                          <option value="compliant">Compliant</option>
                          <option value="issue">Compliance issue</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Monthly EOR fee (USD)</label>
                        <input type="number" value={editForm.eorMonthlyCost} onChange={(e) => setEditForm((f) => ({ ...f, eorMonthlyCost: e.target.value }))}
                          placeholder="599"
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Benefits (comma-separated)</label>
                        <input value={editForm.eorBenefits} onChange={(e) => setEditForm((f) => ({ ...f, eorBenefits: e.target.value }))}
                          placeholder="Health insurance, Pension, 13th salary"
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract link</label>
                        <input value={editForm.eorContractUrl} onChange={(e) => setEditForm((f) => ({ ...f, eorContractUrl: e.target.value }))}
                          placeholder="https://…"
                          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
                      </div>
                    </div>
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
                      <div className="mb-1 flex items-center gap-2">
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
