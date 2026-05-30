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
  role: StaffRole;
  staffRole: StaffRole;
  photoUrl?: string;
  calendlyLink?: string;
  source?: string;
  status?: 'active' | 'inactive' | 'suspended';
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
  role?: string;
  status?: 'invited' | 'active' | 'inactive';
  invitedAt?: string;
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
  status?: 'active' | 'inactive' | 'prospect';
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
  healthGrade?: AccountHealthGrade;       // current Account Health
  healthUpdatedAt?: string;               // ISO timestamp of last health change
  healthHistory?: HealthHistoryEntry[];   // trend log; a note is required on every change
  actionNeeded?: boolean;                 // surfaced on the main list (pipeline movement, client msg…)
  actionNote?: string;                    // what action is needed
  // ─── People ─────────────────────────────────────────────────────────────────
  pocContacts?: OrgPOC[];                 // client-side decision-makers (one or more)
  accountManager?: string;                // Nearwork AM — owns the relationship (most important)
  salesCloser?: string;                   // Nearwork rep who closed the deal
  teamLead?: string;                      // Nearwork-side lead for this org's managed team
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
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  status: OpeningStatus;
  approvalStatus?: OpeningApprovalStatus;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  targetDate?: string;
  // Team fields
  sourcer?: string;
  recruiter?: string;
  hiringManager?: string;
  accountManager?: string;
  assessmentId?: string;
  questionSettings?: QuestionSettings;
  applicationCount?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

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

export interface Candidate {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  location?: string;
  country?: string;
  city?: string;
  linkedIn?: string;
  portfolio?: string;
  resumeUrl?: string;
  photoUrl?: string;
  status?: CandidateStatus;
  source?: string;
  tags?: string[];
  skills?: string[];
  experience?: number;
  currentRole?: string;
  currentCompany?: string;
  expectedSalary?: number;
  expectedSalaryCurrency?: string;
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

export interface PipelineCandidate {
  candidateId: string;
  name: string;
  email?: string;
  stage: PipelineStage;
  score?: number;
  englishScore?: EnglishScore;
  addedAt?: Timestamp;
  updatedAt?: Timestamp;
  notes?: string;
  rating?: number;
  tags?: string[];
  applicationId?: string;
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
