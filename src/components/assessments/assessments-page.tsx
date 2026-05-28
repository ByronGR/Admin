'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { fmtDate, sortByTimestamp } from '@/lib/utils';
import type { Assessment, Candidate, Opening } from '@/lib/types';
import { TECHNICAL_QUESTIONS, DISC_QUESTIONS, DISC_LABELS } from '@/lib/question-bank';
import {
  Search,
  ClipboardList,
  CheckCircle,
  Clock,
  AlertCircle,
  Trash2,
  Plus,
  Copy,
  Check,
  Send,
} from 'lucide-react';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tab, setTab] = useState<'results' | 'bank'>('results');
  const [bankCategory, setBankCategory] = useState<'technical' | 'disc'>('technical');
  const [bankSearch, setBankSearch] = useState('');

  // Create assessment modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ candidateId: '', openingId: '' });
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [aSnap, cSnap, oSnap] = await Promise.all([
        getDocs(collection(db, 'assessments')),
        getDocs(collection(db, 'candidates')),
        getDocs(collection(db, 'openings')),
      ]);
      setAssessments(sortByTimestamp(aSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Assessment)), 'createdAt'));
      setCandidates(cSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate)));
      setOpenings(oSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
    } catch {
      showToast('Failed to load assessments', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createAssessment() {
    if (!createForm.candidateId) {
      showToast('Select a candidate', 'error');
      return;
    }
    setCreating(true);
    try {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      const candidate = candidates.find((c) => c.id === createForm.candidateId);
      const opening = openings.find((o) => o.id === createForm.openingId);

      // Build questions: all 50 technical + all 25 DISC
      const techQs = TECHNICAL_QUESTIONS.map((q) => ({
        id: q.id,
        text: q.text,
        category: q.category,
        options: q.options,
        correctIndex: q.correctIndex,
        type: 'technical',
      }));
      const discQs = DISC_QUESTIONS.map((q) => ({
        id: q.id,
        text: q.text,
        category: 'DISC',
        options: q.options.map((o) => o.text),
        correctIndex: -1, // no single correct answer for DISC
        discOptions: q.options.map((o) => o.style),
        type: 'disc',
      }));

      await addDoc(collection(db, 'assessments'), {
        candidateId: createForm.candidateId,
        candidateName: candidate?.name ?? '',
        candidateEmail: candidate?.email ?? '',
        openingId: createForm.openingId || null,
        openingTitle: opening?.title ?? null,
        orgId: opening?.orgId ?? null,
        orgName: opening?.orgName ?? null,
        uniqueToken: token,
        expiresAt,
        questions: [...techQs, ...discQs],
        status: 'pending',
        technicalScore: null,
        discStyle: null,
        discScores: null,
        createdBy: user?.uid ?? '',
        createdAt: serverTimestamp(),
      });

      const link = `https://talent.nearwork.co/assessment?token=${token}`;
      setGeneratedLink(link);
      showToast('Assessment created', 'success');
      loadAll();
    } catch {
      showToast('Failed to create assessment', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function deleteAssessment(id: string) {
    try {
      await deleteDoc(doc(db, 'assessments', id));
      setAssessments((prev) => prev.filter((a) => a.id !== id));
      showToast('Assessment deleted', 'success');
    } catch {
      showToast('Failed to delete assessment', 'error');
    }
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(link);
      setTimeout(() => setCopiedToken(''), 2000);
    });
  }

  function closeCreateModal() {
    setCreateModal(false);
    setCreateForm({ candidateId: '', openingId: '' });
    setGeneratedLink('');
  }

  // Filter assessments
  const filtered = assessments.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [a.candidateName, a.candidateEmail, a.openingTitle].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Filter question bank
  const techFiltered = TECHNICAL_QUESTIONS.filter((q) => {
    const s = bankSearch.toLowerCase();
    return !s || q.text.toLowerCase().includes(s) || q.category.toLowerCase().includes(s);
  });
  const discFiltered = DISC_QUESTIONS.filter((q) => {
    const s = bankSearch.toLowerCase();
    return !s || q.text.toLowerCase().includes(s);
  });

  // Stats
  const completed = assessments.filter((a) => a.status === 'completed').length;
  const pending = assessments.filter((a) => a.status === 'pending').length;
  const avgTech = completed > 0
    ? Math.round(assessments.filter((a) => a.technicalScore != null).reduce((s, a) => s + (a.technicalScore ?? 0), 0) / completed)
    : 0;

  const techCategories = [...new Set(TECHNICAL_QUESTIONS.map((q) => q.category))];

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Assessments</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              50 technical + 25 DISC questions · 24-hour expiry · unique link per candidate
            </p>
          </div>
          {tab === 'results' && (
            <button
              onClick={() => setCreateModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
              style={{ background: 'var(--green)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              Send assessment
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Sent', value: assessments.length, icon: <Send className="h-4 w-4" />, color: 'text-[var(--light)]' },
            { label: 'Pending', value: pending, icon: <Clock className="h-4 w-4" />, color: 'text-amber-500' },
            { label: 'Completed', value: completed, icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-600' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className={`flex items-center gap-2 text-xs ${color}`}>{icon}{label}</div>
              <div className="mt-1 text-2xl font-800 text-[var(--black)]">{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 w-fit">
          {[
            { key: 'results', label: 'Sent assessments' },
            { key: 'bank', label: 'Question bank' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key as 'results' | 'bank')}
              className={`rounded-lg px-4 py-1.5 text-xs font-600 transition-colors ${
                tab === key ? 'bg-white text-[var(--black)] shadow-sm' : 'text-[var(--light)] hover:text-[var(--mid)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'results' ? (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search candidate, opening..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_36px] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div>Candidate</div>
                  <div>Opening</div>
                  <div>Technical</div>
                  <div>DISC</div>
                  <div>Status / Link</div>
                  <div></div>
                </div>
                {filtered.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">No assessments sent yet.</div>
                ) : (
                  filtered.map((a) => {
                    const link = a.uniqueToken ? `https://talent.nearwork.co/assessment?token=${a.uniqueToken}` : null;
                    return (
                      <div
                        key={a.id}
                        className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_36px] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-600 text-[var(--black)]">
                            {a.candidateName || a.candidateId || '—'}
                          </p>
                          <p className="truncate text-[10px] text-[var(--light)]">{a.candidateEmail ?? ''}</p>
                        </div>
                        <div className="text-xs text-[var(--mid)] truncate">{a.openingTitle ?? '—'}</div>
                        <div>
                          {a.technicalScore != null ? (
                            <span className={`text-xs font-700 ${a.technicalScore >= 70 ? 'text-green-600' : a.technicalScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                              {a.technicalScore}/50
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--light)]">—</span>
                          )}
                        </div>
                        <div>
                          {a.discStyle ? (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-700 text-purple-700">
                              {a.discStyle} — {DISC_LABELS[a.discStyle].name}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--light)]">—</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <AssessmentStatusBadge status={a.status ?? 'pending'} />
                          {link && a.status === 'pending' && (
                            <button
                              onClick={() => copyLink(link)}
                              className="flex items-center gap-0.5 rounded-md border border-[var(--border)] px-1.5 py-1 text-[9px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                              title="Copy link"
                            >
                              {copiedToken === link ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                            </button>
                          )}
                        </div>
                        <div>
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this assessment?')) deleteAssessment(a.id);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--light)] hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : (
          /* Question bank view */
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  placeholder="Search questions..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1">
                {(['technical', 'disc'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setBankCategory(t)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-600 transition-colors ${bankCategory === t ? 'bg-white text-[var(--black)] shadow-sm' : 'text-[var(--light)] hover:text-[var(--mid)]'}`}
                  >
                    {t === 'technical' ? `Technical (${TECHNICAL_QUESTIONS.length})` : `DISC (${DISC_QUESTIONS.length})`}
                  </button>
                ))}
              </div>
            </div>

            {bankCategory === 'technical' ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--light)]">
                  {techFiltered.length} questions across {techCategories.length} categories
                </p>
                {techFiltered.map((q) => (
                  <div key={q.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-700 text-[var(--green)]">{q.id}</span>
                          <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-600 text-[var(--mid)]">{q.category}</span>
                        </div>
                        <p className="text-xs font-600 text-[var(--black)]">{q.text}</p>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {q.options.map((opt, j) => (
                            <div
                              key={j}
                              className={`rounded-lg px-2.5 py-1.5 text-[10px] ${j === q.correctIndex ? 'bg-green-100 font-700 text-green-700' : 'bg-[var(--bg)] text-[var(--mid)]'}`}
                            >
                              {String.fromCharCode(65 + j)}. {opt}
                            </div>
                          ))}
                        </div>
                        {q.explanation && (
                          <p className="mt-2 text-[10px] text-[var(--light)] italic">{q.explanation}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[var(--light)]">
                  {discFiltered.length} DISC behavioral questions. Each option maps to D / I / S / C style.
                </p>
                {/* DISC legend */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(['D', 'I', 'S', 'C'] as const).map((style) => (
                    <div key={style} className="rounded-xl border border-[var(--border)] bg-white p-3">
                      <p className="text-sm font-800 text-[var(--black)]">{style}</p>
                      <p className="text-[11px] font-600 text-[var(--mid)]">{DISC_LABELS[style].name}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--light)]">{DISC_LABELS[style].description}</p>
                    </div>
                  ))}
                </div>
                {discFiltered.map((q) => (
                  <div key={q.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 text-xs font-600 text-[var(--black)]">{q.text}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {q.options.map((opt, j) => (
                        <div key={j} className="flex items-start gap-2 rounded-lg bg-[var(--bg)] px-2.5 py-1.5">
                          <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-800 ${
                            opt.style === 'D' ? 'bg-red-100 text-red-700' :
                            opt.style === 'I' ? 'bg-yellow-100 text-yellow-700' :
                            opt.style === 'S' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>{opt.style}</span>
                          <span className="text-[10px] text-[var(--mid)]">{opt.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create assessment modal */}
      <Modal
        open={createModal}
        onClose={closeCreateModal}
        title="Send assessment"
        size="md"
      >
        {!generatedLink ? (
          <>
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--mid)]">
                Creates a unique assessment link valid for <strong>24 hours</strong>. Includes all 50 technical + 25 DISC questions. Share the link with the candidate at talent.nearwork.co.
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Candidate *</label>
                <select
                  value={createForm.candidateId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, candidateId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
                >
                  <option value="">Select candidate…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Opening <span className="normal-case font-400">(optional)</span>
                </label>
                <select
                  value={createForm.openingId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, openingId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
                >
                  <option value="">No opening</option>
                  {openings.map((o) => (
                    <option key={o.id} value={o.id}>{o.title} — {o.orgName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeCreateModal} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
                Cancel
              </button>
              <button
                onClick={createAssessment}
                disabled={creating || !createForm.candidateId}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {creating && <Spinner size="sm" />}
                Create & get link
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-600 text-emerald-700">Assessment created — link expires in 24 hours</p>
              <p className="mt-0.5 text-[10px] text-emerald-600">Share this URL with the candidate.</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="flex-1 truncate text-[10px] text-[var(--mid)]">{generatedLink}</p>
              <button
                onClick={() => copyLink(generatedLink)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                {copiedToken === generatedLink ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedToken === generatedLink ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={closeCreateModal} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function AssessmentStatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-600 text-green-600">
        <CheckCircle className="h-3 w-3" />Completed
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-600 text-blue-600">
        <ClipboardList className="h-3 w-3" />In progress
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-600 text-red-500">
        <AlertCircle className="h-3 w-3" />Expired
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-600 text-amber-600">
      <Clock className="h-3 w-3" />Pending
    </span>
  );
}
