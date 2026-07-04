'use client';

// Per-role assessments on the candidate profile. One row per pipeline the
// candidate is in, showing the role, pipeline code, Nearwork Score and upload
// date. Staff upload two PDFs per role (Assessment & English, DISC) which POST
// to /api/assessment-upload for parsing. "View report" opens a modal with the
// full parsed report — the same information the client sees.

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, db, collection, query, where, getDocs } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';

// ─── Types ──────────────────────────────────────────────────────────────────

type UploadKind = 'assessment' | 'disc';

interface DiscBand {
  D?: number;
  I?: number;
  S?: number;
  C?: number;
}

interface Question {
  n?: number;
  prompt?: string;
  score?: number;
  answer?: string;
  feedback?: string;
  followUp?: { q?: string; a?: string };
}

interface Assessment {
  candidateId?: string;
  pipelineCode?: string;
  pipelineTitle?: string;
  orgId?: string;
  role?: string;
  result?: 'PASSED' | 'FAILED';
  overallScore?: number;
  passingScore?: number;
  summary?: string;
  integrity?: {
    risk?: number;
    tabSwitches?: number;
    copyPaste?: number;
    focusLosses?: number;
  };
  english?: {
    level?: string;
    score?: number;
    summary?: string;
    recommendations?: string;
  };
  questions?: Question[];
  disc?: {
    type?: string;
    classification?: string;
    headline?: string;
    narrative?: string;
    profiles?: {
      natural?: DiscBand;
      adapted?: DiscBand;
      pressure?: DiscBand;
    };
  };
  nearworkScore?: number;
  status?: 'completed' | 'partial';
  gradedBy?: string;
  assessmentUploadedAt?: unknown;
  discUploadedAt?: unknown;
  updatedAt?: unknown;
}

interface PipelineEntry {
  pipeline: {
    code: string;
    title?: string;
    openingTitle?: string;
    orgId?: string;
    orgName?: string;
    status?: string;
  };
  entry: { stage?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Firestore Timestamps expose `.toDate()`; guard for undefined/other shapes. */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (isRecord(value) && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Format like "Jul 4, 2026". */
function formatDate(value: unknown): string | null {
  const d = toDate(value);
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Narrow a raw Firestore doc into our Assessment shape. */
function coerceAssessment(raw: Record<string, unknown>): Assessment {
  const integrity = isRecord(raw.integrity) ? raw.integrity : {};
  const english = isRecord(raw.english) ? raw.english : {};
  const disc = isRecord(raw.disc) ? raw.disc : {};
  const discProfiles = isRecord(disc.profiles) ? disc.profiles : {};

  const band = (v: unknown): DiscBand => {
    const b = isRecord(v) ? v : {};
    return { D: num(b.D), I: num(b.I), S: num(b.S), C: num(b.C) };
  };

  const questions: Question[] = Array.isArray(raw.questions)
    ? raw.questions.filter(isRecord).map((q) => {
        const fu = isRecord(q.followUp) ? q.followUp : undefined;
        return {
          n: num(q.n),
          prompt: str(q.prompt),
          score: num(q.score),
          answer: str(q.answer),
          feedback: str(q.feedback),
          followUp: fu ? { q: str(fu.q), a: str(fu.a) } : undefined,
        };
      })
    : [];

  const result = raw.result === 'PASSED' || raw.result === 'FAILED' ? raw.result : undefined;
  const status = raw.status === 'completed' || raw.status === 'partial' ? raw.status : undefined;

  return {
    candidateId: str(raw.candidateId),
    pipelineCode: str(raw.pipelineCode),
    pipelineTitle: str(raw.pipelineTitle),
    orgId: str(raw.orgId),
    role: str(raw.role),
    result,
    overallScore: num(raw.overallScore),
    passingScore: num(raw.passingScore),
    summary: str(raw.summary),
    integrity: {
      risk: num(integrity.risk),
      tabSwitches: num(integrity.tabSwitches),
      copyPaste: num(integrity.copyPaste),
      focusLosses: num(integrity.focusLosses),
    },
    english: {
      level: str(english.level),
      score: num(english.score),
      summary: str(english.summary),
      recommendations: str(english.recommendations),
    },
    questions,
    disc: {
      type: str(disc.type),
      classification: str(disc.classification),
      headline: str(disc.headline),
      narrative: str(disc.narrative),
      profiles: {
        natural: band(discProfiles.natural),
        adapted: band(discProfiles.adapted),
        pressure: band(discProfiles.pressure),
      },
    },
    nearworkScore: num(raw.nearworkScore),
    status,
    gradedBy: str(raw.gradedBy),
    assessmentUploadedAt: raw.assessmentUploadedAt,
    discUploadedAt: raw.discUploadedAt,
    updatedAt: raw.updatedAt,
  };
}

function isAssessed(a: Assessment | undefined): a is Assessment {
  return !!a && typeof a.nearworkScore === 'number';
}

// ─── Upload button ─────────────────────────────────────────────────────────────

function UploadButton({
  label,
  kind,
  busy,
  onFile,
}: {
  label: string;
  kind: UploadKind;
  busy: boolean;
  onFile: (kind: UploadKind, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(kind, f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
      >
        {busy ? 'Reading…' : label}
      </button>
    </>
  );
}

// ─── Report modal ──────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`}>{children}</div>
  );
}

function DiscBars({ band }: { band: DiscBand }) {
  const rows: Array<{ key: keyof DiscBand; color: string }> = [
    { key: 'D', color: 'bg-rose-500' },
    { key: 'I', color: 'bg-amber-500' },
    { key: 'S', color: 'bg-emerald-500' },
    { key: 'C', color: 'bg-sky-500' },
  ];
  return (
    <div className="space-y-2">
      {rows.map(({ key, color }) => {
        const v = band[key];
        const pct = typeof v === 'number' ? Math.max(0, Math.min(100, v)) : 0;
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-4 text-xs font-semibold text-gray-700">{key}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-9 text-right text-xs tabular-nums text-gray-600">
              {typeof v === 'number' ? `${Math.round(v)}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ReportModal({ a, onClose }: { a: Assessment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const passed = a.result === 'PASSED';
  const natural = a.disc?.profiles?.natural ?? {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[820px] rounded-2xl border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900">
              {a.role ?? a.pipelineTitle ?? 'Assessment'}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  a.result
                    ? passed
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {a.result ?? 'Pending'}
              </span>
              {(typeof a.overallScore === 'number' || typeof a.passingScore === 'number') && (
                <span className="text-xs text-gray-500">
                  Overall {typeof a.overallScore === 'number' ? `${a.overallScore}%` : '—'} · pass
                  line {typeof a.passingScore === 'number' ? `${a.passingScore}%` : '—'}
                </span>
              )}
            </div>
            {a.gradedBy && (
              <div className="mt-1 text-xs text-gray-400">Graded by {a.gradedBy}</div>
            )}
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <Label>Nearwork Score</Label>
              <div className="text-3xl font-bold leading-none tabular-nums text-gray-900">
                {typeof a.nearworkScore === 'number' ? a.nearworkScore : '—'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          {/* English + Integrity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Label>English</Label>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {a.english?.level ?? '—'}
                </span>
                {typeof a.english?.score === 'number' && (
                  <span className="text-sm tabular-nums text-gray-500">{a.english.score}%</span>
                )}
              </div>
              {a.english?.summary && (
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{a.english.summary}</p>
              )}
            </Card>

            <Card>
              <Label>Integrity</Label>
              <div className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">
                {typeof a.integrity?.risk === 'number' ? `${a.integrity.risk}%` : '—'}
                <span className="ml-1 text-xs font-medium text-gray-400">risk</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ['Tab switches', a.integrity?.tabSwitches],
                    ['Copy-paste', a.integrity?.copyPaste],
                    ['Focus losses', a.integrity?.focusLosses],
                  ] as const
                ).map(([lbl, val]) => (
                  <div key={lbl}>
                    <div className="text-sm font-semibold tabular-nums text-gray-900">
                      {typeof val === 'number' ? val : '—'}
                    </div>
                    <div className="text-[10px] leading-tight text-gray-500">{lbl}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* DISC */}
          {(a.disc?.type || a.disc?.headline || natural) && (
            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label>DISC profile</Label>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900">{a.disc?.type ?? '—'}</span>
                    {a.disc?.classification && (
                      <span className="text-sm text-gray-500">{a.disc.classification}</span>
                    )}
                  </div>
                  {a.disc?.headline && (
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">
                      {a.disc.headline}
                    </p>
                  )}
                </div>
                <div className="w-44 shrink-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Natural
                  </div>
                  <DiscBars band={natural} />
                </div>
              </div>
            </Card>
          )}

          {/* Questions */}
          {a.questions && a.questions.length > 0 && (
            <div className="space-y-3">
              <Label>Questions</Label>
              {a.questions.map((q, i) => (
                <Card key={q.n ?? i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-gray-900">
                      {q.prompt ?? `Question ${q.n ?? i + 1}`}
                    </div>
                    {typeof q.score === 'number' && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700">
                        {q.score}/5
                      </span>
                    )}
                  </div>
                  {q.answer && (
                    <div className="mt-3">
                      <Label>Answer</Label>
                      <p className="mt-1 text-sm leading-relaxed text-gray-700">{q.answer}</p>
                    </div>
                  )}
                  {q.feedback && (
                    <div className="mt-3">
                      <Label>Feedback</Label>
                      <p className="mt-1 text-sm leading-relaxed text-gray-600">{q.feedback}</p>
                    </div>
                  )}
                  {q.followUp && (q.followUp.q || q.followUp.a) && (
                    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <Label>Follow-up</Label>
                      {q.followUp.q && (
                        <p className="mt-1 text-sm font-medium text-gray-800">{q.followUp.q}</p>
                      )}
                      {q.followUp.a && (
                        <p className="mt-1 text-sm leading-relaxed text-gray-600">{q.followUp.a}</p>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Overall summary */}
          {a.summary && (
            <Card>
              <Label>Overall summary</Label>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">{a.summary}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────────

function AssessmentRow({
  pipeline,
  entry,
  assessment,
  busyKind,
  onFile,
  onView,
}: {
  pipeline: PipelineEntry['pipeline'];
  entry: PipelineEntry['entry'];
  assessment?: Assessment;
  busyKind: UploadKind | null;
  onFile: (code: string, orgId: string | undefined, kind: UploadKind, file: File) => void;
  onView: (a: Assessment) => void;
}) {
  const roleTitle = pipeline.title ?? pipeline.openingTitle ?? assessment?.role ?? pipeline.code;
  const assessed = isAssessed(assessment);
  const uploadedAt =
    formatDate(assessment?.assessmentUploadedAt) ??
    formatDate(assessment?.discUploadedAt) ??
    formatDate(assessment?.updatedAt);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-gray-900">{roleTitle}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span className="font-mono">{pipeline.code}</span>
          {pipeline.orgName && <span>· {pipeline.orgName}</span>}
          {entry.stage && <span>· {entry.stage}</span>}
        </div>
      </div>

      <div className="flex items-center gap-4 sm:justify-end">
        <div className="text-right">
          <Label>Nearwork Score</Label>
          {assessed ? (
            <div className="text-xl font-bold leading-none tabular-nums text-gray-900">
              {assessment?.nearworkScore}
            </div>
          ) : (
            <div className="text-sm font-medium text-gray-400">Not assessed</div>
          )}
          {uploadedAt && <div className="mt-0.5 text-[10px] text-gray-400">{uploadedAt}</div>}
        </div>

        <div className="flex items-center gap-2">
          <UploadButton
            label="Assessment & English"
            kind="assessment"
            busy={busyKind === 'assessment'}
            onFile={(kind, file) => onFile(pipeline.code, pipeline.orgId, kind, file)}
          />
          <UploadButton
            label="DISC"
            kind="disc"
            busy={busyKind === 'disc'}
            onFile={(kind, file) => onFile(pipeline.code, pipeline.orgId, kind, file)}
          />
          {assessed && assessment && (
            <button
              type="button"
              onClick={() => onView(assessment)}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              View report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────────

export function AssessmentsSection({
  candidateId,
  pipelines,
  onEnglishUpdated,
}: {
  candidateId: string;
  pipelines: Array<{
    pipeline: {
      code: string;
      title?: string;
      openingTitle?: string;
      orgId?: string;
      orgName?: string;
      status?: string;
    };
    entry: { stage?: string };
  }>;
  onEnglishUpdated?: () => void;
}) {
  const { showToast } = useToast();
  const [byCode, setByCode] = useState<Record<string, Assessment>>({});
  const [busy, setBusy] = useState<Record<string, UploadKind | null>>({});
  const [viewing, setViewing] = useState<Assessment | null>(null);

  const loadAssessments = useCallback(async () => {
    if (!candidateId) return;
    try {
      const q = query(collection(db, 'assessments'), where('candidateId', '==', candidateId));
      const snap = await getDocs(q);
      const next: Record<string, Assessment> = {};
      snap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const a = coerceAssessment(raw);
        if (a.pipelineCode) next[a.pipelineCode] = a;
      });
      setByCode(next);
    } catch {
      // Non-fatal — rows simply render as "Not assessed".
    }
  }, [candidateId]);

  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments]);

  const handleFile = useCallback(
    async (code: string, orgId: string | undefined, kind: UploadKind, file: File) => {
      setBusy((b) => ({ ...b, [code]: kind }));
      try {
        const token = await auth.currentUser?.getIdToken();
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', kind);
        fd.append('candidateId', candidateId);
        fd.append('pipelineCode', code);
        if (orgId) fd.append('orgId', orgId);
        const res = await fetch('/api/assessment-upload', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };
        if (res.ok && data.success) {
          showToast(kind === 'assessment' ? 'Assessment & English parsed' : 'DISC parsed', 'success');
          await loadAssessments();
          onEnglishUpdated?.();
        } else {
          showToast(data.error || 'Could not read that PDF', 'error');
        }
      } catch {
        showToast('Upload failed — please try again', 'error');
      } finally {
        setBusy((b) => ({ ...b, [code]: null }));
      }
    },
    [candidateId, loadAssessments, onEnglishUpdated, showToast]
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-900">Assessments</div>
        <div className="mt-0.5 text-xs text-gray-500">
          Upload the report PDFs per role. Scores update the candidate automatically.
        </div>
      </div>

      {pipelines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
          This candidate isn&apos;t in any pipelines yet.
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map(({ pipeline, entry }) => (
            <AssessmentRow
              key={pipeline.code}
              pipeline={pipeline}
              entry={entry}
              assessment={byCode[pipeline.code]}
              busyKind={busy[pipeline.code] ?? null}
              onFile={handleFile}
              onView={setViewing}
            />
          ))}
        </div>
      )}

      {viewing && <ReportModal a={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
