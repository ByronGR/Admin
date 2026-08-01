// ── AI extraction → Candidate record ─────────────────────────────────────────
// Maps the parser's output onto our Candidate shape. Deliberately conservative:
//   • Only emits keys that actually have a value, so a re-parse can never blank
//     out a field a human curated by hand.
//   • Never overwrites the Nearwork English assessment. englishScore is our
//     verified result; the CV only ever contributes a self-reported claim.

import type { AIExtractedCV } from './cv-ai-extract';
import type { Candidate, WorkHistoryEntry, CertificationEntry } from './types';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

export interface MapOptions {
  model?: string;
  schemaVersion?: number;
  rawText?: string;
}

/**
 * Build the Candidate patch for an extracted profile.
 * Merge this over the existing doc — it never contains empty values, so
 * anything the CV didn't mention is left exactly as it was.
 */
export function aiProfileToCandidate(
  p: AIExtractedCV,
  opts: MapOptions = {},
): Partial<Candidate> {
  const out: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && !v.trim()) return;
    if (Array.isArray(v) && v.length === 0) return;
    out[k] = v;
  };

  // Identity & contact
  const name = str(p.fullName);
  set('name', name);
  if (name.includes(' ')) {
    set('firstName', name.split(' ')[0]);
    set('lastName', name.split(' ').slice(1).join(' '));
  }
  set('email', str(p.email).toLowerCase());
  set('phone', str(p.phone));
  set('city', str(p.city));
  set('locationCity', str(p.city));
  set('locationCountry', str(p.countryCode));
  set('location', [str(p.city), str(p.countryCode)].filter(Boolean).join(', '));
  set('linkedIn', str(p.linkedin));
  set('portfolio', str(p.portfolio) || str(p.github));

  // Profile
  set('headline', str(p.headline));
  set('summary', str(p.summary));
  set('role', str(p.headline));
  set('currentCompany', str(p.currentEmployer));

  // Classification — the matching backbone
  set('function', str(p.function) === 'unknown' ? '' : str(p.function));
  set('subFunction', str(p.subFunction));
  set('seniority', str(p.seniority) === 'unknown' ? '' : str(p.seniority));
  if (typeof p.yearsExperience === 'number') set('experience', p.yearsExperience);
  if (typeof p.yearsInFunction === 'number') set('yearsInFunction', p.yearsInFunction);

  set('skills', arr(p.skills));
  set('tools', arr(p.tools));
  set('industries', arr(p.industries));

  // Work history — accomplishments stay separate from responsibilities
  const work: WorkHistoryEntry[] = (p.workHistory || [])
    .filter((w) => str(w.company) || str(w.title))
    .map((w) => {
      const e: WorkHistoryEntry = {};
      if (str(w.company)) e.company = str(w.company);
      if (str(w.title)) e.title = str(w.title);
      if (str(w.startDate)) e.from = str(w.startDate);
      if (str(w.endDate)) e.to = str(w.endDate);
      if (w.isCurrent) e.isCurrent = true;
      if (str(w.location)) e.location = str(w.location);
      if (str(w.industry)) e.industry = str(w.industry);
      if (arr(w.responsibilities).length) e.responsibilities = arr(w.responsibilities);
      if (arr(w.accomplishments).length) e.accomplishments = arr(w.accomplishments);
      return e;
    });
  set('workHistory', work);

  const certs: CertificationEntry[] = (p.certifications || [])
    .filter((c) => str(c.name))
    .map((c) => {
      const e: CertificationEntry = { name: str(c.name) };
      if (str(c.issuer)) e.issuer = str(c.issuer);
      if (c.year != null) e.date = String(c.year);
      return e;
    });
  set('certifications', certs);

  // Languages are stored as plain strings on Candidate; keep the claimed level
  // in the label so nothing is silently dropped.
  set(
    'languages',
    (p.languages || [])
      .filter((l) => str(l.language))
      .map((l) => (str(l.claimedLevel) ? `${str(l.language)} (${str(l.claimedLevel)})` : str(l.language))),
  );

  // English: CV claims are self-reported. Written to `english` only — the
  // assessed `englishScore` is never touched here.
  set('english', str(p.englishClaimed));

  set('expectedSalary', str(p.salaryExpectation));
  set('availability', str(p.availability));

  const cvParse: Record<string, unknown> = { parsedAt: new Date().toISOString() };
  if (opts.model) cvParse.model = opts.model;
  if (opts.schemaVersion) cvParse.schemaVersion = opts.schemaVersion;
  if (arr(p.lowConfidence).length) cvParse.lowConfidence = arr(p.lowConfidence);
  if (opts.rawText) cvParse.rawText = opts.rawText;
  out.cvParse = cvParse;

  return out as Partial<Candidate>;
}

/** Education has no dedicated Candidate field yet — surfaced for the caller. */
export function educationLines(p: AIExtractedCV): string[] {
  return (p.education || [])
    .map((e) => {
      const heading = str(e.degree) || str(e.field);
      if (!heading) return '';
      const sub = str(e.degree) && str(e.field) && e.degree !== e.field ? ` — ${str(e.field)}` : '';
      const tail = [str(e.institution), e.endYear ?? ''].filter(Boolean).join(' · ');
      return `${heading}${sub}${tail ? ` · ${tail}` : ''}`;
    })
    .filter(Boolean);
}
