'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtCurrency, sortByTimestamp } from '@/lib/utils';
import type { Placement, EngagementType } from '@/lib/types';
import { ENGAGEMENT_LABELS } from '@/lib/types';
import {
  Search, Plus, Trophy, Shield, DollarSign, ChevronRight,
} from 'lucide-react';

const ENGAGEMENT_STYLE: Record<EngagementType, { color: string; bg: string }> = {
  eor: { color: '#C0392B', bg: '#FEF0F0' },
  managed: { color: '#16A085', bg: '#E8F8F5' },
  spp: { color: '#D35400', bg: '#FEF5EB' },
  direct: { color: '#555555', bg: '#F5F5F5' },
};

function EngagementPill({ type }: { type?: EngagementType }) {
  const t = type ?? 'direct';
  const s = ENGAGEMENT_STYLE[t];
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-700" style={{ color: s.color, background: s.bg }}>
      {ENGAGEMENT_LABELS[t]}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HiredPage() {
  const { showToast } = useToast();

  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [guaranteeFilter, setGuaranteeFilter] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [tab, setTab] = useState<'placements' | 'payroll' | 'referral'>('placements');

  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    candidateName: '', candidateEmail: '', orgName: '', openingTitle: '',
    pipelineCode: '', startDate: '', salaryAmount: '', salaryCurrency: 'USD',
    guaranteeDays: '90', referralSource: '', referralFee: '',
    engagementType: 'direct' as EngagementType,
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
    const matchEngagement = !engagementFilter || (p.engagementType ?? 'direct') === engagementFilter;
    if (guaranteeFilter === 'active') {
      const gs = guaranteeStatus(p);
      return matchSearch && matchEngagement && gs.label !== 'Expired' && gs.label !== 'N/A';
    }
    if (guaranteeFilter === 'expired') {
      const gs = guaranteeStatus(p);
      return matchSearch && matchEngagement && gs.label === 'Expired';
    }
    return matchSearch && matchEngagement;
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
        engagementType: form.engagementType,
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
        <div className="flex w-fit gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1">
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
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate, company, role..."
              className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
            />
          </div>
          {tab === 'placements' && (
            <>
              <select
                value={engagementFilter}
                onChange={(e) => setEngagementFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All engagements</option>
                <option value="direct">Direct Placement</option>
                <option value="managed">Managed Team</option>
                <option value="eor">EOR</option>
                <option value="spp">Strategic Partner</option>
              </select>
              <select
                value={guaranteeFilter}
                onChange={(e) => setGuaranteeFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All guarantees</option>
                <option value="active">Active guarantee</option>
                <option value="expired">Expired</option>
              </select>
            </>
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
                  <a
                    key={p.id}
                    href={`/hired/${p.id}`}
                    className="grid cursor-pointer grid-cols-[2fr_1fr_1fr_1fr_1fr_24px] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</p>
                        <EngagementPill type={p.engagementType} />
                      </div>
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
                  </a>
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
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Engagement type</label>
            <select
              value={form.engagementType}
              onChange={(e) => setForm((f) => ({ ...f, engagementType: e.target.value as EngagementType }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              <option value="direct">Direct Placement</option>
              <option value="managed">Managed Team</option>
              <option value="eor">EOR</option>
              <option value="spp">Strategic Partner</option>
            </select>
          </div>
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
