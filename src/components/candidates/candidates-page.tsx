'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { initials, sortByTimestamp, generateCandidateId } from '@/lib/utils';
import type { Candidate } from '@/lib/types';
import { Search, Plus, Download } from 'lucide-react';

// ─── Smart match config ───────────────────────────────────────────────────────

const ROLES = [
  'Customer Success Manager',
  'SDR / Sales Development Rep',
  'Technical Support Specialist',
  'Marketing Ops Specialist',
  'Developer',
  'Operations Manager',
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CandidatesPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // New candidate modal
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', location: '',
    currentRole: '', currentCompany: '', linkedIn: '', skills: '',
  });
  const [saving, setSaving] = useState(false);

  // Smart match
  const [matchRole, setMatchRole] = useState('');
  const [matchExp, setMatchExp] = useState('');
  const [matchSalary, setMatchSalary] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'candidates'));
      setCandidates(
        sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate)), 'createdAt')
      );
    } catch {
      showToast('Failed to load candidates', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Filter
  const filtered = candidates.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      [c.name, c.email, c.currentRole, c.location, ...(c.skills ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Smart match scoring
  function smartMatch(role: string, exp: string, salary: string): Candidate[] {
    if (!role) return filtered;
    const expNum = exp ? Number(exp.split('-')[0]) : -1;
    return [...filtered]
      .map((c) => {
        let score = 0;
        if (c.currentRole?.toLowerCase().includes(role.toLowerCase())) score += 40;
        if (expNum >= 0 && (c.experience ?? 0) >= expNum) score += 30;
        if (salary && (c.expectedSalary ?? 0) <= Number(salary)) score += 30;
        return { ...c, _score: score };
      })
      .filter((c) => c._score > 0)
      .sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  }

  const [matchResults, setMatchResults] = useState<Candidate[] | null>(null);

  function runMatch() {
    setMatchResults(smartMatch(matchRole, matchExp, matchSalary));
  }

  const display = matchResults ?? filtered;

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
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              Candidates
            </h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              Full ATS — {candidates.length} candidates
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <Download className="h-3.5 w-3.5" />
              Export ATS
            </button>
            <button
              onClick={() => setNewModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
              style={{ background: 'var(--green)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add candidate
            </button>
          </div>
        </div>

        {/* Smart match */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="mb-1 text-sm font-700 text-[var(--black)]">Smart candidate match</p>
                  <p className="text-xs text-[var(--light)]">
                    Select a role and criteria — we&apos;ll rank the best available candidates.
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-end gap-2">
                  <select
                    value={matchRole}
                    onChange={(e) => setMatchRole(e.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                  >
                    <option value="">Select role...</option>
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <select
                    value={matchExp}
                    onChange={(e) => setMatchExp(e.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                  >
                    <option value="">Experience level...</option>
                    <option value="0-2">Junior (0-2 yrs)</option>
                    <option value="2-5">Mid (2-5 yrs)</option>
                    <option value="5">Senior (5+ yrs)</option>
                  </select>
                  <select
                    value={matchSalary}
                    onChange={(e) => setMatchSalary(e.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                  >
                    <option value="">Salary range...</option>
                    <option value="1500">$1,000–$1,500/mo</option>
                    <option value="2000">$1,500–$2,000/mo</option>
                    <option value="2500">$2,000–$2,500/mo</option>
                    <option value="9999">$2,500+/mo</option>
                  </select>
                  <button
                    onClick={runMatch}
                    className="rounded-lg px-4 py-2 text-xs font-700 text-white"
                    style={{ background: 'var(--green)' }}
                  >
                    Find best matches →
                  </button>
                  {matchResults && (
                    <button
                      onClick={() => setMatchResults(null)}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--light)] hover:text-[var(--mid)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, skill..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All statuses</option>
                <option value="new">New</option>
                <option value="screening">Screening</option>
                <option value="interviewing">Interviewing</option>
                <option value="offer">Offer</option>
                <option value="hired">Hired</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div>Candidate</div>
                  <div>Role</div>
                  <div>Skills</div>
                  <div>Status</div>
                  <div></div>
                </div>
                {display.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">
                    No candidates found.
                  </div>
                ) : (
                  display.map((c) => (
                    <div
                      key={c.id}
                      className="grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                      onClick={() => router.push(`/candidates/${c.id}`)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-700 text-white"
                          style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                        >
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-xs font-600 text-[var(--black)]">{c.name}</p>
                            <span className="shrink-0 rounded font-mono text-[9px] font-600 text-[var(--light)]">{c.code ?? c.id}</span>
                          </div>
                          <p className="truncate text-[10px] text-[var(--light)]">{c.email}</p>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-[var(--mid)]">{c.currentRole ?? '—'}</p>
                        {c.currentCompany && (
                          <p className="truncate text-[10px] text-[var(--light)]">{c.currentCompany}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(c.skills ?? []).slice(0, 3).map((s, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-500 text-[var(--mid)]"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                      <div>
                        {c.status ? (
                          <Badge label={c.status} variant="status" />
                        ) : (
                          <span className="text-xs text-[var(--light)]">—</span>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/candidates/${c.id}`);
                          }}
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
      </div>

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
