'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
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
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtCurrency, initials } from '@/lib/utils';
import type { Placement, ContractorProfile, PerformanceReview, EngagementType, EORComplianceStatus } from '@/lib/types';
import { ENGAGEMENT_LABELS, EOR_COMPLIANCE_LABELS } from '@/lib/types';
import { NW, MONO, Icon, Avatar, Button } from '@/components/nw/primitives';
import { Card, CardHead, BackBar, StatusBadge } from '@/components/nw/shell-ui';
import { type IconName } from 'lucide-react/dynamic';

const AVA_PALETTE = ['#16A085', '#E74C7C', '#AF7AC5', '#3B82F6', '#12866E', '#EAB308', '#EC5290'];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVA_PALETTE[h % AVA_PALETTE.length];
}

const EOR_COMPLIANCE_COLOR: Record<EORComplianceStatus, { fg: string; bg: string }> = {
  pending: { fg: NW.gray500, bg: NW.gray50 },
  onboarding: { fg: '#A16207', bg: NW.yellow50 },
  compliant: { fg: NW.green600, bg: NW.green50 },
  issue: { fg: NW.rose600, bg: NW.rose50 },
};

function eorPlanLabel(t: EngagementType): string {
  if (t === 'eor') return 'EOR';
  if (t === 'spp') return 'SPP';
  if (t === 'managed') return 'Managed';
  return 'Direct';
}

// ── Small presentational helpers (match the prototype) ──────────────────────
function SnapRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: last ? 'none' : `1px solid ${NW.gray100}` }}>
      <span style={{ fontSize: 12.5, color: NW.gray500 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: NW.black, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
function Fact({ icon, label, value, sub, accent }: { icon: IconName; label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 150, padding: '16px 18px', borderRight: `1px solid ${NW.gray100}` }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: NW.gray400, marginBottom: 7 }}>
        <Icon name={icon} size={13} color={NW.gray400} />{label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: accent ?? NW.black }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function EmptyState({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '30px 16px' }}>
      <Icon name={icon} size={24} color={NW.gray300} />
      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.gray600, marginTop: 8 }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: NW.gray400, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]';
const labelCls = 'mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]';

export function ContractorDetail({ placement }: { placement: Placement }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewForm, setReviewForm] = useState({ period: '', score: '4', feedback: '' });
  const [addingReview, setAddingReview] = useState(false);
  const [tab, setTab] = useState<'overview' | 'comp' | 'pto' | 'reviews' | 'eor' | 'docs' | 'pay'>('overview');

  const [editForm, setEditForm] = useState({
    ptoDaysPerYear: '', ptoUsed: '', rolScore: '', rolFeedback: '',
    isEOR: false, eorProvider: '', eorCountry: '', eorComplianceStatus: 'pending' as EORComplianceStatus,
    eorMonthlyCost: '', eorContractUrl: '', eorBenefits: '',
    engagementType: 'direct' as EngagementType, status: 'active',
  });

  useEffect(() => { loadProfile(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [placement.id]);

  async function loadProfile() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'contractors'), where('placementId', '==', placement.id)));
      if (!snap.empty) {
        const data = { id: snap.docs[0].id, ...snap.docs[0].data() } as ContractorProfile;
        setProfile(data);
        setEditForm({
          ptoDaysPerYear: String(data.ptoDaysPerYear ?? 15), ptoUsed: String(data.ptoUsed ?? 0),
          rolScore: String(data.rolScore ?? 75), rolFeedback: data.rolFeedback ?? '',
          isEOR: data.isEOR ?? false, eorProvider: data.eorProvider ?? '', eorCountry: data.eorCountry ?? '',
          eorComplianceStatus: data.eorComplianceStatus ?? 'pending',
          eorMonthlyCost: data.eorMonthlyCost != null ? String(data.eorMonthlyCost) : '',
          eorContractUrl: data.eorContractUrl ?? '', eorBenefits: (data.eorBenefits ?? []).join(', '),
          engagementType: data.engagementType ?? placement.engagementType ?? 'direct', status: data.status ?? 'active',
        });
      } else {
        setProfile(null);
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
        candidateName: placement.candidateName, candidateEmail: placement.candidateEmail,
        orgName: placement.orgName, orgId: placement.orgId, openingTitle: placement.openingTitle,
        placementId: placement.id, startDate: placement.startDate, salaryAmount: placement.salaryAmount,
        salaryCurrency: placement.salaryCurrency, engagementType: placement.engagementType ?? 'direct',
        ptoDaysPerYear: 15, ptoUsed: 0, rolScore: 75,
        isEOR: (placement.engagementType ?? 'direct') === 'eor', performanceReviews: [], status: 'active',
      };
      const ref = await addDoc(collection(db, 'contractors'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
        ptoDaysPerYear: Number(editForm.ptoDaysPerYear) || 15, ptoUsed: Number(editForm.ptoUsed) || 0,
        rolScore: Number(editForm.rolScore) || 0, rolFeedback: editForm.rolFeedback,
        isEOR: editForm.isEOR, eorProvider: editForm.eorProvider, eorCountry: editForm.eorCountry,
        eorComplianceStatus: editForm.eorComplianceStatus,
        eorMonthlyCost: editForm.eorMonthlyCost ? Number(editForm.eorMonthlyCost) : null,
        eorContractUrl: editForm.eorContractUrl,
        eorBenefits: editForm.eorBenefits.split(',').map((b) => b.trim()).filter(Boolean),
        engagementType: editForm.engagementType, status: editForm.status, updatedAt: serverTimestamp(),
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
    if (!profile || !reviewForm.period) { showToast('Period is required', 'error'); return; }
    setAddingReview(true);
    try {
      const review: PerformanceReview = {
        id: crypto.randomUUID(), period: reviewForm.period, score: Number(reviewForm.score),
        feedback: reviewForm.feedback, reviewedAt: new Date().toISOString(),
      };
      const reviews = [...(profile.performanceReviews ?? []), review];
      await updateDoc(doc(db, 'contractors', profile.id), { performanceReviews: reviews, updatedAt: serverTimestamp() });
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
    return <div className="flex h-40 items-center justify-center"><Spinner /></div>;
  }

  const engagement = profile?.engagementType ?? placement.engagementType ?? 'direct';
  const isManaged = engagement === 'managed';
  const ptoTotal = profile?.ptoDaysPerYear ?? 15;
  const ptoUsed = profile?.ptoUsed ?? 0;
  const ptoBalance = ptoTotal - ptoUsed;
  const ptoPct = ptoTotal ? Math.round((ptoUsed / ptoTotal) * 100) : 0;
  const rolScore = profile?.rolScore ?? 0;
  const salaryLabel = placement.salaryAmount ? fmtCurrency(placement.salaryAmount, placement.salaryCurrency) : '—';
  const eorFee = typeof profile?.eorMonthlyCost === 'number' && profile.eorMonthlyCost > 0 ? profile.eorMonthlyCost : 0;
  const clientBill = (placement.salaryAmount ?? 0) + eorFee;
  const firstName = (placement.candidateName ?? 'this hire').split(' ')[0];
  const reviews = [...(profile?.performanceReviews ?? [])].reverse();

  const statusKey = placement.status === 'ended' ? 'ended' : placement.status === 'on_hold' ? 'paused' : 'active';

  const TABS: [typeof tab, string, IconName][] = [
    ['overview', 'Overview', 'layout-dashboard'],
    ['comp', 'Compensation', 'wallet'],
    ['pto', 'Time off', 'palmtree'],
    ['reviews', 'Reviews', 'star'],
    ['eor', 'EOR & benefits', 'shield-check'],
    ['docs', 'Documents', 'folder'],
    ['pay', 'Payments', 'banknote'],
  ];

  return (
    <div>
      <BackBar label="All hires" href="/hired" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Avatar initials={initials(placement.candidateName || '') || '—'} size={64} bg={colorFor(placement.candidateId || placement.id)} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: NW.black }}>{placement.candidateName ?? 'Hire'}</h1>
              <StatusBadge status={statusKey} />
              {isManaged && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}22`, borderRadius: 999, padding: '4px 10px' }}>
                  <Icon name="shield-check" size={12} color={NW.teal600} />Managed by Nearwork
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 13.5, color: NW.gray600, flexWrap: 'wrap' }}>
              <span>{placement.openingTitle || 'Contractor'}</span>
              <span style={{ color: NW.gray300 }}>·</span>
              <span style={{ fontWeight: 600, color: NW.black }}>{placement.orgName || '—'}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {placement.candidateId && <Button variant="secondary" size="md" icon="user-round" onClick={() => router.push(`/candidates/${placement.candidateId}`)}>Candidate profile</Button>}
          {profile && <Button variant="primary" size="md" icon="pencil" onClick={() => setEditing((v) => !v)}>{editing ? 'Close editor' : 'Edit'}</Button>}
        </div>
      </div>

      {/* Facts strip */}
      <Card pad={0} style={{ marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Fact icon="calendar-check" label="Started" value={placement.startDate ? fmtDate(placement.startDate) : '—'} sub={placement.endDate ? `ended ${fmtDate(placement.endDate)}` : 'active'} />
          <Fact icon="git-branch" label="Source pipeline" value={placement.pipelineCode || '—'} accent={placement.pipelineCode ? NW.teal600 : undefined} />
          <Fact icon="users-round" label="Team" value={isManaged ? 'Managed team' : 'Individual'} accent={isManaged ? NW.teal600 : undefined} />
          <Fact icon="wallet" label="Salary" value={salaryLabel} sub="per month" />
          <Fact icon="palmtree" label="PTO balance" value={`${ptoBalance} days`} sub={`${ptoUsed} used`} />
          <Fact icon="shield-check" label="EOR plan" value={eorPlanLabel(engagement)} sub={eorFee ? `${fmtCurrency(eorFee, 'USD')}/mo` : undefined} />
        </div>
      </Card>

      {/* No profile yet → CTA */}
      {!profile ? (
        <Card>
          <EmptyState icon="briefcase" title="No HR profile yet" sub={`Create a profile to track PTO, reviews, EOR status and payroll for ${firstName}.`} />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <Button variant="primary" size="md" icon="plus" onClick={createProfile} disabled={saving}>Create HR profile</Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${NW.gray100}`, marginBottom: 20, flexWrap: 'wrap' }}>
            {TABS.map(([k, label, ic]) => {
              const on = tab === k;
              return (
                <button key={k} onClick={() => { setTab(k); setEditing(false); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: 'inherit', fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? NW.black : NW.gray500, background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? NW.teal500 : 'transparent'}`, padding: '10px 13px', marginBottom: -1, cursor: 'pointer' }}>
                  <Icon name={ic} size={15} color={on ? NW.teal600 : NW.gray400} />{label}
                </button>
              );
            })}
          </div>

          {editing ? (
            <EditFormCard editForm={editForm} setEditForm={setEditForm} saving={saving} onSave={saveProfile} onCancel={() => setEditing(false)} />
          ) : (
            <>
              {/* OVERVIEW */}
              {tab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Card>
                      <CardHead icon="info" title="Placement" />
                      <SnapRow label="Role">{placement.openingTitle || '—'}</SnapRow>
                      <SnapRow label="Organization">{placement.orgName || '—'}</SnapRow>
                      <SnapRow label="Source pipeline">{placement.pipelineCode || '—'}</SnapRow>
                      <SnapRow label="Engagement">{ENGAGEMENT_LABELS[engagement]}</SnapRow>
                      <SnapRow label="Team">{isManaged ? 'Managed team' : 'Individual hire'}</SnapRow>
                      <SnapRow label="Start date">{placement.startDate ? fmtDate(placement.startDate) : '—'}</SnapRow>
                      <SnapRow label="End date" last>{placement.endDate ? fmtDate(placement.endDate) : 'Ongoing'}</SnapRow>
                    </Card>
                    {placement.candidateId && (
                      <Card>
                        <CardHead icon="user-round" title="Linked candidate profile" action={<Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => router.push(`/candidates/${placement.candidateId}`)}>Open</Button>} />
                        <div onClick={() => router.push(`/candidates/${placement.candidateId}`)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', borderRadius: 12, border: `1px solid ${NW.gray100}`, cursor: 'pointer', background: NW.offWhite }}>
                          <Avatar initials={initials(placement.candidateName || '') || '—'} size={40} bg={colorFor(placement.candidateId)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{placement.candidateName}</div>
                            <div style={{ fontSize: 12, color: NW.gray500 }}>{placement.candidateEmail || 'Same person · recruiting record'}</div>
                          </div>
                          <Icon name="chevron-right" size={17} color={NW.gray400} />
                        </div>
                        <div style={{ fontSize: 12, color: NW.gray400, marginTop: 10 }}>This is the staffing/HR record. The candidate profile holds the recruiting history (experience, assessments, applications).</div>
                      </Card>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Card>
                      <CardHead icon="palmtree" title="Time off" />
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 12 }}>
                        <span style={{ fontFamily: MONO, fontSize: 32, fontWeight: 600, color: NW.black, lineHeight: 1 }}>{ptoBalance}</span>
                        <span style={{ fontSize: 13, color: NW.gray500, marginBottom: 2 }}>of {ptoTotal} days left</span>
                      </div>
                      <div style={{ height: 8, background: NW.gray100, borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, ptoPct)}%`, height: '100%', background: NW.teal500 }} /></div>
                      <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 7 }}>{ptoUsed} of {ptoTotal} days used this year</div>
                    </Card>
                    <Card>
                      <CardHead icon="shield-check" title="EOR & payroll" />
                      <SnapRow label="Plan">{eorPlanLabel(engagement)}{eorFee ? ` · ${fmtCurrency(eorFee, 'USD')}/mo` : ''}</SnapRow>
                      <SnapRow label="Monthly salary"><span style={{ fontFamily: MONO }}>{salaryLabel}</span></SnapRow>
                      <SnapRow label="Provider">{profile.eorProvider || '—'}</SnapRow>
                      <SnapRow label="Country" last>{profile.eorCountry || '—'}</SnapRow>
                    </Card>
                  </div>
                </div>
              )}

              {/* COMPENSATION */}
              {tab === 'comp' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
                  <Card>
                    <CardHead icon="wallet" title="Compensation" action={<Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>} />
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 600, color: NW.black, letterSpacing: '-0.02em' }}>{salaryLabel}</span>
                      <span style={{ fontSize: 13, color: NW.gray500 }}>/ month</span>
                    </div>
                    <div style={{ fontSize: 13, color: NW.gray500, marginBottom: 18 }}>{placement.salaryCurrency ?? 'USD'} · paid monthly</div>
                    <SnapRow label="Engagement">{ENGAGEMENT_LABELS[engagement]}</SnapRow>
                    <SnapRow label="Currency">{placement.salaryCurrency ?? 'USD'}</SnapRow>
                    <SnapRow label="Pay frequency" last>Monthly</SnapRow>
                  </Card>
                  <Card>
                    <CardHead icon="receipt" title="Cost breakdown" sub="What the client is billed" />
                    <SnapRow label="Salary (monthly)"><span style={{ fontFamily: MONO }}>{salaryLabel}</span></SnapRow>
                    <SnapRow label="Nearwork EOR fee"><span style={{ fontFamily: MONO }}>{eorFee ? fmtCurrency(eorFee, 'USD') : '—'}</span></SnapRow>
                    <SnapRow label="EOR plan">{eorPlanLabel(engagement)}</SnapRow>
                    <SnapRow label="Total client bill" last><span style={{ fontFamily: MONO, fontWeight: 600, color: NW.black }}>{clientBill ? `${fmtCurrency(clientBill, 'USD')}/mo` : '—'}</span></SnapRow>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 10, background: NW.gray50, fontSize: 12, color: NW.gray500 }}>
                      <Icon name="info" size={13} color={NW.gray400} />Salary is billed to the client plus the Nearwork EOR fee.
                    </div>
                  </Card>
                </div>
              )}

              {/* TIME OFF */}
              {tab === 'pto' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 16, alignItems: 'start' }}>
                  <Card>
                    <CardHead icon="palmtree" title="PTO balance" action={<Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>} />
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 14 }}>
                      <span style={{ fontFamily: MONO, fontSize: 38, fontWeight: 600, color: NW.black, lineHeight: 1 }}>{ptoBalance}</span>
                      <span style={{ fontSize: 13, color: NW.gray500, marginBottom: 3 }}>of {ptoTotal} days left</span>
                    </div>
                    <div style={{ height: 8, background: NW.gray100, borderRadius: 5, overflow: 'hidden', marginBottom: 14 }}><div style={{ width: `${Math.min(100, ptoPct)}%`, height: '100%', background: NW.teal500 }} /></div>
                    <SnapRow label="Allowance">{ptoTotal} days / year</SnapRow>
                    <SnapRow label="Used">{ptoUsed} days</SnapRow>
                    <SnapRow label="Remaining" last>{ptoBalance} days</SnapRow>
                  </Card>
                  <Card>
                    <CardHead icon="calendar-clock" title="Time-off requests" />
                    <EmptyState icon="plane" title="No time-off requests tracked yet" sub="Approve and log individual PTO requests here — coming soon." />
                  </Card>
                </div>
              )}

              {/* REVIEWS */}
              {tab === 'reviews' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
                  <Card>
                    <CardHead icon="star" title="Performance reviews" sub={`${reviews.length} on record`} action={<Button variant="primary" size="sm" icon="plus" onClick={() => setReviewModal(true)}>Add review</Button>} />
                    {reviews.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                        {reviews.map((rv) => (
                          <div key={rv.id} style={{ border: `1px solid ${NW.gray100}`, borderRadius: 13, padding: 15 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{rv.period}</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 14, fontWeight: 600, color: NW.black }}>
                                <Icon name="star" size={14} color="#EAB308" />{rv.score.toFixed(1)}<span style={{ color: NW.gray400, fontWeight: 500 }}>/5</span>
                              </span>
                            </div>
                            {rv.feedback && <p style={{ fontSize: 13, color: NW.gray600, lineHeight: 1.55, margin: '10px 0 0' }}>{rv.feedback}</p>}
                            {rv.reviewedAt && <div style={{ fontSize: 12, color: NW.gray400, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${NW.gray100}` }}>{new Date(rv.reviewedAt).toLocaleDateString()}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon="star" title="No reviews yet" sub={`Add the first quarterly or annual review for ${firstName}.`} />
                    )}
                  </Card>
                  <Card>
                    <CardHead icon="heart" title="Retention (ROL) score" />
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 600, color: rolScore >= 75 ? NW.green600 : rolScore >= 50 ? '#A16207' : NW.rose600, lineHeight: 1 }}>{rolScore}</span>
                      <span style={{ fontSize: 13, color: NW.gray500, marginBottom: 2 }}>/100</span>
                    </div>
                    <div style={{ height: 8, background: NW.gray100, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}><div style={{ width: `${Math.min(100, rolScore)}%`, height: '100%', background: rolScore >= 75 ? NW.green500 : rolScore >= 50 ? NW.yellow500 : NW.rose500 }} /></div>
                    <div style={{ fontSize: 12.5, color: NW.gray500 }}>{rolScore >= 75 ? 'High retention likelihood' : rolScore >= 50 ? 'Moderate — watch closely' : 'At-risk — needs attention'}</div>
                    {profile.rolFeedback && <p style={{ fontSize: 12.5, color: NW.gray600, lineHeight: 1.5, marginTop: 12 }}>{profile.rolFeedback}</p>}
                  </Card>
                </div>
              )}

              {/* EOR & BENEFITS */}
              {tab === 'eor' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, alignItems: 'start' }}>
                  <Card>
                    <CardHead icon="shield-check" title="EOR plan" action={<Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(true)}>Change</Button>} />
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: NW.black }}>{eorPlanLabel(engagement)}</span>
                      {eorFee ? <span style={{ fontFamily: MONO, fontSize: 15, color: NW.teal600 }}>{fmtCurrency(eorFee, 'USD')}/mo</span> : null}
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '3px 10px', ...(profile.isEOR ? { color: EOR_COMPLIANCE_COLOR[profile.eorComplianceStatus ?? 'pending'].fg, background: EOR_COMPLIANCE_COLOR[profile.eorComplianceStatus ?? 'pending'].bg } : { color: NW.gray500, background: NW.gray50 }) }}>
                      {profile.isEOR ? EOR_COMPLIANCE_LABELS[profile.eorComplianceStatus ?? 'pending'] : 'Not on EOR'}
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 0 }}>
                      <SnapRow label="Provider">{profile.eorProvider || '—'}</SnapRow>
                      <SnapRow label="Country">{profile.eorCountry || '—'}</SnapRow>
                      <SnapRow label="Monthly fee" last>{eorFee ? `${fmtCurrency(eorFee, 'USD')}/mo` : '—'}</SnapRow>
                    </div>
                  </Card>
                  <Card>
                    <CardHead icon="gift" title="Benefits" sub={(profile.eorBenefits?.length ?? 0) > 0 ? `${profile.eorBenefits!.length} active` : undefined} />
                    {(profile.eorBenefits?.length ?? 0) > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {profile.eorBenefits!.map((b, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, border: `1px solid ${NW.gray100}`, borderRadius: 11, padding: '11px 13px' }}>
                            <span style={{ width: 34, height: 34, borderRadius: 9, background: NW.teal50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={16} color={NW.teal600} /></span>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: NW.black }}>{b}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: NW.gray50, borderRadius: 11, padding: 16, fontSize: 13, color: NW.gray500 }}>
                        <Icon name="info" size={15} color={NW.gray400} />No benefits recorded. Add them from the profile editor.
                      </div>
                    )}
                  </Card>
                </div>
              )}

              {/* DOCUMENTS */}
              {tab === 'docs' && (
                <Card>
                  <CardHead icon="folder" title="Documents & compliance" />
                  {profile.eorContractUrl ? (
                    <a href={profile.eorContractUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 4px', textDecoration: 'none' }}>
                      <span style={{ width: 40, height: 40, borderRadius: 10, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="file-text" size={18} color={NW.gray500} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>EOR contract</div>
                        <div style={{ fontSize: 12, color: NW.gray400 }}>{profile.eorProvider || 'Employer of Record'}</div>
                      </div>
                      <Icon name="external-link" size={16} color={NW.gray400} />
                    </a>
                  ) : (
                    <EmptyState icon="folder" title="No documents yet" sub="Attach the EOR contract and compliance files from the profile editor." />
                  )}
                </Card>
              )}

              {/* PAYMENTS */}
              {tab === 'pay' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
                  <Card>
                    <CardHead icon="banknote" title="Payroll history" sub="Monthly runs" />
                    <EmptyState icon="banknote" title="No payroll runs recorded yet" sub="Monthly payouts will appear here once payroll is connected." />
                  </Card>
                  <Card>
                    <CardHead icon="settings-2" title="Payout settings" action={<Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>} />
                    <SnapRow label="Monthly amount"><span style={{ fontFamily: MONO }}>{salaryLabel}</span></SnapRow>
                    <SnapRow label="Currency">{placement.salaryCurrency ?? 'USD'}</SnapRow>
                    <SnapRow label="Frequency">Monthly</SnapRow>
                    <SnapRow label="EOR provider" last>{profile.eorProvider || '—'}</SnapRow>
                  </Card>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Add review modal */}
      <Modal open={reviewModal} onClose={() => setReviewModal(false)} title="Add performance review" size="md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Period *</label>
            <input value={reviewForm.period} onChange={(e) => setReviewForm((f) => ({ ...f, period: e.target.value }))} placeholder="Q1 2026"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className={labelCls}>Score (1–5)</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setReviewForm((f) => ({ ...f, score: String(s) }))}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-700 transition-colors ${Number(reviewForm.score) === s ? 'border-[var(--green)] bg-[var(--green)] text-white' : 'border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)]'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Feedback</label>
            <textarea value={reviewForm.feedback} onChange={(e) => setReviewForm((f) => ({ ...f, feedback: e.target.value }))} rows={3} placeholder="Performance notes..."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setReviewModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          <button onClick={addReview} disabled={addingReview} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
            {addingReview && <Spinner size="sm" />}Save review
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Profile editor (PTO / ROL / EOR) — kept inline, opened from the header ──
function EditFormCard({
  editForm, setEditForm, saving, onSave, onCancel,
}: {
  editForm: {
    ptoDaysPerYear: string; ptoUsed: string; rolScore: string; rolFeedback: string;
    isEOR: boolean; eorProvider: string; eorCountry: string; eorComplianceStatus: EORComplianceStatus;
    eorMonthlyCost: string; eorContractUrl: string; eorBenefits: string;
    engagementType: EngagementType; status: string;
  };
  setEditForm: React.Dispatch<React.SetStateAction<typeof editForm>>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHead icon="pencil" title="Edit HR profile" sub="PTO, retention, engagement and EOR" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Engagement type</label>
          <select value={editForm.engagementType} onChange={(e) => setEditForm((f) => ({ ...f, engagementType: e.target.value as EngagementType }))} className={inputCls}>
            <option value="direct">Direct Placement</option>
            <option value="managed">Managed Team</option>
            <option value="eor">EOR</option>
            <option value="spp">Strategic Partner</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="ended">Ended</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>PTO days/year</label>
          <input type="number" value={editForm.ptoDaysPerYear} onChange={(e) => setEditForm((f) => ({ ...f, ptoDaysPerYear: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>PTO days used</label>
          <input type="number" value={editForm.ptoUsed} onChange={(e) => setEditForm((f) => ({ ...f, ptoUsed: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Retention (ROL) score (0–100)</label>
          <input type="number" min="0" max="100" value={editForm.rolScore} onChange={(e) => setEditForm((f) => ({ ...f, rolScore: e.target.value }))} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>ROL notes</label>
          <textarea value={editForm.rolFeedback} onChange={(e) => setEditForm((f) => ({ ...f, rolFeedback: e.target.value }))} rows={2} className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
        </div>
        <div className="sm:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={editForm.isEOR} onChange={(e) => setEditForm((f) => ({ ...f, isEOR: e.target.checked }))} className="rounded" />
            <span className="flex items-center gap-1.5 text-xs font-700 text-[var(--black)]">Employer of Record (EOR)</span>
          </label>
          {editForm.isEOR && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Provider</label>
                <input value={editForm.eorProvider} onChange={(e) => setEditForm((f) => ({ ...f, eorProvider: e.target.value }))} placeholder="Deel, Remote, Oyster…" className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
              </div>
              <div>
                <label className={labelCls}>Country of employment</label>
                <input value={editForm.eorCountry} onChange={(e) => setEditForm((f) => ({ ...f, eorCountry: e.target.value }))} placeholder="Colombia" className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
              </div>
              <div>
                <label className={labelCls}>Compliance status</label>
                <select value={editForm.eorComplianceStatus} onChange={(e) => setEditForm((f) => ({ ...f, eorComplianceStatus: e.target.value as EORComplianceStatus }))} className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]">
                  <option value="pending">Pending setup</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="compliant">Compliant</option>
                  <option value="issue">Compliance issue</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Monthly EOR fee (USD)</label>
                <input type="number" value={editForm.eorMonthlyCost} onChange={(e) => setEditForm((f) => ({ ...f, eorMonthlyCost: e.target.value }))} placeholder="599" className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Benefits (comma-separated)</label>
                <input value={editForm.eorBenefits} onChange={(e) => setEditForm((f) => ({ ...f, eorBenefits: e.target.value }))} placeholder="Health insurance, Pension, 13th salary" className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Contract link</label>
                <input value={editForm.eorContractUrl} onChange={(e) => setEditForm((f) => ({ ...f, eorContractUrl: e.target.value }))} placeholder="https://…" className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]" />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
          {saving && <Spinner size="sm" />}Save
        </button>
        <button onClick={onCancel} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
      </div>
    </Card>
  );
}
