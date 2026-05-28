'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  query,
  where,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtRelative, sortByTimestamp } from '@/lib/utils';
import type { CandidateAssessment } from '@/lib/types';
import { Search, ClipboardList, CheckCircle, Clock, XCircle } from 'lucide-react';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const { showToast } = useToast();

  const [assessments, setAssessments] = useState<CandidateAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tab, setTab] = useState<'results' | 'bank'>('results');

  // Question bank
  const [questionBank, setQuestionBank] = useState<Array<{
    id: string;
    text: string;
    category: string;
    difficulty?: string;
    options: string[];
    correctIndex: number;
  }>>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [bankCategory, setBankCategory] = useState('');

  // New question modal
  const [newQModal, setNewQModal] = useState(false);
  const [qForm, setQForm] = useState({
    text: '',
    category: '',
    difficulty: 'medium',
    option0: '', option1: '', option2: '', option3: '',
    correctIndex: '0',
    explanation: '',
  });
  const [savingQ, setSavingQ] = useState(false);

  useEffect(() => {
    loadResults();
  }, []);

  useEffect(() => {
    if (tab === 'bank') loadBank();
  }, [tab]);

  async function loadResults() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'assessments'));
      setAssessments(sortByTimestamp(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CandidateAssessment)), 'completedAt'));
    } catch {
      showToast('Failed to load assessments', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadBank() {
    setBankLoading(true);
    try {
      const snap = await getDocs(collection(db, 'assessmentQuestionBank'));
      setQuestionBank(snap.docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; text: string; category: string; difficulty?: string; options: string[]; correctIndex: number })));
    } catch {
      showToast('Failed to load question bank', 'error');
    } finally {
      setBankLoading(false);
    }
  }

  const filteredResults = assessments.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [a.candidateId, a.assessmentId, a.pipelineCode].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter
      || (statusFilter === 'passed' && a.passed === true)
      || (statusFilter === 'failed' && a.passed === false)
      || (statusFilter === 'pending' && a.passed == null);
    return matchSearch && matchStatus;
  });

  const bankCategories = [...new Set(questionBank.map((q) => q.category).filter(Boolean))];

  const filteredBank = questionBank.filter((q) => {
    const s = bankSearch.toLowerCase();
    const matchSearch = !s || q.text.toLowerCase().includes(s);
    const matchCat = !bankCategory || q.category === bankCategory;
    return matchSearch && matchCat;
  });

  async function saveQuestion() {
    if (!qForm.text || !qForm.category) {
      showToast('Question text and category are required', 'error');
      return;
    }
    setSavingQ(true);
    try {
      await addDoc(collection(db, 'assessmentQuestionBank'), {
        text: qForm.text,
        category: qForm.category,
        difficulty: qForm.difficulty,
        options: [qForm.option0, qForm.option1, qForm.option2, qForm.option3].filter(Boolean),
        correctIndex: Number(qForm.correctIndex),
        explanation: qForm.explanation,
        createdAt: serverTimestamp(),
      });
      showToast('Question added', 'success');
      setNewQModal(false);
      loadBank();
    } catch {
      showToast('Failed to save question', 'error');
    } finally {
      setSavingQ(false);
    }
  }

  // Stats
  const totalCompleted = assessments.filter((a) => a.completedAt).length;
  const passRate = totalCompleted > 0
    ? Math.round(assessments.filter((a) => a.passed).length / totalCompleted * 100)
    : 0;
  const avgScore = assessments.length > 0
    ? Math.round(assessments.reduce((s, a) => s + (a.score ?? 0), 0) / assessments.length)
    : 0;

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Assessments</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">Assessment results and question bank.</p>
          </div>
          {tab === 'bank' && (
            <button
              onClick={() => setNewQModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
              style={{ background: 'var(--green)' }}
            >
              + Add question
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total completed', value: totalCompleted, icon: <ClipboardList className="h-4 w-4" /> },
            { label: 'Pass rate', value: `${passRate}%`, icon: <CheckCircle className="h-4 w-4" /> },
            { label: 'Avg score', value: avgScore, icon: <Clock className="h-4 w-4" /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--light)]">{icon}{label}</div>
              <div className="mt-1 text-2xl font-800 text-[var(--black)]">{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 w-fit">
          {[{ key: 'results', label: 'Results' }, { key: 'bank', label: 'Question bank' }].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key as 'results' | 'bank')}
              className={`rounded-lg px-4 py-1.5 text-xs font-600 transition-colors ${tab === key ? 'bg-white text-[var(--black)] shadow-sm' : 'text-[var(--light)] hover:text-[var(--mid)]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'results' ? (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search candidate, role, code..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All results</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div>Candidate</div>
                  <div>Pipeline</div>
                  <div>Score</div>
                  <div>Result</div>
                  <div>Completed</div>
                </div>
                {filteredResults.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">No assessment results found.</div>
                ) : (
                  filteredResults.map((a) => (
                    <div key={a.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)]">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-600 text-[var(--black)]">{a.candidateId}</p>
                      </div>
                      <div className="text-xs text-[var(--mid)]">{a.pipelineCode ?? '—'}</div>
                      <div>
                        {a.score != null ? (
                          <span className={`text-xs font-700 ${(a.score) >= 70 ? 'text-green-600' : (a.score) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                            {a.score}%
                          </span>
                        ) : <span className="text-xs text-[var(--light)]">—</span>}
                      </div>
                      <div>
                        {a.passed == null ? (
                          <span className="flex items-center gap-1 text-[10px] text-[var(--light)]"><Clock className="h-3 w-3" />Pending</span>
                        ) : a.passed ? (
                          <span className="flex items-center gap-1 text-[10px] text-green-600 font-600"><CheckCircle className="h-3 w-3" />Passed</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-red-500 font-600"><XCircle className="h-3 w-3" />Failed</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--light)]">
                        {a.completedAt ? fmtRelative(a.completedAt) : '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
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
              <select
                value={bankCategory}
                onChange={(e) => setBankCategory(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All categories</option>
                {bankCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {bankLoading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : (
              <div className="space-y-3">
                {filteredBank.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-white py-16 text-center text-sm text-[var(--light)]">
                    No questions found.
                  </div>
                ) : (
                  filteredBank.map((q, i) => (
                    <div key={q.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-xs font-600 text-[var(--black)]">{q.text}</p>
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            {(q.options ?? []).map((opt, j) => (
                              <div
                                key={j}
                                className={`rounded-lg px-2.5 py-1.5 text-[10px] ${j === q.correctIndex ? 'bg-green-100 font-700 text-green-700' : 'bg-[var(--bg)] text-[var(--mid)]'}`}
                              >
                                {String.fromCharCode(65 + j)}. {opt}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-600 text-[var(--mid)]">
                            {q.category}
                          </span>
                          {q.difficulty && (
                            <span className={`text-[10px] font-600 ${q.difficulty === 'hard' ? 'text-red-500' : q.difficulty === 'medium' ? 'text-amber-500' : 'text-green-600'}`}>
                              {q.difficulty}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* New question modal */}
      <Modal open={newQModal} onClose={() => setNewQModal(false)} title="Add question to bank" size="lg">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Question *</label>
            <textarea
              value={qForm.text}
              onChange={(e) => setQForm((f) => ({ ...f, text: e.target.value }))}
              placeholder="Enter the question..."
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Category *</label>
              <input
                value={qForm.category}
                onChange={(e) => setQForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="English / CRM / Technical"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Difficulty</label>
              <select
                value={qForm.difficulty}
                onChange={(e) => setQForm((f) => ({ ...f, difficulty: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]"
              >
                <option>easy</option>
                <option>medium</option>
                <option>hard</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[0,1,2,3].map((i) => (
              <div key={i}>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Option {String.fromCharCode(65+i)} {Number(qForm.correctIndex) === i ? '(Correct)' : ''}
                </label>
                <input
                  value={(qForm as Record<string,string>)[`option${i}`]}
                  onChange={(e) => setQForm((f) => ({ ...f, [`option${i}`]: e.target.value }))}
                  placeholder={`Option ${String.fromCharCode(65+i)}`}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Correct answer</label>
            <select
              value={qForm.correctIndex}
              onChange={(e) => setQForm((f) => ({ ...f, correctIndex: e.target.value }))}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]"
            >
              {[0,1,2,3].map((i) => <option key={i} value={i}>Option {String.fromCharCode(65+i)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setNewQModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          <button
            onClick={saveQuestion}
            disabled={savingQ}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {savingQ && <Spinner size="sm" />}
            Add question
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}
