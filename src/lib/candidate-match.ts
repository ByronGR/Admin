// ── Candidate ↔ opening matching ─────────────────────────────────────────────
// Pure code, no API calls. Both sides were classified by the AI extractors; this
// only compares them, so scoring a new opening against the whole database is
// free and instant.
//
// Design rules, in the order they were decided:
//
//  1. Nobody is lost to an extraction gap. A skill missing from the structured
//     data is checked against the CV's raw text before it counts as missing.
//  2. Skills are never a hard gate. A strong operations person who never wrote
//     "process improvement" on their CV still surfaces.
//  3. Requirements are read as intent, not as a filter. A client asking for 4
//     years does not mean 3.5 years is disqualifying — near misses score near.
//  4. The reason is always shown. Every result carries what matched and what
//     didn't, so a recruiter can disagree with the ranking on sight.
//
// The one genuine gate is discipline: a finance opening should not surface
// designers. Even that admits candidates whose function never got classified,
// rather than hiding them.

import type { Candidate, Opening, OpeningReqs } from './types';

export interface MatchDetail {
  candidateId: string;
  name: string;
  // Display fields, carried alongside the score so a result card doesn't need a
  // second read of the candidate it was just scored from.
  role?: string;
  location?: string;
  expectedSalary?: string;
  years?: number;
  score: number;              // 0–100
  band: 'strong' | 'possible' | 'stretch';
  matchedMustHave: string[];
  missingMustHave: string[];
  matchedNiceToHave: string[];
  matchedTools: string[];
  reasons: string[];          // plain-English, shown in the UI
  cautions: string[];         // what a recruiter should check
}

/** Normalize a skill for comparison: lowercase, no punctuation, singular-ish. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

/** Common phrasings for the same capability — keeps near-misses from reading as gaps. */
const ALIASES: Record<string, string[]> = {
  'email marketing': ['lifecycle marketing', 'crm marketing', 'email campaign', 'marketing automation'],
  'social media': ['social media management', 'community management', 'social content'],
  'project management': ['program management', 'project coordination', 'delivery management'],
  'customer service': ['customer support', 'client service', 'customer care', 'help desk'],
  'data analysis': ['data analytic', 'analytic', 'reporting and analysi', 'business intelligence'],
  'financial reporting': ['financial statement', 'month end close', 'accounting report'],
  'bookkeeping': ['accounts payable', 'accounts receivable', 'general ledger'],
  'recruiting': ['talent acquisition', 'sourcing', 'headhunting'],
  'process improvement': ['process optimization', 'operational efficiency', 'continuous improvement'],
  'copywriting': ['content writing', 'content creation', 'copy'],
  'graphic design': ['visual design', 'brand design'],
  'seo': ['search engine optimization', 'organic search'],
  'paid ads': ['paid media', 'ppc', 'google ad', 'meta ad', 'performance marketing'],
};

/** Every phrasing that should count as a hit for `skill`. */
function variants(skill: string): string[] {
  const n = norm(skill);
  const out = new Set([n]);
  for (const [canon, alts] of Object.entries(ALIASES)) {
    const c = norm(canon);
    const a = alts.map(norm);
    if (n === c || a.includes(n)) { out.add(c); a.forEach((x) => out.add(x)); }
  }
  return [...out];
}

/**
 * Does this candidate have `skill`?
 * Checks structured skills and tools first, then work-history text, then the
 * CV's raw text — so a capability the extractor missed still counts.
 */
function hasSkill(c: Candidate, skill: string): boolean {
  const vs = variants(skill);
  const structured = [...(c.skills || []), ...(c.tools || [])].map(norm);
  if (structured.some((s) => vs.some((v) => s.includes(v) || v.includes(s)))) return true;

  const workText = norm(
    (c.workHistory || [])
      .map((w) => [w.title, ...(w.responsibilities || []), ...(w.accomplishments || [])].join(' '))
      .join(' '),
  );
  if (vs.some((v) => workText.includes(v))) return true;

  // Last resort: the CV as written. Catches anything the schema didn't have a
  // home for, which is exactly the case that would otherwise lose a candidate.
  const raw = norm(String(c.cvParse?.rawText || ''));
  return raw ? vs.some((v) => raw.includes(v)) : false;
}

const SENIORITY_RANK: Record<string, number> = {
  intern: 0, junior: 1, mid: 2, senior: 3, lead: 4, manager: 5, director: 6, vp: 7, c_level: 8,
};

/**
 * Years score, deliberately forgiving. Meeting the ask scores full; being close
 * scores nearly full; being well over is not penalised, because "too senior" is
 * a conversation, not a disqualification.
 */
function yearsScore(has: number | undefined, wants: number | null | undefined): number {
  if (wants == null || !Number.isFinite(wants)) return 1;      // nothing asked for
  if (has == null || !Number.isFinite(has)) return 0.6;        // unknown ≠ unqualified
  if (has >= wants) return 1;
  const gap = wants - has;
  if (gap <= 1) return 0.9;        // 3.5 against a 4-year ask
  if (gap <= 2) return 0.7;
  if (gap <= 4) return 0.45;
  return 0.2;
}

function seniorityScore(has: string | undefined, wants: string | undefined): number {
  const h = SENIORITY_RANK[has || ''];
  const w = SENIORITY_RANK[wants || ''];
  if (w == null) return 1;
  if (h == null) return 0.6;
  const gap = Math.abs(h - w);
  if (gap === 0) return 1;
  if (gap === 1) return 0.85;      // a senior for a lead role is worth seeing
  if (gap === 2) return 0.6;
  return 0.3;
}

// Weights. Must-have skills dominate, but never enough on their own to make a
// wrong-discipline candidate outrank a right-discipline one.
const W = { must: 45, nice: 12, seniority: 15, years: 15, tools: 8, industry: 5 };

export function scoreCandidate(c: Candidate, reqs: OpeningReqs): MatchDetail {
  const reasons: string[] = [];
  const cautions: string[] = [];

  const must = reqs.mustHaveSkills || [];
  const nice = reqs.niceToHaveSkills || [];
  const tools = reqs.tools || [];

  const matchedMustHave = must.filter((s) => hasSkill(c, s));
  const missingMustHave = must.filter((s) => !matchedMustHave.includes(s));
  const matchedNiceToHave = nice.filter((s) => hasSkill(c, s));
  const matchedTools = tools.filter((t) => hasSkill(c, t));

  const mustPart = must.length ? matchedMustHave.length / must.length : 1;
  const nicePart = nice.length ? matchedNiceToHave.length / nice.length : 0;
  const toolPart = tools.length ? matchedTools.length / tools.length : 1;
  const senPart = seniorityScore(c.seniority, reqs.seniority);
  const yrsPart = yearsScore(
    typeof c.yearsInFunction === 'number' ? c.yearsInFunction : Number(c.experience),
    reqs.yearsRequired,
  );

  const candIndustries = (c.industries || []).map(norm);
  const wantIndustries = (reqs.industries || []).map(norm);
  const industryHit = wantIndustries.length
    ? wantIndustries.some((w) => candIndustries.some((x) => x.includes(w) || w.includes(x)))
    : false;

  let score =
    mustPart * W.must +
    nicePart * W.nice +
    senPart * W.seniority +
    yrsPart * W.years +
    toolPart * W.tools +
    (industryHit ? W.industry : 0);

  // Discipline. A different function is a real signal, so it costs a lot — but
  // it never removes the candidate, and an unclassified candidate is treated as
  // a small unknown rather than a mismatch.
  const wantFn = reqs.function && reqs.function !== 'unknown' ? reqs.function : '';
  if (wantFn) {
    if (!c.function) {
      score *= 0.85;
      cautions.push('Discipline not classified on this profile — worth a glance');
    } else if (c.function !== wantFn) {
      score *= 0.45;
      cautions.push(`Background is ${c.function.replace(/_/g, ' ')}, not ${wantFn.replace(/_/g, ' ')}`);
    } else if (reqs.subFunction && c.subFunction === reqs.subFunction) {
      score = Math.min(100, score + 5);
      reasons.push(`Same specialism (${reqs.subFunction.replace(/_/g, ' ')})`);
    }
  }

  // Plain-English reasons, in the order a recruiter would care about them.
  if (must.length && matchedMustHave.length) {
    reasons.push(`${matchedMustHave.length} of ${must.length} must-haves: ${matchedMustHave.join(', ')}`);
  }
  if (matchedNiceToHave.length) reasons.push(`Also has ${matchedNiceToHave.slice(0, 4).join(', ')}`);
  if (matchedTools.length) reasons.push(`Tools: ${matchedTools.join(', ')}`);
  if (industryHit) reasons.push(`Worked in ${reqs.industries?.[0]}`);

  const yrs = typeof c.yearsInFunction === 'number' ? c.yearsInFunction : Number(c.experience);
  if (reqs.yearsRequired != null && Number.isFinite(yrs)) {
    if (yrs >= reqs.yearsRequired) reasons.push(`${yrs} yrs experience (asked for ${reqs.yearsRequired})`);
    else cautions.push(`${yrs} yrs vs ${reqs.yearsRequired} asked for`);
  }
  if (missingMustHave.length) {
    cautions.push(`No evidence of: ${missingMustHave.join(', ')}`);
  }
  if (reqs.englishRequired && !c.englishScore && !c.english) {
    cautions.push(`English not assessed (role asks for ${reqs.englishRequired})`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: MatchDetail['band'] = score >= 70 ? 'strong' : score >= 45 ? 'possible' : 'stretch';

  return {
    candidateId: c.id,
    name: c.name || '(no name)',
    role: c.headline || c.role || '',
    location: c.location || [c.locationCity, c.locationCountry].filter(Boolean).join(', '),
    expectedSalary: c.expectedSalary != null ? String(c.expectedSalary) : '',
    ...(Number.isFinite(yrs) ? { years: yrs } : {}),
    score, band,
    matchedMustHave, missingMustHave, matchedNiceToHave, matchedTools,
    reasons, cautions,
  };
}

/** Rank a whole candidate pool against one opening. */
export function matchCandidates(
  candidates: Candidate[],
  opening: Pick<Opening, 'reqs'>,
  limit = 25,
): MatchDetail[] {
  const reqs = opening.reqs;
  if (!reqs) return [];
  return candidates
    .map((c) => scoreCandidate(c, reqs))
    .filter((m) => m.score >= 25)      // below this it's noise, not a stretch
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
