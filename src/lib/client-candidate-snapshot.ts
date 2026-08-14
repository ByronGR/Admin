// ── Client-facing candidate snapshot embedded into the pipeline entry ─────────
// The client App portal reads only the `pipelines` collection (candidates are
// embedded) — it has no read access to the `candidates` collection. So any field
// we want a client to see about a candidate must be copied onto the pipeline
// entry. These fields are sourcing-safe: profile facts we actually provide
// (no assessment / DISC). Full-recruitment pipelines carry them too — harmless,
// and it fills in the header (location / skills) that used to be blank.

import type { Candidate, PipelineCandidate } from './types';

export type ClientCandidateSnapshot = Partial<Pick<PipelineCandidate,
  | 'role' | 'location' | 'phone' | 'linkedIn' | 'skills' | 'tools' | 'experience' | 'expectedSalary'
  | 'expectedSalaryAmount' | 'expectedSalaryCurrency' | 'english'
  | 'availability' | 'timezone' | 'workHistory' | 'education' | 'resumeUrl' | 'cvUrl'>>;

// Firestore rejects `undefined` (including inside array elements), so we only
// emit keys that actually have a value.
export function clientCandidateSnapshot(c: Partial<Candidate>): ClientCandidateSnapshot {
  const out: ClientCandidateSnapshot = {};
  const set = <K extends keyof ClientCandidateSnapshot>(k: K, v: ClientCandidateSnapshot[K] | undefined | null) => {
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  };

  set('role', c.role || c.targetRole || c.currentRole || undefined);
  set('location', c.location || c.locationCity || undefined);
  set('phone', c.phone || undefined);
  // Shown to sourcing clients only, under the same gate as the phone — on those
  // engagements they do the contacting, so withholding the profile while showing
  // the phone number would be a distinction without a difference.
  set('linkedIn', c.linkedIn || undefined);
  set('skills', Array.isArray(c.skills) ? c.skills : undefined);
  set('tools', Array.isArray(c.tools) ? c.tools : undefined);
  set('education', Array.isArray(c.education) ? c.education : undefined);
  set('experience', typeof c.experience === 'number' ? c.experience : undefined);

  if (typeof c.expectedSalary === 'string' && c.expectedSalary.trim()) set('expectedSalary', c.expectedSalary);
  const salaryAmount = typeof c.expectedSalaryAmount === 'number'
    ? c.expectedSalaryAmount
    : (typeof c.expectedSalary === 'number' ? c.expectedSalary : undefined);
  set('expectedSalaryAmount', salaryAmount);
  set('expectedSalaryCurrency', c.expectedSalaryCurrency || undefined);

  set('english', c.englishScore?.level || (typeof c.english === 'string' ? c.english : undefined));
  set('availability', c.availability || undefined);
  set('timezone', c.timezone || undefined);

  const work = Array.isArray(c.workHistory)
    ? c.workHistory.filter((w) => w && (w.company || w.title))
    : undefined;
  set('workHistory', work && work.length ? work : undefined);

  const resume = c.resumeUrl || c.cvUrl || undefined;
  set('resumeUrl', resume);
  set('cvUrl', resume);

  return out;
}
