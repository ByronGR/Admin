// ─── Core entity types for Nearwork Admin ─────────────────────────────────────

export type Timestamp = {
  toDate(): Date;
  seconds: number;
  nanoseconds: number;
};

// ─── User / Auth ──────────────────────────────────────────────────────────────

export type StaffRole =
  | 'super_admin'
  | 'admin'
  | 'recruiter'
  | 'sales'
  | 'hr'
  | 'employee'
  | 'user';

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  recruiter: 'Recruiter',
  sales: 'Sales',
  hr: 'HR',
  employee: 'Employee',
  user: 'User',
};

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  role: StaffRole;        // permission/access level (controls what they can do)
  staffRole: StaffRole;
  jobTitle?: string;      // human job title shown in the UI (CEO, Account Manager…) — editable
  photoUrl?: string;
  calendlyLink?: string;
  source?: string;
  status?: 'active' | 'inactive' | 'suspended';
  // 'placed' = an employee placed with a client (locked out of internal data by the
  // Firestore rules). Internal staff must be 'internal' (or unset, which defaults to
  // internal). A mistaken 'placed' value is what blocks a staffer from pipelines.
  employmentType?: 'internal' | 'placed';
  orgId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Staff Invite ─────────────────────────────────────────────────────────────

export interface StaffInvite {
  id: string;
  email: string;
  role: StaffRole;
  invitedBy: string;
  invitedByEmail?: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  token: string;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
  acceptedAt?: Timestamp;
}

// ─── English / CEFR ──────────────────────────────────────────────────────────

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface EnglishScore {
  level: CEFRLevel;
  feedback: string;
  assessedBy?: string;
  assessedAt?: string;
}

// ─── Organization ─────────────────────────────────────────────────────────────

export type OrgPackage = 'essential' | 'starter' | 'growth' | 'scale' | 'enterprise' | 'eor' | 'spp';
export type OrgContractType = 'managed_team' | 'eor' | 'spp' | 'direct';

export interface OrgUser {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  role?: string;
  status?: 'invited' | 'active' | 'inactive';
  invitedAt?: string;
}

// A client account as it actually exists in the App's `users` collection.
// Used by the Admin People tab to show real login status (vs. just "invited").
export interface ClientAccount {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  displayRole?: string;
  orgId?: string;
  suspended?: boolean;
  lastLoginAt?: { seconds: number } | string | null;
}

// ─── Account Health (internal — never shown to the partner) ────────────────────
// A = Excellent · B = Healthy · C = Stable/Watchlist · D = At Risk
// F = Critical · Z = Inactive / No Signal
export type AccountHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'Z';

export interface HealthHistoryEntry {
  grade: AccountHealthGrade;
  note: string;        // why the account is at this grade — required on each change
  by?: string;         // staff name/email who set it
  at: string;          // ISO timestamp
}

// ─── Tier (spend-based — never shown to the partner) ───────────────────────────
// A $250k+ · B $100k–249,999 · C $50k–99,999 · D $25k–49,999
// E $10k–24,999 · F $1–9,999 · Z $0
export type OrgTier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'Z';

// ─── SPP (Strategic Partner Program) — parent/child org relationships ──────────
// A Strategic Partner org sits above its own sub-client orgs. Hires & spend roll up.

export interface Organization {
  id: string;
  name: string;
  shortId?: string;
  industry?: string;
  website?: string;
  country?: string;
  city?: string;
  address?: string;
  logo?: string;
  status?: 'active' | 'inactive' | 'prospect' | 'suspended';
  internal?: boolean;          // Nearwork's own org (e.g. lead-tracking) — staff can self-approve kick-off briefs
  package?: OrgPackage;
  contractType?: OrgContractType;
  hubspotLink?: string;
  contractStart?: string;
  contractEnd?: string;
  source?: string;
  orgUsers?: OrgUser[];
  cacEntries?: CACEntry[];
  // ─── Account Intelligence (internal — never shown to the partner) ───────────
  totalSpend?: number;                    // lifetime spend; later pulled from Stripe → drives Tier
  stripeCustomerId?: string;              // Stripe Customer ID (cus_xxx) — manual link, drives Billing tab
  healthGrade?: AccountHealthGrade;       // current Account Health
  healthUpdatedAt?: string;               // ISO timestamp of last health change
  healthHistory?: HealthHistoryEntry[];   // trend log; a note is required on every change
  actionNeeded?: boolean;                 // surfaced on the main list (pipeline movement, client msg…)
  actionNote?: string;                    // what action is needed
  // ─── People ─────────────────────────────────────────────────────────────────
  pocContacts?: OrgPOC[];                 // client-side decision-makers (one or more)
  accountManager?: string;                // Nearwork AM — owns the relationship (most important)
  accountManagerEmail?: string;           // AM email — surfaced to the client in app.nearwork.co
  accountManagerPhone?: string;           // AM phone — surfaced to the client in app.nearwork.co
  salesCloser?: string;                   // Nearwork rep who closed the deal
  salesCloserEmail?: string;
  teamLead?: string;                      // Nearwork-side lead for this org's managed team
  teamLeadEmail?: string;
  // ─── SPP (Strategic Partner Program) — parent/child orgs ────────────────────
  isStrategicPartner?: boolean;           // this org is an SPP parent with sub-client orgs
  parentOrgId?: string;                   // if set, this org is a sub-client under a parent SPP org
  parentOrgName?: string;                 // denormalized parent name for display
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Client-side point of contact / decision-maker
export interface OrgPOC {
  id: string;
  name: string;
  role?: string;        // job title at the client
  email?: string;
  phone?: string;
  isDecisionMaker?: boolean;
}

export interface CACEntry {
  id: string;
  cost: number;
  category: string;
  description?: string;
  date: string;
  createdBy?: string;
}

// ─── Opening ──────────────────────────────────────────────────────────────────

export type OpeningStatus =
  | 'open'
  | 'paused'
  | 'filled'
  | 'cancelled'
  | 'draft';

export type OpeningApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'published';

export interface Opening {
  id: string;
  orgId: string;
  orgName?: string;
  title: string;
  department?: string;
  location?: string;
  remote?: boolean;
  type?: 'full_time' | 'part_time' | 'contract' | 'freelance';
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  hideSalary?: boolean;
  hideLocation?: boolean;
  hideBenefits?: boolean;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  status: OpeningStatus;
  approvalStatus?: OpeningApprovalStatus;
  // Engagement type. 'full' = Nearwork runs the whole pipeline (default).
  // 'sourcing' = Nearwork sources + screens + submits; the client runs their own
  // interviews/assessment/hiring. Drives the pipeline stages, emails and who can
  // move a candidate. See lib/pipeline-stages.ts.
  pipelineType?: 'full' | 'sourcing';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  targetDate?: string;
  // Shared opening ID across Admin / Jobs / Talent (mirrors the pipeline NW code)
  code?: string;
  // Team fields
  sourcer?: string;
  recruiter?: string;
  recruiterEmail?: string;
  hiringManager?: string;
  accountManager?: string;
  assessmentId?: string;
  questionSettings?: QuestionSettings;
  applicationCount?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;

  // ─── Opening sheet (Stage 2) — candidate-facing content that projects to
  // jobs.nearwork.co. Auto-populated from the kickoff brief on client approval;
  // admin can edit/enrich afterwards. ─────────────────────────────────────────
  publicSummary?: string;          // candidate-facing role description (legacy/short form)
  skills?: string[];               // key skills (chips on the job card)
  industry?: string;               // e.g. SaaS, Fintech
  seniority?: string;              // e.g. Junior / Mid / Senior
  workMode?: WorkMode;             // remote / hybrid / onsite
  city?: string;                   // candidate-facing location
  benefits?: string;               // free-text benefits / perks (legacy)

  // ─── Structured content sections (populated from brief, shown on detail page) ──
  content_about?: string;           // "Role overview" — long-form about the role/company
  content_responsibilities?: string[]; // "What you'll own" — one item per bullet
  content_qualifications?: string[];   // "What we're looking for" — must-have requirements
  content_benefits?: string[];         // "What you get" — benefits list
  niceToHave?: string[];               // Nice-to-have skills (optional)
  contract?: string;                   // Contract type (full-time / contract / part-time)
  timezone?: string;                   // Timezone requirement
  tz?: string;                         // Timezone alias (legacy — Jobs site reads either)

  // Per-role candidate job-match alert switch. When true, publishing this role
  // emails available, opted-in candidates whose skills strongly match. Off by
  // default — replaces the old global JOB_ALERT_ENABLED env flag.
  notifyCandidatesOnPublish?: boolean;
  jobMatchAlertSentAt?: Timestamp; // set once alerts have fired (dedup)

  // ─── Jobs projection (written on publish so jobs.nearwork.co can read it) ───
  published?: boolean;             // jobs.nearwork.co filters on published == true
  publishedAt?: Timestamp;
  briefStatus?: string;            // synced from kickoffBriefs by /api/kickoff on every status change
  // Jobs-schema mirror fields (denormalized from the above on publish):
  currency?: string;               // mirrors salaryCurrency
  wfh?: string;                    // "Remote" | "Hybrid" | "On-site" (from workMode)
  exp?: string;                    // mirrors seniority
  'sb-exp'?: string;               // mirrors seniority (Jobs reads either)

  // Extracted requirements — the opening half of candidate matching. Written by
  // /api/opening-parse, then editable by staff (a recruiter always outranks the
  // extractor, so `editedBy` marks entries that must not be overwritten).
  reqs?: OpeningReqs;
}

export interface OpeningReqs {
  function?: string;
  subFunction?: string;
  seniority?: string;
  yearsRequired?: number | null;
  englishRequired?: string;
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
  tools?: string[];
  industries?: string[];
  summary?: string;
  notes?: string[];
  extractedAt?: string;
  model?: string;
  schemaVersion?: number;
  editedBy?: string;               // set once a human adjusts the split
  editedAt?: string;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

export interface QuestionSettings {
  useAssessment: boolean;
  questionCount?: number;
  categories?: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
}

// ─── Candidate ────────────────────────────────────────────────────────────────

export type CandidateStatus =
  | 'new'
  | 'screening'
  | 'interviewing'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface WorkHistoryEntry {
  company?: string;
  title?: string;
  from?: string;
  to?: string;
  contact?: string;
  // ── Added by the AI CV parser ──
  location?: string;
  industry?: string;
  isCurrent?: boolean;
  responsibilities?: string[];  // duties
  accomplishments?: string[];   // quantified outcomes — kept separate on purpose,
                                // this is the material worth showing a client
}

export interface CertificationEntry {
  name: string;
  issuer?: string;
  date?: string;
}

export interface EducationEntry {
  degree?: string;        // the qualification as written on the CV
  field?: string;         // subject, only when distinct from the degree name
  institution?: string;
  endYear?: number;
}

export interface Candidate {
  id: string;
  // Short, human-readable ID (e.g. "K7M2PX"). For candidates created in Admin
  // this equals the Firestore document ID, so /candidates/<code> resolves
  // directly and a hired placement can share the same ID.
  code?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  location?: string;
  country?: string;
  city?: string;
  // Structured location written by Talent/Jobs onboarding. For non-Colombia
  // candidates only locationCountry is set (no city/department).
  locationCountry?: string;
  locationCity?: string;
  locationDepartment?: string;
  department?: string;
  linkedIn?: string;
  portfolio?: string;
  resumeUrl?: string;
  cvUrl?: string;             // alias written by jobs.nearwork.co — same as resumeUrl
  // Two spellings in the wild: Admin has always written `photoUrl`, the Talent
  // onboarding writes `photoURL`. Read both — see candidatePhoto().
  photoUrl?: string;
  photoURL?: string;
  // WhatsApp can now be reached by username instead of a number, and the two
  // are not interchangeable: wa.me accepts digits only and there is no username
  // deep link, so which one this is has to be recorded, not inferred.
  whatsapp?: string;
  whatsappType?: 'phone' | 'username';
  status?: CandidateStatus;
  source?: string;
  tags?: string[];
  skills?: string[];
  experience?: number;        // years of experience (Admin-created candidates)
  workHistory?: WorkHistoryEntry[];       // full work history (talent.nearwork.co)
  languages?: string[];                   // other languages besides English
  certifications?: CertificationEntry[];  // certificates & courses

  // ── AI CV parser output ──────────────────────────────────────────────────
  // Classification drives candidate↔opening matching, so these come from a
  // controlled vocabulary (see FUNCTIONS / SENIORITY in cv-ai-extract.ts) and
  // must never be free text, or matching silently stops working.
  education?: EducationEntry[];  // degrees and schooling, distinct from certifications
  tools?: string[];            // named platforms — Salesforce, Klaviyo, Power BI
  industries?: string[];
  function?: string;           // marketing | sales | operations | ...
  subFunction?: string;        // lifecycle_email | paid_performance | ...
  seniority?: string;          // junior | mid | senior | manager | ...
  yearsInFunction?: number;
  cvParse?: {
    parsedAt?: Timestamp | string;
    model?: string;
    schemaVersion?: number;
    lowConfidence?: string[];  // staff review queue — internal, never shown to clients
    rawText?: string;          // lets us re-parse the whole database for ~$2
                               // after a prompt change, instead of re-uploading
  };
  summary?: string;                       // professional summary / bio
  english?: string;           // English level written by jobs.nearwork.co
  englishScore?: EnglishScore; // Nearwork-assessed English level + comments — visible to staff & client
  role?: string;               // target/current job title (written by talent.nearwork.co)
  targetRole?: string;         // alias used by talent.nearwork.co
  headline?: string;           // short headline (alias of targetRole)
  currentRole?: string;
  currentCompany?: string;
  activePipelineCode?: string; // which pipeline this candidate is currently in
  activePipelineStage?: string; // their current stage in that pipeline
  expectedSalary?: number | string; // number (Admin) or formatted string (Jobs)
  expectedSalaryAmount?: number;
  expectedSalaryCurrency?: string;
  availability?: string;      // when they can start — e.g. "Immediately", "2 weeks' notice" (staff-entered)
  timezone?: string;          // candidate's working timezone — e.g. "GMT-5 (EST)" (staff-entered)
  notes?: string;
  rating?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Application ──────────────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'assessment'
  | 'interview_1'
  | 'interview_2'
  | 'interview_3'
  | 'technical'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface Application {
  id: string;
  candidateId: string;
  candidateName?: string;
  candidateEmail?: string;
  openingId?: string;
  openingTitle?: string;
  orgId?: string;
  orgName?: string;
  status: ApplicationStatus;
  stage?: string;
  score?: number;
  assessmentScore?: number;
  interviewNotes?: string;
  offerAmount?: number;
  offerCurrency?: string;
  rejectionReason?: string;
  appliedAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export type PipelineStatus =
  | 'active'
  | 'paused'
  | 'closed'
  | 'filled'
  | 'cancelled';

export type PipelineStage =
  | 'applied'
  | 'background-check'
  | 'interview'
  | 'assessment'
  | 'partner-review'
  | 'partner-interview'
  | 'hired'
  | 'not-selected';

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  'applied': 'Applied',
  'background-check': 'Background Check',
  'interview': 'Interview',
  'assessment': 'Assessment',
  'partner-review': 'Partner Review',
  'partner-interview': 'Partner Interview',
  'hired': 'Hired',
  'not-selected': 'Not Selected',
};

// Why a candidate fell out of a pipeline (structured, paired with a free-text note).
export type DropOffReason =
  | 'mia'
  | 'english'
  | 'assessment'
  | 'interview'
  | 'partner'
  | 'candidate-withdrew'
  | 'other';

export const DROP_OFF_REASON_LABELS: Record<DropOffReason, string> = {
  'mia': 'Went MIA / unresponsive',
  'english': 'English level',
  'assessment': 'Assessment',
  'interview': 'Interview',
  'partner': 'Partner declined',
  'candidate-withdrew': 'Candidate withdrew',
  'other': 'Other',
};

export interface PipelineCandidate {
  candidateId: string;
  candidateCode?: string;        // CAND-XXXXX code (secondary identifier written by jobs.nearwork.co)
  name: string;
  email?: string;
  stage: PipelineStage;
  furthestStage?: PipelineStage; // most advanced stage ever reached (survives a drop to Not Selected)
  dropOffReason?: DropOffReason; // why they fell off (only meaningful when stage = not-selected)
  dropOffNote?: string;          // recruiter free-text context for the drop-off
  score?: number;
  englishScore?: EnglishScore;
  addedAt?: Timestamp | string;
  updatedAt?: Timestamp;
  resubmittedAt?: string;
  notes?: string;
  rating?: number;
  tags?: string[];
  applicationId?: string;
  source?: string;               // where the candidate came from (e.g. 'jobs.nearwork.co')
  cvUrl?: string;                // CV download URL copied from candidate profile
  skills?: string[];             // skills from the application form
  expectedSalary?: string;       // formatted salary expectation string
  // ── Client-facing snapshot (see client-candidate-snapshot.ts) ──────────────
  // Copied from the candidate profile so the App portal can render a candidate's
  // profile (esp. sourcing) without read access to the candidates collection.
  role?: string;                 // target/current job title
  location?: string;             // candidate location label
  phone?: string;                // candidate phone (sourcing — client contacts directly)
  linkedIn?: string;             // candidate LinkedIn (sourcing — same reasoning as phone)
  experience?: number;           // years of experience
  expectedSalaryAmount?: number;
  expectedSalaryCurrency?: string;
  english?: string;              // CEFR level (e.g. 'C1')
  availability?: string;         // staff-entered — when they can start
  timezone?: string;             // staff-entered — candidate working timezone
  workHistory?: WorkHistoryEntry[];   // carries accomplishments through to the client view
  tools?: string[];              // named platforms, shown as its own client-facing section
  education?: EducationEntry[];
  resumeUrl?: string;            // resume/CV URL (alias of cvUrl)
  // true while the applicant is in the pre-screening inbox (Applicants tab).
  // Cleared to false when a recruiter approves them into the Kanban pipeline.
  pendingReview?: boolean;
}

export interface Pipeline {
  id: string;
  code: string;
  orgId: string;
  orgName?: string;
  openingId?: string;
  title: string;
  status: PipelineStatus;
  stage?: string;
  pipelineType?: 'full' | 'sourcing';   // denormalized from the opening; drives the board's stage set
  recruiter?: string;
  accountManager?: string;
  candidates?: PipelineCandidate[];
  kickoffNotes?: string;
  startDate?: string;
  targetDate?: string;
  filledDate?: string;
  placementId?: string;
  totalCandidates?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Assessment ───────────────────────────────────────────────────────────────

export interface AssessmentQuestion {
  id: string;
  text: string;
  category: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  options: string[];
  correctIndex: number;
  explanation?: string;
  tags?: string[];
}

export type DISCStyle = 'D' | 'I' | 'S' | 'C';

export interface Assessment {
  id: string;
  title: string;
  description?: string;
  candidateId?: string;
  candidateName?: string;
  candidateEmail?: string;
  openingId?: string;
  openingTitle?: string;
  orgId?: string;
  orgName?: string;
  uniqueToken?: string;
  expiresAt?: Timestamp;
  questions: AssessmentQuestion[];
  timeLimit?: number;
  passingScore?: number;
  status?: 'pending' | 'in_progress' | 'completed' | 'expired' | 'draft' | 'active' | 'archived';
  technicalScore?: number;
  discStyle?: DISCStyle;
  discScores?: Record<DISCStyle, number>;
  nearworkScore?: number;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
}

export interface CandidateAssessment {
  id: string;
  candidateId: string;
  assessmentId: string;
  pipelineCode?: string;
  answers: Record<string, number>;
  score?: number;
  passed?: boolean;
  completedAt?: Timestamp;
  startedAt?: Timestamp;
}

// ─── Placement / Hired ────────────────────────────────────────────────────────

export interface Placement {
  id: string;
  // Mirrors the candidate's short code/ID. The placement document is keyed by
  // this same value, so /hired/<code> and /candidates/<code> are one person.
  code?: string;
  candidateId: string;
  candidateName?: string;
  candidateEmail?: string;
  orgId: string;
  orgName?: string;
  openingId?: string;
  openingTitle?: string;
  pipelineCode?: string;
  startDate: string;
  endDate?: string;
  salaryAmount: number;
  salaryCurrency?: string;
  salaryFrequency?: 'monthly' | 'biweekly' | 'weekly' | 'hourly';
  engagementType?: EngagementType;
  ncrRate?: number;
  ncrCurrency?: string;
  status?: 'active' | 'ended' | 'on_hold';
  guaranteeDays?: number;
  guaranteeEndDate?: string;
  referralSource?: string;
  referralFee?: number;
  notes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PayrollEntry {
  id: string;
  placementId: string;
  candidateName?: string;
  orgName?: string;
  period: string;
  amount: number;
  currency?: string;
  status?: 'pending' | 'paid' | 'overdue';
  dueDate?: string;
  paidDate?: string;
  notes?: string;
  createdAt?: Timestamp;
}

// ─── Messages / WhatsApp ──────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  phone: string;
  name?: string;
  candidateId?: string;
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  unreadCount?: number;
  status?: 'open' | 'closed';
  tags?: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  mediaUrl?: string;
  mediaType?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  from?: string;
  to?: string;
  createdAt?: Timestamp;
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface CandidateNote {
  id: string;
  candidateId: string;
  pipelineCode?: string;
  body: string;
  authorId?: string;
  authorName?: string;
  authorEmail?: string;
  mentions?: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'mention' | 'assignment' | 'status_change' | 'system';
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt?: Timestamp;
}

// ─── Kickoff Brief ────────────────────────────────────────────────────────────

export type KickoffStatus =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'approved';

export interface KickoffAuditEntry {
  action: string;
  by: string;
  byRole: 'nearwork' | 'client';
  timestamp: string;
  note?: string;
}

export interface KickoffBrief {
  code: string;
  orgId?: string;
  status: KickoffStatus;

  // Role Overview
  roleName?: string;
  department?: string;
  reportsTo?: string;
  directReports?: string;
  location?: string;
  remote?: string;
  startDate?: string;
  contractType?: string;

  // Compensation
  salaryMin?: string;
  salaryMax?: string;
  salaryCurrency?: string;
  salaryNotes?: string;
  benefits?: string[];

  // Role Description
  summary?: string;
  day30?: string[];
  day60?: string[];
  day90?: string[];

  // Requirements
  mustHave?: string[];
  niceToHave?: string[];
  dealBreakers?: string[];
  languageRequirements?: string;
  educationRequirements?: string;
  experienceYears?: string;

  // Team & Culture
  teamSize?: string;
  teamStructure?: string;
  workStyle?: string;
  cultureFit?: string[];
  companyCulture?: string;

  // Interview Process
  interviewStages?: InterviewStage[];
  totalInterviewTime?: string;
  interviewNotes?: string;

  // Tools & Tech
  tools?: string[];
  techStack?: string[];
  methodologies?: string[];

  // Nearwork Assignment
  assignedRecruiter?: string;
  targetSubmissionDate?: string;
  searchStrategy?: string;
  internalNotes?: string;

  // Administrative
  pocName?: string;
  pocEmail?: string;
  pocPhone?: string;
  invoicingContact?: string;
  purchaseOrder?: string;
  additionalNotes?: string;

  // Meta
  history?: KickoffAuditEntry[];
  submittedAt?: string;
  approvedAt?: string;
  lastSavedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InterviewStage {
  name: string;
  type?: string;
  duration?: string;
  interviewer?: string;
  notes?: string;
}

// ─── Salary / FX ─────────────────────────────────────────────────────────────

export interface FXRate {
  date: string;
  rate: number;
  currency: string;
}

export interface NCREntry {
  candidateName?: string;
  candidateId?: string;
  placementId?: string;
  salaryUSD: number;
  ncrCOP: number;
  ncrUSD: number;
  startDate?: string;
}

// ─── Org Invite ───────────────────────────────────────────────────────────────

export interface OrgInvite {
  id: string;
  email: string;
  orgId: string;
  orgName?: string;
  role?: StaffRole;
  invitedBy?: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  token?: string;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

// ─── Contractor / Hired Profile ───────────────────────────────────────────────

// How a hire is engaged commercially
export type EngagementType = 'eor' | 'managed' | 'spp' | 'direct';

export const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  eor: 'EOR',
  managed: 'Managed Team',
  spp: 'Strategic Partner',
  direct: 'Direct Placement',
};

// ─── Engagements module ───────────────────────────────────────────────────────
// A per-deal container under an Organization: legal docs + openings + payments,
// mirroring one HubSpot deal. NOTE: distinct from `EngagementType` above, which is
// a hire's *commercial* model (EOR / Managed / SPP / Direct). Named separately on
// purpose so the two never get conflated.

// Manual stage set — used only for engagements not linked to a HubSpot deal.
// HubSpot-linked engagements reflect their deal's REAL pipeline stage instead.
export type EngagementStage = 'Qualified' | 'Proposal' | 'Contract sent' | 'Closed won' | 'Closed lost';
export const ENG_STAGES: EngagementStage[] = ['Qualified', 'Proposal', 'Contract sent', 'Closed won', 'Closed lost'];

// Real HubSpot stage classification.
export type DealStageType = 'open' | 'won' | 'lost';
export interface DealPipelineStage { label: string; type: DealStageType; current: boolean; }

export type EngagementDocType = 'MSA' | 'Service Quote' | 'SOW' | 'Other';
export const ENG_DOC_TYPES: EngagementDocType[] = ['MSA', 'Service Quote', 'SOW', 'Other'];

export type DealDocStatus = 'Draft' | 'Awaiting signature' | 'Signed';
export type DealPaymentStatus = 'Paid' | 'Pending';

// A HubSpot deal linked into an engagement. An engagement can bundle several,
// and its `value` rolls up the sum of these. Stage reflects the deal's REAL
// HubSpot pipeline stage (won/lost included).
export interface LinkedDeal {
  id: string;                      // HubSpot deal id
  title: string;
  value: number;
  stageLabel: string;              // real HubSpot stage label (e.g. "In Progress", "Closed Lost")
  stageType: DealStageType;        // open | won | lost
  stages?: DealPipelineStage[];    // ordered pipeline stages, for the tracker
  ownerName?: string;
  closeDate?: string;
}

export interface Engagement {
  id: string;
  orgId: string;
  orgName?: string;
  hubspotDealId?: string;          // first linked deal, kept for back-compat
  deals?: LinkedDeal[];            // one engagement can bundle multiple HubSpot deals
  title: string;                   // staff-chosen name, independent of the deal names
  stage: EngagementStage;
  value?: number;                  // rolls up the linked deals when present
  currency?: string;               // 'USD'
  ownerName?: string;
  closeDate?: string;              // manual free-text until HubSpot sync (Phase 2)
  openingCodes?: string[];         // ids into the `openings` collection this deal covers
  createdAt?: Timestamp;
  createdBy?: string;
  updatedAt?: Timestamp;
}

// A signed doc that lives inside an engagement (Service Quote / SOW / Other).
// The MSA is NOT here — it lives at the org level (see OrgDocument).
export interface EngagementDocument {
  id: string;
  engagementId: string;
  orgId: string;                   // denormalized so all of an org's docs load in one query
  type: Exclude<EngagementDocType, 'MSA'>;
  name: string;
  status: DealDocStatus;
  openingCodes?: string[];         // optional tags to specific openings
  url?: string;                    // Firebase Storage download URL
  storagePath?: string;
  size?: string;
  uploadedAt?: Timestamp;
  uploadedBy?: string;
}

// The MSA — one per Organization, linked into every engagement.
export interface OrgDocument {
  id: string;
  orgId: string;
  type: 'MSA';
  name: string;
  status: DealDocStatus;
  url?: string;
  storagePath?: string;
  size?: string;
  uploadedAt?: Timestamp;
  uploadedBy?: string;
}

// Read-only mirror of Stripe / Mercury activity (Phase 3 — empty until wired).
export interface EngagementPayment {
  id: string;
  engagementId: string;
  orgId: string;
  source: 'stripe' | 'mercury';
  description: string;
  amount: number;
  currency?: string;
  status: DealPaymentStatus;
  date?: string;
  externalId?: string;
}

// ─── Sourcing (X-ray) ──────────────────────────────────────────────────────────
// Per-opening LinkedIn X-ray sourcing: pull candidates by country, track them
// through a status pipeline. Ported from the standalone nearwork-xray-sourcing tool.

export type SourceStatus = 'New' | 'Reached out' | 'Interested' | 'Not interested' | 'Applied';
export const SRC_STATUSES: SourceStatus[] = ['New', 'Reached out', 'Interested', 'Not interested', 'Applied'];

export type SourceReason = 'High salary' | 'Doesn’t fit the role' | 'Not in LATAM' | 'No reply' | 'Other';
export const SRC_REASONS: SourceReason[] = ['High salary', 'Doesn’t fit the role', 'Not in LATAM', 'No reply', 'Other'];

// 10 LATAM countries; the first 7 (South America, Spanish-speaking) on by default.
export const SRC_COUNTRIES: { code: string; name: string; on: boolean }[] = [
  // South America
  { code: 'co', name: 'Colombia', on: true }, { code: 'ar', name: 'Argentina', on: true },
  { code: 'pe', name: 'Peru', on: true }, { code: 'cl', name: 'Chile', on: true },
  { code: 've', name: 'Venezuela', on: true }, { code: 'ec', name: 'Ecuador', on: true },
  { code: 'uy', name: 'Uruguay', on: true }, { code: 'br', name: 'Brazil', on: true },
  { code: 'bo', name: 'Bolivia', on: false }, { code: 'py', name: 'Paraguay', on: false },
  // Mexico, Central America and the Caribbean — the other nearshore hubs.
  // Belize is deliberately absent: it isn't one.
  { code: 'mx', name: 'Mexico', on: true }, { code: 'cr', name: 'Costa Rica', on: true },
  { code: 'gt', name: 'Guatemala', on: true }, { code: 'sv', name: 'El Salvador', on: true },
  { code: 'hn', name: 'Honduras', on: true }, { code: 'ni', name: 'Nicaragua', on: true },
  { code: 'pa', name: 'Panama', on: true }, { code: 'do', name: 'Dominican Republic', on: true },
];

export interface SourcedCandidate {
  id: string;
  openingId: string;
  name: string;
  // Their LinkedIn headline. An X-ray only ever sees a result title and one line
  // of snippet, so this is the only evidence of who the person actually is —
  // without it a row is a name and a country and nothing else.
  headline?: string;
  li: string;                // '/in/slug' — the LinkedIn match key
  linkedin: string;          // full profile URL
  location?: string;
  country?: string;
  source: 'X-ray' | 'Manual';
  owner?: string;            // staff owner id, '' = unassigned
  status: SourceStatus;
  reason?: string;           // set only when status = 'Not interested'
  salary?: string;           // formatted '$2,000'
  applied?: boolean;         // auto-set when they apply on the job board
  last?: string;             // relative timestamp label
  notes?: string;
  dupe?: string;             // opening id where this LinkedIn also appears
  refs?: string[];           // search runs that surfaced them, e.g. ['S1','S3']
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * One sourcing run's audit record. Written per search so the team can tell
 * whether a candidate came from before or after a change to the countries,
 * the AI plan, or the include/exclude steering.
 */
export interface SearchRun {
  openingId: string;
  ref: string;               // 'S1', 'S2', …
  at: string;                // ISO timestamp
  mode: 'ai' | 'more';
  countries: string[];       // display names
  domain?: string;           // the AI plan's resolved discipline
  aliases?: string[];        // equivalent titles it searched as
  include?: string[];        // manual must-include keywords
  exclude?: string[];        // manual exclude keywords
  found: number;             // net-new candidates added
  resurfaced?: number;       // already-on-the-board people this run found again
  by?: string;               // staff email
}

export interface SearchPlan {
  openingId: string;
  phrases?: string[];        // AI-written X-ray phrases (cached; reused with no AI cost)
  aliases?: string[];        // real-world equivalent titles the AI read the role as
  domain?: string;           // the role's field (e.g. marketing) every phrase is anchored to
  runs?: number;
  page?: number;             // pagination depth for "find more"
  kept?: number;
  pulled?: string[];         // slugs already pulled for this opening (dedup)
  createdAt?: Timestamp;
  lastRun?: Timestamp;
}

// EOR (Employer of Record) compliance / onboarding lifecycle
export type EORComplianceStatus = 'pending' | 'onboarding' | 'compliant' | 'issue';

export const EOR_COMPLIANCE_LABELS: Record<EORComplianceStatus, string> = {
  pending: 'Pending setup',
  onboarding: 'Onboarding',
  compliant: 'Compliant',
  issue: 'Compliance issue',
};

export interface PerformanceReview {
  id: string;
  period: string; // e.g. "Q1 2026"
  score: number; // 1-5
  feedback?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface ContractorProfile {
  id: string; // usually matches candidateId
  candidateId: string;
  candidateName?: string;
  candidateEmail?: string;
  orgId?: string;
  orgName?: string;
  openingTitle?: string;
  placementId?: string;
  startDate: string;
  endDate?: string;
  salaryAmount: number;
  salaryCurrency?: string;
  salaryFrequency?: 'monthly' | 'biweekly' | 'weekly' | 'hourly';
  engagementType?: EngagementType;
  // PTO
  ptoDaysPerYear?: number;
  ptoUsed?: number;
  // EOR (Employer of Record)
  isEOR?: boolean;
  eorProvider?: string;                   // EOR provider name (e.g. Deel, Remote, Oyster)
  eorBenefits?: string[];                 // benefits provided through the EOR
  eorCountry?: string;                    // country of legal employment
  eorComplianceStatus?: EORComplianceStatus;
  eorMonthlyCost?: number;                // monthly EOR fee (USD)
  eorContractUrl?: string;                // link to the signed EOR contract
  // ROL Score (Retention, Opportunity, Loyalty)
  rolScore?: number; // 0-100
  rolFeedback?: string;
  // Performance
  performanceReviews?: PerformanceReview[];
  // Status
  status?: 'active' | 'ended' | 'on_hold';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Vetting ──────────────────────────────────────────────────────────────────
// The internal record of how we assessed one candidate for one opening. It is
// staff-only and never travels to a client: presenting a candidate is vouching
// for them, so anything that would make a client ask "why are you showing me
// this person?" lives here and stops here.
//
// Distinct from two neighbours it is easy to confuse:
//   • the MATCH score  — CV vs job post, internal, a hypothesis from the weakest
//     evidence we hold (what the candidate wrote about themselves)
//   • the NEARWORK SCORE — assessment · English · DISC alignment, client-facing,
//     built only from evidence we gathered ourselves
// Vetting is the working record that decides whether the second one ever gets
// shown to anybody.

export type Attendance = 'showed' | 'late' | 'no_show';
export type VettingRecommendation = 'present' | 'hold' | 'reject';

export interface InterviewRatings {
  communication?: number;   // 1–5
  depth?: number;           // 1–5, role knowledge
  english?: number;         // 1–5, English as actually spoken — often differs from the test
}

export interface VettingRecord {
  id: string;                     // `${openingId}_${candidateId}`
  openingId: string;
  openingTitle?: string;
  candidateId: string;
  candidateName?: string;

  // Generated when the candidate is moved to Interview — deliberately not on
  // application, or we would pay to prepare for interviews we never hold.
  questions?: string[];
  questionsAt?: string;

  interviewedAt?: string;
  interviewer?: string;
  attendance?: Attendance;
  ratings?: InterviewRatings;

  notesRaw?: string;              // what the interviewer actually wrote
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  recommendation?: VettingRecommendation;
  recommendationReason?: string;

  // The recruiter's own read on fit, replacing the CV-derived score. This is the
  // answer to a good candidate with a badly written CV: once someone has met
  // them, the CV stops being the best evidence available.
  fitOverride?: number;           // 0–100
  fitOverrideReason?: string;

  // AI filled this from pasted notes; a human then corrected it. Once edited,
  // a re-extraction must never overwrite — same rule as the CV parser.
  extractedAt?: string;
  extractedModel?: string;
  editedBy?: string;
  editedAt?: string;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
