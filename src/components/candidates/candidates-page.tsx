'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { initials, sortByTimestamp, generateCandidateId, fmtRelative, fmtCurrency, candidateLocationLabel, properName } from '@/lib/utils';
import type { Candidate } from '@/lib/types';
import { Trash2 } from 'lucide-react';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { NW, MONO, Icon, Avatar as NWAvatar, Button as NWButton } from '@/components/nw/primitives';
import { PageHeader, Card as NWCard, SegTabs } from '@/components/nw/shell-ui';
import { type IconName } from 'lucide-react/dynamic';

// How many candidates to show per page in the ATS list.
const PAGE_SIZE = 25;

const AVA_PALETTE = ['#16A085', '#E74C7C', '#AF7AC5', '#3B82F6', '#12866E', '#EAB308', '#EC5290'];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVA_PALETTE[h % AVA_PALETTE.length];
}

// ─── Menu filter (dropdown) ───────────────────────────────────────────────────

function MenuFilter({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: NW.gray700, background: NW.white, border: `1px solid ${open ? NW.teal500 : NW.gray200}`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer' }}
      >
        <Icon name={icon} size={14} color={NW.gray500} />
        <span style={{ color: NW.gray500 }}>{label}:</span>
        <span style={{ fontWeight: 600, color: NW.black }}>{cur ? cur.label : 'All'}</span>
        <Icon name="chevron-down" size={14} color={NW.gray400} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 61, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 11, boxShadow: '0 14px 36px rgba(0,0,0,0.16)', padding: 5, minWidth: 190, maxHeight: 300, overflowY: 'auto' }}>
            {options.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className="nw-search-result"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: on ? NW.teal50 : NW.white, cursor: 'pointer', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: NW.black, textAlign: 'left' }}
                >
                  <span style={{ flex: 1 }}>{o.label}</span>
                  {on && <Icon name="check" size={14} color={NW.teal600} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CandidatesPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  // Prototype list controls: All/Active/Inactive tabs + Role / Location / Sort filters
  const [listTab, setListTab] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleG, setRoleG] = useState('all');
  const [cityF, setCityF] = useState('all');
  const [sortF, setSortF] = useState('recent');
  const [page, setPage] = useState(1);
  const [pipelineTitles, setPipelineTitles] = useState<Record<string, string>>({});
  // Latest application per candidate (id/code → {title, when, status}) so the
  // "Last activity" column also reflects applicants who applied and are waiting.
  const [appByCandidate, setAppByCandidate] = useState<Record<string, { title: string; whenTs: unknown; status?: string }>>({});

  // New candidate modal
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', location: '',
    currentRole: '', currentCompany: '', linkedIn: '', skills: '',
  });
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Candidate | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'candidates', deleteTarget.id));
      setCandidates((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      showToast(`Deleted ${deleteTarget.name || deleteTarget.id}`, 'success');
      setDeleteTarget(null);
    } catch {
      showToast('Failed to delete candidate', 'error');
    } finally {
      setDeleting(false);
    }
  }

  // A candidate is "empty" if they have no meaningful profile data
  function isEmpty(c: Candidate) {
    return !c.name && !c.email && !c.currentRole && !(c.skills?.length);
  }

  // Resolve opening/pipeline titles + latest application per candidate for the
  // "Last activity" column.
  useEffect(() => {
    getDocs(collection(db, 'pipelines'))
      .then((snap) => {
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const x = d.data() as { code?: string; title?: string };
          if (x.code) m[x.code] = x.title || x.code;
        });
        setPipelineTitles(m);
      })
      .catch(() => {});

    getDocs(collection(db, 'applications'))
      .then((snap) => {
        const tsMs = (v: unknown): number => {
          if (!v) return 0;
          if (typeof v === 'string') return Date.parse(v) || 0;
          if (typeof v === 'object' && v !== null && 'seconds' in v) return (v as { seconds: number }).seconds * 1000;
          return 0;
        };
        const m: Record<string, { title: string; whenTs: unknown; status?: string }> = {};
        snap.docs.forEach((d) => {
          const a = d.data() as { candidateId?: string; candidateCode?: string; openingTitle?: string; jobTitle?: string; openingCode?: string; submittedAt?: unknown; status?: string };
          const title = a.openingTitle || a.jobTitle || a.openingCode || 'a role';
          const entry = { title, whenTs: a.submittedAt, status: a.status };
          for (const key of [a.candidateId, a.candidateCode]) {
            if (!key) continue;
            const prev = m[key];
            if (!prev || tsMs(a.submittedAt) >= tsMs(prev.whenTs)) m[key] = entry;
          }
        });
        setAppByCandidate(m);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, 'candidates'),
      (snap) => {
        setCandidates(
          sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate)), 'createdAt')
        );
        setLoading(false);
      },
      () => {
        showToast('Failed to load candidates', 'error');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  function load() {
    // no-op — list is kept live by the onSnapshot listener above
  }

  // ── Derived helpers for the list ───────────────────────────────────────────
  // `role` often holds the account-type marker "candidate" (set at signup), not a
  // job title — prefer the real title fields and skip that placeholder value.
  const candRole = (c: Candidate) => {
    const titles = [c.currentRole, c.targetRole, c.headline, c.role]
      .map((x) => (x ?? '').trim())
      .filter((x) => x && x.toLowerCase() !== 'candidate');
    return titles[0] || '';
  };
  // Location label: Colombia → "City, Department"; other countries → country.
  const candCity = (c: Candidate) => candidateLocationLabel(c);
  function roleGroup(role: string): string {
    const r = role.toLowerCase();
    if (/engineer|developer|devops|sre|backend|frontend|full.?stack|software/.test(r)) return 'Engineering';
    if (/design|ux|ui/.test(r)) return 'Design';
    if (/product manager|product owner|\bpm\b/.test(r)) return 'Product';
    if (/data|analyst|analytics|scientist|bi\b/.test(r)) return 'Data';
    if (/qa|quality|test/.test(r)) return 'QA';
    if (/customer success|support|\bcsm?\b|account manager/.test(r)) return 'Customer Success';
    return 'Other';
  }
  function isActiveCandidate(c: Candidate): boolean {
    const s = String(c.status ?? '').toLowerCase();
    return !['rejected', 'withdrawn', 'inactive'].includes(s);
  }
  function monthlySalary(c: Candidate): string | null {
    if (c.expectedSalaryAmount != null) return `${fmtCurrency(Number(c.expectedSalaryAmount), c.expectedSalaryCurrency || 'USD')}/mo`;
    if (typeof c.expectedSalary === 'number') return `${fmtCurrency(c.expectedSalary, 'USD')}/mo`;
    if (typeof c.expectedSalary === 'string' && c.expectedSalary.trim()) return c.expectedSalary;
    return null;
  }
  function lastActivity(c: Candidate): { title: string; when: string; stage?: string } | null {
    // 1) In a pipeline → show the opening + current stage.
    if (c.activePipelineCode) {
      return {
        title: pipelineTitles[c.activePipelineCode] || candRole(c) || c.activePipelineCode,
        when: c.updatedAt ? fmtRelative(c.updatedAt) : c.createdAt ? fmtRelative(c.createdAt) : '',
        stage: c.activePipelineStage ? c.activePipelineStage.replace(/-/g, ' ') : undefined,
      };
    }
    // 2) Applied but not yet pulled into a pipeline → show the role + waiting.
    const app = appByCandidate[c.id] || (c.code ? appByCandidate[c.code] : undefined);
    if (app) {
      const rejected = String(app.status ?? '').toLowerCase() === 'rejected';
      return {
        title: app.title,
        when: app.whenTs ? fmtRelative(app.whenTs as Parameters<typeof fmtRelative>[0]) : '',
        stage: rejected ? 'not selected' : 'waiting on review',
      };
    }
    return null;
  }

  const ROLE_GROUPS = ['Engineering', 'Design', 'Product', 'Data', 'QA', 'Customer Success', 'Other'];
  const cityOptions = [...new Set(candidates.map(candCity).filter(Boolean))].sort();

  // ── Tabs + filters + sort ──────────────────────────────────────────────────
  const tabCounts = {
    all: candidates.length,
    active: candidates.filter(isActiveCandidate).length,
    inactive: candidates.filter((c) => !isActiveCandidate(c)).length,
  };
  let rows = candidates;
  if (listTab === 'active') rows = rows.filter(isActiveCandidate);
  else if (listTab === 'inactive') rows = rows.filter((c) => !isActiveCandidate(c));
  if (roleG !== 'all') rows = rows.filter((c) => roleGroup(candRole(c)) === roleG);
  if (cityF !== 'all') rows = rows.filter((c) => candCity(c) === cityF);
  rows = [...rows].sort((a, b) => {
    if (sortF === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortF === 'salary') return (Number(b.expectedSalaryAmount ?? b.expectedSalary ?? 0)) - (Number(a.expectedSalaryAmount ?? a.expectedSalary ?? 0));
    return 0; // 'recent' — list is already sorted by createdAt desc
  });
  const display = rows;

  // ── Pagination (25 per page) ───────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(display.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = display.slice(pageStart, pageStart + PAGE_SIZE);

  // Jump back to the first page whenever the filters/sort/tab change, so you
  // never land on a now-empty page.
  useEffect(() => { setPage(1); }, [listTab, roleG, cityF, sortF]);
  // Keep the page in range if the list shrinks (e.g. after a delete).
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  async function saveNewCandidate() {
    if (!form.name || !form.email) {
      showToast('Name and email are required', 'error');
      return;
    }
    setSaving(true);
    try {
      // Give every new candidate a short, human-readable ID and use it as the
      // Firestore document ID, so /candidates/<code> resolves directly and a
      // future hired placement can reuse the same ID. Retry a few times in the
      // (very unlikely) event of a collision.
      let code = generateCandidateId();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await getDoc(doc(db, 'candidates', code));
        if (!existing.exists()) break;
        code = generateCandidateId();
      }
      await setDoc(doc(db, 'candidates', code), {
        code,
        name: form.name,
        email: form.email,
        phone: form.phone,
        location: form.location,
        currentRole: form.currentRole,
        currentCompany: form.currentCompany,
        linkedIn: form.linkedIn,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        status: 'new',
        source: 'admin.nearwork.co',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(`Candidate added · ID ${code}`, 'success');
      setNewModal(false);
      setForm({ name: '', email: '', phone: '', location: '', currentRole: '', currentCompany: '', linkedIn: '', skills: '' });
      load();
    } catch {
      showToast('Failed to save candidate', 'error');
    } finally {
      setSaving(false);
    }
  }

  function exportCSV() {
    const header = 'Name,Email,Phone,Location,Role,Company,Skills,Status\n';
    const body = display
      .map(
        (c) =>
          [c.name, c.email, c.phone, c.location, c.currentRole, c.currentCompany, (c.skills ?? []).join(';'), c.status]
            .map((v) => `"${v ?? ''}"`)
            .join(',')
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nearwork-candidates.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <MainLayout>
      <div className="space-y-5">
        <PageHeader
          overline="Pipeline"
          title="Candidates"
          subtitle={`Everyone in the talent network — ${candidates.length} in the ATS, searchable across every client and opening.`}
          actions={
            <>
              <NWButton variant="secondary" size="md" icon="download" onClick={exportCSV}>Export ATS</NWButton>
              <NWButton variant="primary" size="md" icon="plus" onClick={() => setNewModal(true)}>Add candidate</NWButton>
            </>
          }
        />

        {/* Tabs + filters */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <SegTabs
            tabs={[
              { id: 'all', label: 'All', count: tabCounts.all },
              { id: 'active', label: 'Active', count: tabCounts.active },
              { id: 'inactive', label: 'Inactive', count: tabCounts.inactive },
            ]}
            active={listTab}
            onChange={setListTab}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <MenuFilter icon="briefcase" label="Role" value={roleG} options={[{ value: 'all', label: 'All roles' }, ...ROLE_GROUPS.map((g) => ({ value: g, label: g }))]} onChange={setRoleG} />
            <MenuFilter icon="map-pin" label="Location" value={cityF} options={[{ value: 'all', label: 'All locations' }, ...cityOptions.map((c) => ({ value: c, label: c }))]} onChange={setCityF} />
            <MenuFilter icon="arrow-down-up" label="Sort" value={sortF} options={[{ value: 'recent', label: 'Most recent' }, { value: 'name', label: 'Name (A–Z)' }, { value: 'salary', label: 'Salary (high→low)' }]} onChange={setSortF} />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Spinner /></div>
        ) : (
          <NWCard pad={0}>
            <div style={{ padding: '14px 6px 4px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr>
                    {[['Candidate', 'left', 22], ['Role', 'left', 16], ['Status', 'left', 16], ['Salary expectation', 'left', 16], ['Last activity', 'left', 16], ['', 'right', 22]].map(([label, align, padX], i) => (
                      <th key={i} style={{ textAlign: align as 'left' | 'right', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400, padding: `0 16px 12px`, paddingLeft: i === 0 ? padX as number : 16, paddingRight: i === 5 ? padX as number : 16, whiteSpace: 'nowrap' }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {display.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: '48px 0', textAlign: 'center', fontSize: 14, color: NW.gray400 }}>No candidates found.</td></tr>
                  ) : (
                    pageRows.map((c) => {
                      const act = lastActivity(c);
                      const active = isActiveCandidate(c);
                      const sal = monthlySalary(c);
                      return (
                        <tr key={c.id} onClick={() => router.push(`/candidates/${c.id}`)} className="nw-row" style={{ cursor: 'pointer' }}>
                          <td style={{ padding: '14px 16px', paddingLeft: 22, borderTop: `1px solid ${NW.gray100}`, verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                              {c.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.photoUrl} alt={c.name} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <NWAvatar initials={initials(c.name) || '—'} size={38} bg={colorFor(c.id)} />
                              )}
                              <span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{properName(c.name) || 'No name'}</span>
                                  {isEmpty(c) && <span style={{ fontSize: 9, fontWeight: 700, color: NW.rose600, background: NW.rose50, borderRadius: 999, padding: '1px 6px' }}>Empty</span>}
                                </span>
                                {candCity(c) && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: NW.gray500, marginTop: 2 }}>
                                    <Icon name="map-pin" size={12} color={NW.gray400} />{candCity(c)}
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', borderTop: `1px solid ${NW.gray100}`, verticalAlign: 'middle' }}>
                            <span style={{ fontSize: 13, color: NW.gray700 }}>{candRole(c) || '—'}</span>
                          </td>
                          <td style={{ padding: '14px 16px', borderTop: `1px solid ${NW.gray100}`, verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: active ? NW.green600 : NW.gray500 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? NW.green500 : NW.gray300 }} />
                              {active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', borderTop: `1px solid ${NW.gray100}`, verticalAlign: 'middle' }}>
                            <span style={{ fontFamily: MONO, fontSize: 13, color: sal ? NW.gray700 : NW.gray300 }}>{sal || '—'}</span>
                          </td>
                          <td style={{ padding: '14px 16px', borderTop: `1px solid ${NW.gray100}`, verticalAlign: 'middle' }}>
                            {act ? (
                              <span style={{ fontSize: 12.5, color: NW.gray600 }}>
                                <span style={{ color: NW.gray400 }}>Applied to </span>{act.title}
                                <span style={{ display: 'block', fontSize: 11, color: NW.gray400, marginTop: 1 }}>{act.when}{act.stage ? ` · ${act.stage}` : ''}</span>
                              </span>
                            ) : <span style={{ fontSize: 12.5, color: NW.gray300 }}>—</span>}
                          </td>
                          <td style={{ padding: '14px 16px', paddingRight: 22, borderTop: `1px solid ${NW.gray100}`, textAlign: 'right', verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }} title="Delete candidate" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Trash2 className="h-3.5 w-3.5" style={{ color: NW.rose500 }} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); router.push(`/candidates/${c.id}`); }} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="chevron-right" size={15} color={NW.gray500} />
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {display.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 22px', borderTop: `1px solid ${NW.gray100}` }}>
                <span style={{ fontSize: 12.5, color: NW.gray500 }}>
                  Showing <strong style={{ color: NW.black }}>{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, display.length)}</strong> of {display.length}
                </span>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: safePage <= 1 ? NW.gray300 : NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '7px 12px', cursor: safePage <= 1 ? 'not-allowed' : 'pointer' }}
                    >
                      <Icon name="chevron-left" size={14} color={safePage <= 1 ? NW.gray300 : NW.gray500} />Prev
                    </button>
                    <span style={{ fontSize: 12.5, color: NW.gray600 }}>Page <strong style={{ color: NW.black }}>{safePage}</strong> of {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: safePage >= totalPages ? NW.gray300 : NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '7px 12px', cursor: safePage >= totalPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next<Icon name="chevron-right" size={14} color={safePage >= totalPages ? NW.gray300 : NW.gray500} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </NWCard>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Modal open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="Delete candidate">
        <p className="text-sm text-[var(--mid)] leading-relaxed mb-5">
          Are you sure you want to permanently delete{' '}
          <strong className="text-[var(--black)]">{deleteTarget?.name || deleteTarget?.id}</strong>?
          {deleteTarget && isEmpty(deleteTarget) && (
            <span className="ml-1 text-red-500">This candidate has no profile data.</span>
          )}{' '}
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)] disabled:opacity-50"
          >
            Cancel
          </button>
          <HoldToDelete onConfirm={confirmDelete} busy={deleting} label="Hold to delete" />
        </div>
      </Modal>

      {/* New candidate modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Add candidate" size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { key: 'name', label: 'Full name *', placeholder: 'Jane Smith' },
            { key: 'email', label: 'Email *', placeholder: 'jane@example.com', type: 'email' },
            { key: 'phone', label: 'Phone', placeholder: '+1 555 0100' },
            { key: 'location', label: 'Location', placeholder: 'Bogotá, Colombia' },
            { key: 'currentRole', label: 'Current role', placeholder: 'Customer Success Manager' },
            { key: 'currentCompany', label: 'Current company', placeholder: 'Acme Inc.' },
            { key: 'linkedIn', label: 'LinkedIn URL', placeholder: 'linkedin.com/in/...' },
            { key: 'skills', label: 'Skills (comma-separated)', placeholder: 'Salesforce, English, Support', colSpan: true },
          ].map(({ key, label, placeholder, type, colSpan }) => (
            <div key={key} className={colSpan ? 'sm:col-span-2' : ''}>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                {label}
              </label>
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
          <button
            onClick={() => setNewModal(false)}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
          >
            Cancel
          </button>
          <button
            onClick={saveNewCandidate}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {saving && <Spinner size="sm" />}
            Add candidate
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}
