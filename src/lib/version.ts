// ─── App version ──────────────────────────────────────────────────────────────
// Bump this on every release. Format: MAJOR.MINOR.PATCH
// MAJOR = full rebuild / new product
// MINOR = new feature sprint completed
// PATCH = bug fixes and tweaks

export const APP_VERSION = '0.4.0';

// ─── Changelog data ───────────────────────────────────────────────────────────
// Add new releases at the TOP. Never delete old entries.

interface ChangelogSection {
  title: 'Added' | 'Fixed' | 'Removed' | 'Technical';
  items: string[];
}

interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.4.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate profile now shows every pipeline & opening the candidate is in — current stage, furthest stage reached, and pipeline status, sorted with active pipelines first (Candidate rebuild Sprint 2)',
          'Drop-off reasons: when a candidate is moved to Not Selected on the board, you now pick why (MIA, English, Assessment, Interview, Partner declined, Withdrew, Other) plus an optional recruiter note',
          'That drop-off reason and note surface on the candidate profile (“Fell off · …”) and in the pipeline candidate brief',
          'Each pipeline on the candidate profile is a one-click deep link straight into that pipeline’s board (/pipeline?focus=<code>)',
        ],
      },
      {
        title: 'Technical',
        items: [
          'PipelineCandidate gains furthestStage, dropOffReason, and dropOffNote; the board tracks the furthest stage automatically on every move',
          'New DropOffReason type + DROP_OFF_REASON_LABELS for consistent labelling',
        ],
      },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-05-30',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Dashboard metric cards (active organizations, active openings, candidates in ATS, hires) showed 0 when any one data source failed to load — each source is now loaded independently so a single hiccup no longer blanks the whole dashboard',
        ],
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-05-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Team members now show their job title (CEO, Account Manager, …) instead of their access level — set or change it from the member profile',
          'Job title flows everywhere: it’s what appears next to a person’s name in @-mention pickers (candidate notes and pipeline chat)',
          'Member profile now has a separate “Access level” control (super admins only) so permissions stay independent from the displayed job title',
        ],
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-05-30',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Team page now shows everyone, including the super admins (Byron & Stephany) even before they’ve logged into Admin — they’re always listed',
          'Team page no longer mixes in client/partner accounts — it shows Nearwork staff only',
        ],
      },
      {
        title: 'Added',
        items: [
          'Click any team member to open their profile — photo, role, email (one-click Reach out), Calendly link, status, and join date',
          '@-mention pickers now show each person’s role next to their name (candidate notes and pipeline chat)',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate profiles now have their own shareable URL (/candidates/<id>) — open or share a direct link to any candidate (Candidate rebuild Sprint 1)',
          'Candidate profile shows photo (or initials), email, phone, location, LinkedIn, skills, joined date, CV view/download, and a WhatsApp action (enabled once Twilio goes live)',
          'Real @-mentions in candidate notes — type @ to pick from Nearwork team members; mentioned users are recorded on the note',
          'Pipeline chat @-mentions now include the client/partner users of that pipeline’s organization (clearly labelled Partner vs Nearwork), not just Nearwork staff',
        ],
      },
      {
        title: 'Technical',
        items: [
          'New /candidates/[id] route mirrors the /hired/[id] deep-link pattern (useParams + getDoc)',
          'Shared CandidateDetail component; candidate list now navigates by route instead of inline state',
          'Mention autocomplete distinguishes Nearwork staff (@nearwork.co) from partner users (matched by orgId)',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-28',
    sections: [
      {
        title: 'Added',
        items: [
          'Invite-only access — Super Admins generate a magic link; only invited @nearwork.co addresses can create accounts (/join page)',
          'Team page (/users) — list all staff, invite new members, change roles, suspend accounts',
          'Profile page (/profile) — edit name, upload photo, set Calendly link, reset password',
          'Global search in nav bar — searches candidates, organizations, openings, and pipelines in real time',
          'Pipeline redesigned to 8 stages: Applied, Background Check, Interview, Assessment, Partner Review, Partner Interview, Hired, Not Selected',
          'English score gate — moving a candidate past Interview requires entering CEFR level (A1–C2) + written feedback; visible on card and candidate brief',
          'Assessment rebuild — 50 hardcoded technical questions (6 categories) + 25 DISC behavioral questions; unique link per candidate; 24-hour expiry; send from admin',
          'Opening team fields — Sourcer, Recruiter, Hiring Manager, Account Manager (optional) on every opening',
          'Organization redesign — removed phone/email/notes from create form; added Package, Contract Type, HubSpot link, and client user invite emails',
          'Org detail now shows client users panel and pipeline list side by side',
          'Settings page enhanced — Calendly link field, notification toggles, invite-only access note',
        ],
      },
      {
        title: 'Technical',
        items: [
          'StaffRole type unified across types.ts and firebase.ts; old sr_recruiter/account_manager mapped to recruiter/sales',
          'STAFF_ROLE_LABELS constant exported from types.ts for consistent display names',
          'question-bank.ts: 75 hardcoded questions with correctIndex and DISC style mappings',
          'scoreDISC() helper: tallies D/I/S/C answers and returns dominant style + full scores',
        ],
      },
    ],
  },
  {
    version: '0.1.3',
    date: '2026-05-28',
    sections: [
      {
        title: 'Added',
        items: [
          'Delete for organizations, openings, pipelines, and assessment records — inline confirm on every item, no extra modal',
          'Auto-create linked pipeline when a new opening is saved — pipeline code shown in success toast',
          'Settings page at /settings with version display and Calendly placeholder',
          'Changelog page at /changelog — internal only, requires login',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'FX calculator always empty — Frankfurter API does not include COP. Switched to @fawazahmed0/currency-api CDN (free, no key, full COP + 90-day history)',
        ],
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-05-28',
    sections: [
      {
        title: 'Fixed',
        items: [
          '404 on page refresh — added cleanUrls: true to vercel.json so /dashboard correctly serves dashboard.html',
          'routes-manifest.json not found on Vercel — switched framework from "nextjs" to null; app served as plain static site from out/',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-05-28',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Firestore orderBy silently excluded documents without a createdAt field — removed from all 5 collection queries and replaced with client-side sortByTimestamp()',
          'Dashboard users query filtered by source == admin.nearwork.co, hiding staff created before that field existed — filter removed',
          'Added sortByTimestamp<T>() utility (handles Firestore Timestamps, ISO strings, epoch numbers, and missing fields gracefully)',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-27',
    sections: [
      {
        title: 'Added',
        items: [
          'Full Next.js 16 + TypeScript + Tailwind CSS v4 rebuild from single-page HTML admin',
          'Firebase Authentication restricted to @nearwork.co domain',
          'Dashboard with live Firestore stats and report builder',
          'Organizations — create, list, detail, edit, delete',
          'Openings — create, list, detail (with org linking), edit, delete',
          'Pipeline — real-time kanban board with drag-and-drop (7 stages)',
          'Candidates — list, search, filter',
          'Assessments — results table and question bank',
          'Hired / Placements page',
          'Salary Rates — USD/COP FX calculator with NCR formula and 90-day sparkline',
          'Kickoff brief — 10-section form with auto-save and audit trail',
          'Login page with forgot-password flow',
        ],
      },
      {
        title: 'Technical',
        items: [
          'output: export — zero Next.js serverless functions; stays within Vercel Hobby 12-function limit',
          '12 existing /api/ serverless functions preserved untouched',
          'TypeScript strict mode with zero tsc --noEmit errors',
        ],
      },
    ],
  },
];
