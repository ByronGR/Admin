'use client';

// Per-role assessments on the candidate profile. One row per pipeline the
// candidate is in, showing the role, pipeline code, Nearwork Score and upload
// date. Staff upload two PDFs per role (Assessment & English, DISC) which POST
// to /api/assessment-upload for parsing. "View report" links to the full-page
// report at /candidates/{id}/assessment/{pipeline} — the same view the client sees.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

// ─── Row label ──────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </div>
  );
}


// ─── Row ────────────────────────────────────────────────────────────────────────

function AssessmentRow({
  candidateId,
  pipeline,
  entry,
  assessment,
  busyKind,
  onFile,
}: {
  candidateId: string;
  pipeline: PipelineEntry['pipeline'];
  entry: PipelineEntry['entry'];
  assessment?: Assessment;
  busyKind: UploadKind | null;
  onFile: (code: string, orgId: string | undefined, kind: UploadKind, file: File) => void;
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
            <Link
              href={`/candidates/${candidateId}/assessment/${pipeline.code}`}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              View report
            </Link>
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
              candidateId={candidateId}
              pipeline={pipeline}
              entry={entry}
              assessment={byCode[pipeline.code]}
              busyKind={busy[pipeline.code] ?? null}
              onFile={handleFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
