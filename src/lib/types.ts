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
  | 'sr_recruiter'
  | 'recruiter'
  | 'account_manager'
  | 'hr'
  | 'employee'
  | 'user';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  role: StaffRole;
  staffRole: StaffRole;
  source?: string;
  status?: 'active' | 'inactive';
  orgId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Organization ─────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  industry?: string;
  website?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  address?: string;
  logo?: string;
  status?: 'active' | 'inactive' | 'prospect';
  notes?: string;
  contractStart?: string;
  contractEnd?: string;
  source?: string;
  cacEntries?: CACEntry[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  targetDate?: string;
  hiringManager?: string;
  recruiter?: string;
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
  | 'sourcing'
  | 'screening'
  | 'assessment'
  | 'interview_1'
  | 'interview_2'
  | 'interview_3'
  | 'technical'
  | 'offer'
  | 'hired'
  | 'rejected';

export interface PipelineCandidate {
  candidateId: string;
  name: string;
  email?: string;
  stage: PipelineStage;
  score?: number;
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

export interface Assessment {
  id: string;
  title: string;
  description?: string;
  openingId?: string;
  orgId?: string;
  questions: AssessmentQuestion[];
  timeLimit?: number;
  passingScore?: number;
  status?: 'draft' | 'active' | 'archived';
  createdBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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

// ─── Invite ───────────────────────────────────────────────────────────────────

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
