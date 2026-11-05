// ═══════════════════════════════════════════════════════════════════════════
//  Firestore document  ⇄  relational row.
//
//  Admin's screens think in Firestore documents: one loose bag of fields per
//  record. The n365 tables are relational, with typed columns and constraints.
//  This is the single place that translates between them, so a screen never has
//  to know and the two directions can never drift apart.
//
//  Only the columns a screen filters, sorts or joins on are mapped. Everything
//  else lives in `raw`, the whole document exactly as Admin wrote it — which is
//  what lets a field nobody thought to map survive anyway, and makes a wrong
//  mapping an UPDATE rather than a migration.
// ═══════════════════════════════════════════════════════════════════════════

export type Doc = Record<string, unknown>;

export type Mapping = {
  table: string;
  schema?: string;
  /** Columns derived from the document. */
  columns: (doc: Doc, ctx: Ctx) => Record<string, unknown>;
};

export type Ctx = {
  /** Nearwork's own organization id — the owner of anything without a client. */
  nearworkOrgId: string | null;
  /** legacy_id -> uuid, for the tables this row points at. */
  orgs: Record<string, string>;
  openings: Record<string, string>;
  pipelines: Record<string, string>;
  candidates: Record<string, string>;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Firestore Timestamps, ISO strings and epoch numbers all become ISO strings. */
export function iso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return Number.isNaN(Date.parse(v)) ? null : v;
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'object') {
    const o = v as { seconds?: number; _seconds?: number; toMillis?: () => number };
    if (typeof o.toMillis === 'function') return new Date(o.toMillis()).toISOString();
    const s = o.seconds ?? o._seconds;
    if (typeof s === 'number') return new Date(s * 1000).toISOString();
  }
  return null;
}

// Firestore's free-text employment words against the closed set n365 allows.
// Anything unrecognised becomes null rather than a guess; the original string
// is still in raw.
const EMPLOYMENT: Record<string, string> = {
  'employment (payroll)': 'full_time',
  'full time': 'full_time', 'full-time': 'full_time', fulltime: 'full_time',
  'part time': 'part_time', 'part-time': 'part_time',
  freelance: 'contract', contractor: 'contract', contract: 'contract',
  temporary: 'temporary', temp: 'temporary',
  internship: 'internship', intern: 'internship',
};

const APPLICATION_STATUS: Record<string, string> = {
  applied: 'new', new: 'new', pending: 'new',
  approved: 'advanced', advanced: 'advanced', hired: 'advanced',
  rejected: 'not_selected', declined: 'not_selected', not_selected: 'not_selected',
};

const PIPELINE_TYPES = new Set(['full', 'sourcing', 'self']);
const pipelineType = (v: unknown) =>
  PIPELINE_TYPES.has(String(v)) ? String(v) : 'full';

/** The organization a document belongs to, falling back to Nearwork's own. */
function orgOf(doc: Doc, ctx: Ctx): string | null {
  const key = str(doc.orgId) ?? str(doc.organizationId);
  return (key ? ctx.orgs[key] : null) ?? ctx.nearworkOrgId;
}

export const MAPPINGS: Record<string, Mapping> = {
  organizations: {
    table: 'organizations',
    columns: (d) => ({
      name: str(d.name) ?? '(unnamed)',
      website: str(d.website),
      status: str(d.status) ?? 'active',
      account_manager_name: str(d.accountManagerName),
      account_manager_email: str(d.accountManagerEmail),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  openings: {
    table: 'openings',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      code: str(d.code),
      title: str(d.title) ?? '(untitled)',
      status: str(d.status) ?? 'draft',
      published: Boolean(d.published),
      pipeline_type: pipelineType(d.pipelineType),
      recruiter: str(d.recruiter),
      salary_min: num(d.salaryMin),
      salary_max: num(d.salaryMax),
      currency: str(d.salaryCurrency) ?? str(d.currency),
      skills: arr(d.skills),
      seniority: str(d.seniority),
      description: str(d.description) ?? str(d.publicSummary),
      location: str(d.location) ?? str(d.city),
      employment_type: EMPLOYMENT[String(d.contract ?? '').toLowerCase()] ?? null,
      source: 'nearwork',
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  pipelines: {
    table: 'pipelines',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      code: str(d.code),
      opening_id: ctx.openings[str(d.openingId) ?? str(d.code) ?? ''] ?? null,
      opening_code: str(d.code),
      opening_title: str(d.title),
      recruiter: str(d.recruiter),
      status: str(d.status) ?? 'active',
      pipeline_type: pipelineType(d.pipelineType),
      brief_status: str(d.briefStatus),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  candidates: {
    table: 'candidates',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      code: str(d.code) ?? str(d.candidateCode),
      // Ours, not a client's. This one column is the whole guest-versus-owned
      // rule — a client's ATS must never surface a name never offered to them.
      source: 'nearwork',
      name: str(d.name) ?? '(unnamed)',
      email: str(d.email),
      phone: str(d.phone),
      role: str(d.role) ?? str(d.currentRole),
      headline: str(d.headline),
      status: str(d.status),
      city: str(d.city) ?? str(d.locationCity),
      location: str(d.location),
      photo_url: str(d.photoUrl) ?? str(d.photoURL),
      cv_url: str(d.cvUrl) ?? str(d.cv),
      linkedin: str(d.linkedin) ?? str(d.linkedIn),
      skills: arr(d.skills),
      tools: arr(d.tools),
      english: str(d.english) ?? str(d.englishLevel),
      expected_salary_amount: num(d.expectedSalaryAmount) ?? num(d.salaryAmount),
      expected_salary_currency: str(d.expectedSalaryCurrency) ?? str(d.salaryCurrency),
      work_history: arr(d.workHistory ?? d.work),
      education: arr(d.education),
      certifications: arr(d.certifications),
      languages: arr(d.languages),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  applications: {
    table: 'applications',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      opening_id:
        ctx.openings[str(d.openingId) ?? ''] ??
        ctx.openings[str(d.openingCode) ?? ''] ??
        ctx.openings[str(d.jobId) ?? ''] ?? null,
      candidate_id:
        ctx.candidates[str(d.candidateDocId) ?? ''] ??
        ctx.candidates[str(d.candidateId) ?? ''] ?? null,
      status: APPLICATION_STATUS[String(d.status ?? '').toLowerCase()] ?? 'new',
      source: str(d.source),
      answers: d.questions ?? [],
      applied_at: iso(d.submittedAt) ?? iso(d.createdAt) ?? new Date().toISOString(),
    }),
  },

  candidateNotes: {
    table: 'notes',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      candidate_id: ctx.candidates[str(d.candidateId) ?? str(d.candidateDocId) ?? ''] ?? null,
      // Written in Admin, so ours and staff-internal unless it says otherwise.
      // Guessing client_visible would leak an internal note to the client.
      side: str(d.side) ?? 'nearwork',
      visibility: str(d.scope) ?? 'staff_internal',
      body: str(d.body) ?? str(d.text) ?? '',
      author_name: str(d.authorName) ?? str(d.author),
      author_email: str(d.authorEmail),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  pipeline_messages: {
    table: 'messages',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      pipeline_id: ctx.pipelines[str(d.pipelineId) ?? str(d.pipelineCode) ?? ''] ?? null,
      body: str(d.body) ?? str(d.text) ?? '',
      author_name: str(d.authorName) ?? str(d.author),
      author_email: str(d.authorEmail),
      author_type: (d.side ?? d.authorType) === 'client' ? 'client' : 'nearwork',
    }),
  },

  pipelineRequests: {
    table: 'requests',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      candidate_id: ctx.candidates[str(d.candidateId) ?? ''] ?? null,
      pipeline_id: ctx.pipelines[str(d.pipelineId) ?? str(d.pipelineCode) ?? ''] ?? null,
      type: str(d.type) ?? 'move',
      from_stage: str(d.fromStage),
      to_stage: str(d.toStage),
      reason: str(d.reason),
      status: str(d.status) ?? 'pending',
      requested_by_email: str(d.requestedByEmail) ?? str(d.requestedBy),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  sourcedCandidates: {
    table: 'sourced_candidates',
    schema: 'n365',
    columns: (d, ctx) => ({
      opening_id: ctx.openings[str(d.openingId) ?? ''] ?? null,
      legacy_opening_id: str(d.openingId),
      name: str(d.name) ?? '(unnamed)',
      headline: str(d.headline),
      linkedin: str(d.linkedin) ?? str(d.li),
      location: str(d.location),
      country: str(d.country),
      salary: str(d.salary),
      status: str(d.status),
      applied: Boolean(d.applied),
      reason: str(d.reason),
      notes: str(d.notes),
      owner: str(d.owner),
      source: str(d.source),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },

  kickoffBriefs: {
    table: 'kickoff_briefs',
    schema: 'n365',
    columns: (d, ctx) => ({
      org_id: orgOf(d, ctx),
      opening_id: ctx.openings[str(d.openingId) ?? ''] ?? null,
      legacy_opening_id: str(d.openingId),
      status: str(d.status) ?? str(d.briefStatus),
      updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    }),
  },
};

export function isWritable(collection: string): boolean {
  return collection in MAPPINGS;
}
