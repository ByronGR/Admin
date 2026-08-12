// ── Calling RAIA ─────────────────────────────────────────────────────────────
// RAIA is a separate service (github.com/ByronGR/RAIA) with its own repo,
// database and deploy. Admin talks to it over HTTP like any other customer
// would — there is no private door in, and no shared code.
//
// That is why the request and response shapes are declared here rather than
// imported: duplicating an API contract in its client is normal, and the
// alternative would couple two repos that are meant to be separable. If RAIA is
// ever sold, this file is the whole of Admin's dependency on it.
//
// This module is the ONLY place in Admin that knows RAIA exists.

import { stagesFor, stageLabel } from './pipeline-stages';
import type { Candidate, Opening, Pipeline, PipelineCandidate } from './types';

// ─── RAIA's API shapes (mirrored, deliberately) ──────────────────────────────

type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

interface RaiaCandidate {
  externalId: string;
  name?: string;
  headline?: string;
  location?: string;
  yearsTotal?: number;
  disc?: 'D' | 'I' | 'S' | 'C';
  skills?: string[];
  tools?: string[];
  industries?: string[];
  function?: string;
  subFunction?: string;
  seniority?: string;
  yearsInFunction?: number;
  englishLevel?: CEFR;
  workHistory?: Array<{
    company?: string;
    title?: string;
    from?: string;
    to?: string;
    isCurrent?: boolean;
    responsibilities?: string[];
    accomplishments?: string[];
  }>;
  rawCvText?: string;
}

interface RaiaOpening {
  externalId: string;
  title?: string;
  function?: string;
  subFunction?: string;
  seniority?: string;
  yearsRequired?: number | null;
  englishRequired?: CEFR;
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
  tools?: string[];
  industries?: string[];
  summary?: string;
  rawJdText?: string;
}

/**
 * What the hiring manager actually wants, beyond what the job post says.
 * A job post is written to attract people; a kickoff brief is written to filter
 * them, and `dealBreakers` in particular almost never survives into the JD.
 */
interface RaiaRoleContext {
  dealBreakers?: string[];
  mustHave?: string[];
  niceToHave?: string[];
  day30?: string[];
  day60?: string[];
  day90?: string[];
  teamSize?: string;
  teamStructure?: string;
  reportsTo?: string;
  directReports?: string;
  workStyle?: string;
  notes?: string;
}

interface RaiaPipelineContext {
  name: string;
  owner: 'nearwork' | 'client';
  ownerName?: string;
  stage: string;
  stages: string[];
  enteredStageAt?: string;
}

export interface RaiaGapEntry {
  id: string;
  requirement: string;
  dimension: 'skill' | 'tool' | 'years' | 'seniority' | 'english' | 'industry';
  gapType: 'missing' | 'weakly_evidenced' | 'below_requirement' | 'unverified';
  evidence: 'structured' | 'work_history' | 'raw_text' | 'none';
  cvEvidence: string | null;
  priority: number;
  probeQuestions: string[];
  status: 'unaddressed' | 'asked' | 'answered' | 'dodged';
}

export interface RaiaGapMap {
  openingExternalId: string;
  candidateExternalId: string;
  generatedAt: string;
  confirmed: Array<{ requirement: string; dimension: string; evidence: string; cvEvidence: string | null }>;
  entries: RaiaGapEntry[];
  briefing: string[];
  notAssessed: string[];
}

export interface RaiaSession {
  sessionId: string;
  status: string;
  persisted: boolean;
  gapMap: RaiaGapMap;
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

/**
 * Only pass a level RAIA can act on.
 * Admin stores English as free-ish text in places ("Advanced", "C1", "B2+"), and
 * RAIA only ever assesses English when the job states a real CEFR level — so
 * anything unrecognised is dropped rather than guessed at. A wrong level here
 * would produce an English gap on a role that never asked for one.
 */
function asCefr(v: string | undefined | null): CEFR | undefined {
  if (!v) return undefined;
  const up = v.trim().toUpperCase();
  return CEFR_LEVELS.has(up) ? (up as CEFR) : undefined;
}

export function toRaiaCandidate(c: Candidate, disc?: 'D' | 'I' | 'S' | 'C'): RaiaCandidate {
  const years = typeof c.yearsInFunction === 'number' ? c.yearsInFunction : Number(c.experience);

  return {
    externalId: c.id,
    name: c.name,
    headline: c.headline || c.role,
    location: c.location || [c.locationCity, c.locationCountry].filter(Boolean).join(', ') || undefined,
    yearsTotal: Number.isFinite(Number(c.experience)) ? Number(c.experience) : undefined,
    ...(disc ? { disc } : {}),
    skills: c.skills,
    tools: c.tools,
    industries: c.industries,
    function: c.function,
    subFunction: c.subFunction,
    seniority: c.seniority,
    ...(Number.isFinite(years) ? { yearsInFunction: years } : {}),
    englishLevel: asCefr(c.englishScore?.level ?? c.english),
    workHistory: c.workHistory,
    // The single most important field to send. RAIA checks raw CV text before
    // it calls a skill missing, so leaving this out turns every extraction gap
    // into a false gap on the brief.
    rawCvText: c.cvParse?.rawText,
  };
}

/**
 * The opening, preferring its extracted requirements.
 * `reqs` is what the matcher already scores against, so RAIA reads the same
 * thing — a second interpretation of the same job post would give a recruiter
 * two different answers to the same question.
 */
export function toRaiaOpening(o: Opening): RaiaOpening {
  const r = o.reqs;

  const jd = [
    o.content_about || o.description || o.publicSummary,
    o.content_responsibilities?.length && `Responsibilities:\n${o.content_responsibilities.map((x) => `• ${x}`).join('\n')}`,
    o.content_qualifications?.length && `Requirements:\n${o.content_qualifications.map((x) => `• ${x}`).join('\n')}`,
    o.requirements?.length && !o.content_qualifications?.length && `Requirements:\n${o.requirements.map((x) => `• ${x}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: o.id,
    title: o.title,
    function: r?.function,
    subFunction: r?.subFunction,
    seniority: r?.seniority ?? o.seniority,
    yearsRequired: r?.yearsRequired ?? null,
    englishRequired: asCefr(r?.englishRequired),
    mustHaveSkills: r?.mustHaveSkills,
    niceToHaveSkills: r?.niceToHaveSkills ?? o.niceToHave,
    tools: r?.tools,
    industries: r?.industries ?? (o.industry ? [o.industry] : undefined),
    summary: r?.summary ?? o.publicSummary,
    rawJdText: jd || undefined,
  };
}

/**
 * Where the candidate sits, and whose process it is.
 * A sourcing engagement runs the client's own stages after submittal, so the
 * owner is read from the pipeline type rather than assumed — a recruiter needs
 * to know whether the next step is theirs or the client's.
 */
export function toRaiaPipeline(p: Pipeline, pc: PipelineCandidate): RaiaPipelineContext {
  const sourcing = p.pipelineType === 'sourcing';
  return {
    name: p.title,
    owner: sourcing ? 'client' : 'nearwork',
    ownerName: p.orgName,
    stage: stageLabel(p.pipelineType, pc.stage),
    stages: stagesFor(p.pipelineType).map((s) => s.label),
    enteredStageAt: typeof pc.addedAt === 'string' ? pc.addedAt : undefined,
  };
}

/**
 * The kickoff brief, as RAIA reads it.
 *
 * Nearwork already asks clients these questions on every engagement, so the
 * highest-value input RAIA can get is one we have been collecting all along.
 * A customer without a kickoff process fills the same fields on a form.
 */
export function toRaiaRoleContext(b: Record<string, unknown>): RaiaRoleContext {
  const list = (v: unknown): string[] | undefined => {
    const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
    return arr.length ? arr : undefined;
  };
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;

  return {
    dealBreakers: list(b.dealBreakers),
    mustHave: list(b.mustHave),
    niceToHave: list(b.niceToHave),
    day30: list(b.day30),
    day60: list(b.day60),
    day90: list(b.day90),
    teamSize: str(b.teamSize),
    teamStructure: str(b.teamStructure),
    reportsTo: str(b.reportsTo),
    directReports: str(b.directReports),
    workStyle: str(b.workStyle),
  };
}

// ─── The call ────────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  candidate: Candidate;
  opening: Opening;
  roleContext?: RaiaRoleContext;
  pipeline?: { pipeline: Pipeline; pipelineCandidate: PipelineCandidate };
  disc?: 'D' | 'I' | 'S' | 'C';
  meetingUrl?: string;
  scheduledAt?: string;
}

export interface RaiaResult {
  session?: RaiaSession;
  error?: string;
}

/**
 * Create a RAIA session and get its gap map back.
 *
 * Never throws. A brief is an aid, not a gate — RAIA being unreachable must
 * degrade the interview page, not break it, and a recruiter with no brief is in
 * exactly the position they were in before RAIA existed.
 */
export async function createRaiaSession(input: CreateSessionInput): Promise<RaiaResult> {
  const base = (process.env.RAIA_API_URL || '').replace(/\/$/, '');
  const key = process.env.RAIA_API_KEY || '';
  if (!base || !key) return { error: 'RAIA is not configured' };

  const body = {
    candidate: toRaiaCandidate(input.candidate, input.disc),
    opening: toRaiaOpening(input.opening),
    ...(input.roleContext ? { roleContext: input.roleContext } : {}),
    ...(input.pipeline
      ? { pipeline: toRaiaPipeline(input.pipeline.pipeline, input.pipeline.pipelineCandidate) }
      : {}),
    ...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
  };

  try {
    const res = await fetch(`${base}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      // A recruiter opening a brief will not wait longer than this, and a slow
      // RAIA should show "no brief" rather than hang the page.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { error: `RAIA returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    }

    return { session: (await res.json()) as RaiaSession };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[raia-client] session failed:', error);
    return { error };
  }
}
