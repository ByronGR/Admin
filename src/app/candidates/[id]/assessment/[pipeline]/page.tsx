'use client';

// ── Candidate assessment report — full page ───────────────────────────────────
// Renders a candidate's parsed assessment report EXACTLY like the client portal
// (design ported from App/src/portal). Data is read from Firestore:
//   assessments/{id}__{pipeline}  → the parsed report doc
//   candidates/{id}               → header fields (name, role, location, code, skills)
// The mapping mirrors App/src/portal/map-candidate.ts. Grading is attributed to
// the doc's `gradedBy` ("Nearwork talent team") — never AI.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { db, doc, getDoc } from '@/lib/firebase';
import {
  NW,
  Icon,
  CandidateReportBody,
  AssessmentPending,
  type CandidateData,
  type CandidateHeader,
  type CandidateDiscDim,
} from './report-ui';

// ── DISC / stage constants (mirror map-candidate.ts) ──────────────────────────
const DISC_COLORS: Record<string, string> = { D: '#E74C7C', I: '#EAB308', S: '#16A085', C: '#3B82F6' };
const DISC_DIMS: Record<string, CandidateDiscDim> = {
  D: { key: 'D', name: 'Dominance', color: '#E74C7C' },
  I: { key: 'I', name: 'Influence', color: '#EAB308' },
  S: { key: 'S', name: 'Steadiness', color: '#16A085' },
  C: { key: 'C', name: 'Conscientiousness', color: '#3B82F6' },
};
const DISC_LABEL: Record<string, string> = { D: 'Dominance', I: 'Influence', S: 'Steadiness', C: 'Conscientiousness' };
const STAGE_ORDER = ['Applied', 'Screening', 'Technical', 'Final round', 'Offer', 'Not selected'];

// ── Narrowing helpers ─────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const numOr = (v: unknown, d = 0): number => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const strOr = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function initialsOf(name?: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_BGS = ['#16A085', '#E74C7C', '#AF7AC5', '#12866E', '#EAB308', '#3B82F6', '#F97316', '#8B5CF6'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_BGS[Math.abs(h) % AVATAR_BGS.length];
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

// ── Build CandidateData from the two Firestore docs ───────────────────────────
function buildCandidateData(
  candidateId: string,
  pipelineCode: string,
  candRaw: Rec,
  assessRaw: Rec | null,
): CandidateData {
  const A = asRec(assessRaw);

  const name = strOr(candRaw.name, 'Candidate');
  const role = strOr(candRaw.role) || strOr(A.role) || strOr(A.pipelineTitle);
  const skills = Array.isArray(candRaw.skills) ? (candRaw.skills as unknown[]).filter((s): s is string => typeof s === 'string') : [];

  const score = typeof A.nearworkScore === 'number'
    ? A.nearworkScore
    : (typeof A.overallScore === 'number' ? A.overallScore : numOr(candRaw.score, 0));

  const header: CandidateHeader = {
    id: candidateId,
    name,
    initials: initialsOf(name),
    avatarBg: avatarColor(strOr(candRaw.code) || candidateId || name),
    role,
    location: strOr(candRaw.location),
    stage: 'Screening',
    stageIdx: 2,
    score,
    openingId: pipelineCode,
    match: skills,
    submittedDays: 0,
  };

  const salaryExp = strOr(candRaw.expectedSalary)
    || (typeof candRaw.expectedSalaryAmount === 'number' ? `$${(candRaw.expectedSalaryAmount as number).toLocaleString()}` : '');

  const base: CandidateData = {
    candidate: header,
    openingId: pipelineCode,
    discColors: DISC_COLORS,
    discDims: DISC_DIMS,
    stageOrder: STAGE_ORDER,
    snapshot: salaryExp ? { salaryExp } : undefined,
    completed: false,
  };

  // ── Rich report ────────────────────────────────────────────────────────────
  const rawQuestions = Array.isArray(A.questions) ? (A.questions as Rec[]) : [];
  const hasAssessment = rawQuestions.length > 0 || typeof A.overallScore === 'number';
  if (!hasAssessment) return base;

  const questions = rawQuestions.map((q) => ({
    n: numOr(q.n),
    prompt: strOr(q.prompt),
    competency: strOr(q.competency) || `Question ${numOr(q.n)}`,
    score: numOr(q.score),
    max: 5,
    answer: strOr(q.answer),
    feedback: strOr(q.feedback),
    followUp: q.followUp && typeof q.followUp === 'object'
      ? { q: strOr((q.followUp as Rec).q), a: strOr((q.followUp as Rec).a) }
      : undefined,
  }));

  const integ = asRec(A.integrity);
  base.completed = A.status === 'completed' || typeof A.overallScore === 'number';
  base.submittedMeta = { submitted: strOr(A.submitted), gradedBy: strOr(A.gradedBy, 'Nearwork talent team') };
  base.assessment = {
    overall: numOr(A.overallScore),
    passing: numOr(A.passingScore, 70),
    status: A.result === 'PASSED' ? 'passed' : 'failed',
    integrity: {
      risk: numOr(integ.risk),
      tabSwitches: numOr(integ.tabSwitches),
      copyPaste: numOr(integ.copyPaste),
      focusLosses: numOr(integ.focusLosses),
    },
    summary: strOr(A.summary),
    questions,
  };

  const eng = asRec(A.english);
  if (eng.level || typeof eng.score === 'number') {
    base.english = {
      level: strOr(eng.level, 'B2') as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
      score: numOr(eng.score),
      summary: strOr(eng.summary),
    };
  }

  const disc = asRec(A.disc);
  if (disc.type || disc.profiles) {
    const prof = asRec(disc.profiles);
    const dp = (v: unknown) => {
      const r = asRec(v);
      return { D: numOr(r.D), I: numOr(r.I), S: numOr(r.S), C: numOr(r.C) };
    };
    const t = strOr(disc.type, 'D');
    base.disc = {
      type: (t as 'D' | 'I' | 'S' | 'C'),
      label: DISC_LABEL[t] || t,
      classification: strOr(disc.classification),
      headline: strOr(disc.headline),
      narrative: strOr(disc.narrative),
      profiles: { natural: dp(prof.natural), adapted: dp(prof.adapted), pressure: dp(prof.pressure) },
    };
  }

  if (questions.length) {
    // Six universal competency axes — the same on every role. English + Assessment
    // come straight from their scores; the four soft skills are derived from the
    // question scores (default fixed-order mapping).
    const engScore = base.english?.score ?? 0;
    const assessScore = base.assessment?.overall ?? 0;
    const qpct = questions.map((q) => Math.round((q.score / 5) * 100));
    const avgQ = qpct.length ? Math.round(qpct.reduce((a, b) => a + b, 0) / qpct.length) : assessScore;
    const at = (i: number) => (qpct[i] != null ? qpct[i] : avgQ);
    const communication = qpct.length > 4 ? Math.round((at(0) + at(4)) / 2) : at(0);
    base.radar = {
      axes: ['Communication', 'Problem solving', 'Adaptability', 'Leadership', 'English', 'Assessment'],
      candidate: [communication, at(1), at(2), at(3), engScore, assessScore],
      average: [70, 70, 70, 70, 70, 70],
      cohortSize: 0,
    };
    const strong = questions.filter((q) => q.score >= 3.5);
    const weak = questions.filter((q) => q.score > 0 && q.score <= 2.5);
    base.highlights = {
      strengths: strong.map((q) => ({ label: q.competency, detail: q.feedback.slice(0, 160) })),
      watchOuts: weak.map((q) => ({ label: q.competency, detail: q.feedback.slice(0, 160) })),
    };
  }

  return base;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CandidateAssessmentPage() {
  const params = useParams();
  const candidateId = first(params.id as string | string[] | undefined);
  const pipelineCode = first(params.pipeline as string | string[] | undefined);

  const [data, setData] = useState<CandidateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      if (!candidateId || !pipelineCode) {
        if (!cancelled) { setData(null); setLoading(false); }
        return;
      }
      try {
        const [assessSnap, candSnap] = await Promise.all([
          getDoc(doc(db, 'assessments', `${candidateId}__${pipelineCode}`)),
          getDoc(doc(db, 'candidates', candidateId)),
        ]);
        const assessRaw = assessSnap.exists() ? (assessSnap.data() as Rec) : null;
        const candRaw = candSnap.exists() ? (candSnap.data() as Rec) : {};
        const built = buildCandidateData(candidateId, pipelineCode, candRaw, assessRaw);
        if (!cancelled) setData(built);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [candidateId, pipelineCode]);

  const backHref = candidateId ? `/candidates/${candidateId}` : '/candidates';

  return (
    <div style={{ minHeight: '100vh', background: NW.offWhite, color: NW.black, fontFamily: 'Poppins, sans-serif' }}>
      <div style={{ padding: '36px 40px 40px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <Link href={backHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, textDecoration: 'none', fontSize: 12, fontWeight: 600, color: NW.gray500, letterSpacing: '0.04em' }}>
            <Icon name="arrow-left" size={14} color={NW.gray500} /> Back to candidate
          </Link>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 20px', gap: 16 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  border: `3px solid ${NW.gray100}`,
                  borderTopColor: NW.teal500,
                  animation: 'nwSpin 800ms linear infinite',
                }}
              />
              <div style={{ fontSize: 13, color: NW.gray500 }}>Loading assessment report…</div>
              <style>{`@keyframes nwSpin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : data ? (
            <CandidateReportBody data={data} />
          ) : (
            <AssessmentPending c={{ id: candidateId, name: 'This candidate', initials: '?', avatarBg: NW.gray400, role: '', location: '', stage: 'Screening', stageIdx: 2, score: 0, openingId: pipelineCode, match: [], submittedDays: 0 }} />
          )}
        </div>
      </div>
    </div>
  );
}
