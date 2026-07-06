'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  auth,
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, fmtCurrency, sortByTimestamp, initials } from '@/lib/utils';
import type { Placement, EngagementType, Candidate, Organization } from '@/lib/types';
import { ENGAGEMENT_LABELS } from '@/lib/types';
import { Search, X } from 'lucide-react';
import { NW, MONO, Icon, Avatar, CompanyTile, Button } from '@/components/nw/primitives';
import { PageHeader, Card, SegTabs, Table, Th, Td, TableRow, StatusBadge } from '@/components/nw/shell-ui';

// Fire a follower broadcast to /api/notify (best-effort — never blocks the save).
async function broadcastNotify(payload: Record<string, unknown>): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    /* never block the placement save */
  }
}

const AVA_PALETTE = ['#16A085', '#E74C7C', '#AF7AC5', '#3B82F6', '#12866E', '#EAB308', '#EC5290'];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVA_PALETTE[h % AVA_PALETTE.length];
}

type HireTab = 'current' | 'ended' | 'all';

// Map our engagement model onto the prototype's Team / EOR-plan columns.
function teamLabel(p: Placement): string | null {
  return (p.engagementType ?? 'direct') === 'managed' ? 'Managed team' : null;
}
function eorPlanLabel(p: Placement): string {
  const t = p.engagementType ?? 'direct';
  if (t === 'eor') return 'EOR';
  if (t === 'spp') return 'SPP';
  if (t === 'managed') return 'Managed';
  return 'Direct';
}
function statusKey(p: Placement): string {
  if (p.status === 'ended') return 'ended';
  if (p.status === 'on_hold') return 'paused';
  return 'active';
}

export default function HiredPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [placements, setPlacements] = useState<Placement[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<HireTab>('current');

  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    candidateId: '', candidateName: '', candidateEmail: '', orgId: '', orgName: '', openingTitle: '',
    pipelineCode: '', startDate: '', salaryAmount: '', salaryCurrency: 'USD',
    guaranteeDays: '90', referralSource: '', referralFee: '',
    engagementType: 'direct' as EngagementType,
  });
  const [saving, setSaving] = useState(false);

  // Candidate directory for the placement picker — a placement is keyed by the
  // selected candidate's ID so /hired/<id> and /candidates/<id> are one person.
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candQuery, setCandQuery] = useState('');
  const [candOpen, setCandOpen] = useState(false);
  const candBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (candBoxRef.current && !candBoxRef.current.contains(e.target as Node)) setCandOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const candMatches = useMemo(() => {
    const q = candQuery.trim().toLowerCase();
    const placedIds = new Set(placements.map((p) => p.candidateId).filter(Boolean));
    return candidates
      .filter((c) => !placedIds.has(c.id))
      .filter((c) => !q || [c.name, c.email, c.code, c.id].filter(Boolean).join(' ').toLowerCase().includes(q))
      .slice(0, 8);
  }, [candidates, candQuery, placements]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    // Each collection loads independently — a failure on one (e.g. orgs rules)
    // must never block the candidate directory used by the placement picker.
    const [placeRes, candRes, orgRes] = await Promise.allSettled([
      getDocs(collection(db, 'placements')),
      getDocs(collection(db, 'candidates')),
      getDocs(collection(db, 'organizations')),
    ]);
    if (placeRes.status === 'fulfilled') {
      setPlacements(sortByTimestamp(placeRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)), 'createdAt'));
    } else {
      showToast('Failed to load placements', 'error');
    }
    if (candRes.status === 'fulfilled') {
      setCandidates(candRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate)));
    }
    if (orgRes.status === 'fulfilled') {
      const m: Record<string, string> = {};
      const list: Array<{ id: string; name: string }> = [];
      orgRes.value.docs.forEach((d) => {
        const data = d.data() as Organization & { shortId?: string };
        if (data.name) { m[d.id] = data.name; if (data.shortId) m[data.shortId] = data.name; list.push({ id: d.id, name: data.name }); }
      });
      setOrgNames(m);
      setOrgs(list.sort((a, b) => a.name.localeCompare(b.name)));
    }
    setLoading(false);
  }

  const orgNameOf = (p: Placement) => p.orgName || orgNames[p.orgId] || 'No organization';

  const current = placements.filter((p) => p.status !== 'ended');
  const ended = placements.filter((p) => p.status === 'ended');
  const rows = tab === 'current' ? current : tab === 'ended' ? ended : placements;

  const onManaged = placements.filter((p) => (p.engagementType ?? 'direct') === 'managed').length;
  const onEor = placements.filter((p) => (p.engagementType ?? 'direct') === 'eor').length;
  const salaried = placements.filter((p) => (p.salaryAmount ?? 0) > 0);
  const avgSalary = salaried.length
    ? Math.round(salaried.reduce((s, p) => s + (p.salaryAmount ?? 0), 0) / salaried.length)
    : 0;
  const avgLabel = avgSalary >= 1000 ? `$${(avgSalary / 1000).toFixed(1)}k` : `$${avgSalary}`;

  const stats: [string, string | number][] = [
    ['Currently placed', current.length],
    ['On a managed team', onManaged],
    ['Avg. salary', avgSalary ? `${avgLabel}/mo` : '—'],
    ['On EOR', onEor],
  ];

  function exportCsv() {
    const head = ['Name', 'Organization', 'Role', 'Engagement', 'Salary', 'Currency', 'Start date', 'Status'];
    const lines = placements.map((p) => [
      p.candidateName ?? '', orgNameOf(p), p.openingTitle ?? '', ENGAGEMENT_LABELS[p.engagementType ?? 'direct'],
      String(p.salaryAmount ?? ''), p.salaryCurrency ?? '', p.startDate ?? '', p.status ?? 'active',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `nearwork-placements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function savePlacement() {
    if (!form.candidateId || !form.candidateName) { showToast('Pick a candidate from the directory first', 'error'); return; }
    if (!form.orgId || !form.startDate) { showToast('Pick a company and a start date', 'error'); return; }
    setSaving(true);
    try {
      const guaranteeEndDate = form.startDate && form.guaranteeDays
        ? new Date(new Date(form.startDate).getTime() + Number(form.guaranteeDays) * 86400000).toISOString().slice(0, 10)
        : undefined;
      const ref = doc(db, 'placements', form.candidateId);
      const existing = await getDoc(ref);
      if (existing.exists()) { showToast('This candidate already has a placement record', 'error'); setSaving(false); return; }
      await setDoc(ref, {
        code: form.candidateId, candidateId: form.candidateId, candidateName: form.candidateName,
        candidateEmail: form.candidateEmail, orgName: form.orgName, orgId: form.orgId, openingTitle: form.openingTitle,
        pipelineCode: form.pipelineCode, startDate: form.startDate,
        salaryAmount: form.salaryAmount ? Number(form.salaryAmount) : 0, salaryCurrency: form.salaryCurrency,
        engagementType: form.engagementType, guaranteeDays: form.guaranteeDays ? Number(form.guaranteeDays) : 90,
        guaranteeEndDate, referralSource: form.referralSource, referralFee: form.referralFee ? Number(form.referralFee) : null,
        status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      showToast(`Placement recorded · ID ${form.candidateId}`, 'success');
      // Notify the role's followers of the new hire. The opening/pipeline code
      // lives on form.pipelineCode — skip gracefully if it wasn't entered.
      if (form.pipelineCode) {
        broadcastNotify({
          event: 'broadcast',
          broadcastType: 'new_hire',
          entityType: 'opening',
          entityId: form.pipelineCode,
          orgId: form.orgId,
          candidateName: form.candidateName,
          candidateCode: form.candidateId,
        });
      }
      setNewModal(false);
      setForm((f) => ({ ...f, candidateId: '', candidateName: '', candidateEmail: '' }));
      load();
    } catch {
      showToast('Failed to save placement', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <MainLayout>
      <div>
        <PageHeader
          overline="Staffing"
          title="Hired"
          subtitle="Everyone placed into a client team — staffing, HR, EOR and payroll all live here."
          actions={
            <>
              <Button variant="secondary" size="md" icon="download" onClick={exportCsv}>Export placements</Button>
              <Button variant="primary" size="md" icon="plus" onClick={() => setNewModal(true)}>New placement</Button>
            </>
          }
        />

        {/* Stat strip */}
        <div style={{ display: 'flex', gap: 28, marginBottom: 22, padding: '4px 2px', flexWrap: 'wrap' }}>
          {stats.map(([l, v]) => (
            <div key={l}>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: NW.black }}>{v}</div>
              <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <SegTabs
            tabs={[
              { id: 'current', label: 'Current', count: current.length },
              { id: 'ended', label: 'Ended', count: ended.length },
              { id: 'all', label: 'All', count: placements.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Spinner /></div>
        ) : (
          <Card pad={0}>
            <div style={{ padding: '18px 6px 4px' }}>
              <Table>
                <thead>
                  <tr>
                    <Th style={{ paddingLeft: 22 }}>Hire</Th>
                    <Th>Organization</Th>
                    <Th>Team</Th>
                    <Th>EOR plan</Th>
                    <Th>Salary</Th>
                    <Th>Start date</Th>
                    <Th align="right" style={{ paddingRight: 22 }}>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <Td style={{ paddingLeft: 22 }}><span style={{ color: NW.gray400 }}>No placements here yet.</span></Td>
                      <Td /><Td /><Td /><Td /><Td /><Td />
                    </tr>
                  ) : (
                    rows.map((p) => {
                      const team = teamLabel(p);
                      return (
                        <TableRow key={p.id} onClick={() => router.push(`/hired/${p.id}`)}>
                          <Td style={{ paddingLeft: 22 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                              <Avatar initials={initials(p.candidateName || '') || '—'} size={38} bg={colorFor(p.candidateId || p.id)} />
                              <span>
                                <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{p.candidateName ?? '—'}</span>
                                <span style={{ display: 'block', fontSize: 12, color: NW.gray500, marginTop: 1 }}>{p.openingTitle || '—'}</span>
                              </span>
                            </span>
                          </Td>
                          <Td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                              <CompanyTile logo={(orgNameOf(p)[0] || '?').toUpperCase()} color={colorFor(orgNameOf(p))} size={26} radius={7} />
                              <span style={{ fontSize: 13, color: NW.gray700 }}>{orgNameOf(p)}</span>
                            </span>
                          </Td>
                          <Td>
                            {team ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}22`, borderRadius: 999, padding: '3px 10px' }}>
                                <Icon name="users-round" size={12} color={NW.teal600} />{team}
                              </span>
                            ) : (
                              <span style={{ fontSize: 12.5, color: NW.gray400 }}>Individual</span>
                            )}
                          </Td>
                          <Td>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: NW.gray700, background: NW.gray50, border: `1px solid ${NW.gray200}`, borderRadius: 7, padding: '2px 9px' }}>{eorPlanLabel(p)}</span>
                          </Td>
                          <Td>
                            <span style={{ fontFamily: MONO, fontSize: 13, color: NW.gray700 }}>
                              {p.salaryAmount ? fmtCurrency(p.salaryAmount, p.salaryCurrency) : '—'}
                              {p.salaryAmount ? <span style={{ fontSize: 11, color: NW.gray400 }}>/mo</span> : null}
                            </span>
                          </Td>
                          <Td><span style={{ fontSize: 13, color: NW.gray600 }}>{p.startDate ? fmtDate(p.startDate) : '—'}</span></Td>
                          <Td align="right" style={{ paddingRight: 22 }}><StatusBadge status={statusKey(p)} /></Td>
                        </TableRow>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      {/* New placement modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="New placement" size="lg">
        <div className="mb-4" ref={candBoxRef}>
          <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Candidate *</label>
          {form.candidateId ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--green)] bg-[var(--bg)] px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-[10px] font-700 text-white">{initials(form.candidateName)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-600 text-[var(--black)]">{form.candidateName}</p>
                  <p className="truncate text-[10px] text-[var(--light)]">{form.candidateEmail || '—'} · ID {form.candidateId}</p>
                </div>
              </div>
              <button type="button" onClick={() => setForm((f) => ({ ...f, candidateId: '', candidateName: '', candidateEmail: '' }))} className="ml-2 shrink-0 rounded-md p-1 text-[var(--light)] hover:bg-white hover:text-[var(--black)]"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
              <input
                value={candQuery}
                onChange={(e) => { setCandQuery(e.target.value); setCandOpen(true); }}
                onFocus={() => setCandOpen(true)}
                placeholder="Search candidate by name, email, or ID..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2.5 pl-8 pr-3 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
              {candOpen && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-white shadow-lg">
                  {candMatches.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-[var(--light)]">{candidates.length === 0 ? 'No candidates yet.' : 'No matching candidate.'}</div>
                  ) : (
                    candMatches.map((c) => (
                      <button key={c.id} type="button"
                        onClick={() => { setForm((f) => ({ ...f, candidateId: c.id, candidateName: c.name, candidateEmail: c.email ?? '' })); setCandQuery(''); setCandOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg)]">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg)] text-[10px] font-700 text-[var(--mid)]">{initials(c.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-600 text-[var(--black)]">{c.name}</p>
                          <p className="truncate text-[10px] text-[var(--light)]">{c.email || '—'} · ID {c.code ?? c.id}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Organization *</label>
            <select value={form.orgId} onChange={(e) => { const o = orgs.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, orgId: e.target.value, orgName: o?.name ?? '' })); }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white">
              <option value="">Select a company…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {[
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
              <input type={type ?? 'text'} value={(form as Record<string, string>)[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Engagement type</label>
            <select value={form.engagementType} onChange={(e) => setForm((f) => ({ ...f, engagementType: e.target.value as EngagementType }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white">
              <option value="direct">Direct Placement</option>
              <option value="managed">Managed Team</option>
              <option value="eor">EOR</option>
              <option value="spp">Strategic Partner</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setNewModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          <button onClick={savePlacement} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
            {saving && <Spinner size="sm" />}
            Save placement
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}
