// ─── App version ──────────────────────────────────────────────────────────────
// Bump this on every release. Format: MAJOR.MINOR.PATCH
// MAJOR = full rebuild / new product
// MINOR = new feature sprint completed
// PATCH = bug fixes and tweaks

export const APP_VERSION = '1.27.1';

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
    version: '1.24.0',
    date: '2026-07-06',
    sections: [
      {
        title: 'Added',
        items: [
          'Sourcing-only engagement type per opening: we source, screen and submit; the client runs their own interviews and hiring. Pick it when creating a role or switch an existing one from the opening Admin controls.',
          'Sourcing pipeline has its own 6 stages (Sourced, Screening, Submitted, In Progress, Hired, Not Selected) with the assessment/English gates turned off.',
          'On a sourcing role, the candidate gets one email on Submitted ("sent to our partner") and nothing after; the partner moves the candidate (In Progress / Hired / Not Selected) from their portal and Nearwork is notified.',
        ],
      },
    ],
  },
  {
    version: '1.23.0',
    date: '2026-07-06',
    sections: [
      {
        title: 'Added',
        items: [
          'Move an opening to another organization from the Opening Sheet — the ID, public link and all content stay the same, so a role already shared on social media just becomes visible to a different client.',
          'Record an offline brief approval: if the client approved outside the app, mark it approved and publish without waiting on their click. Logged in the brief history as an offline approval.',
          'Organization logos: the client’s logo now shows on the Organizations page, pulled automatically from their website — faster to recognize which client is which. Falls back to initials when no logo is found.',
        ],
      },
    ],
  },
  {
    version: '1.22.0',
    date: '2026-07-06',
    sections: [
      {
        title: 'Added',
        items: [
          'Sign in with Microsoft — use your Nearwork work account instead of a separate Admin password.',
          'Sign-in is pinned to the Nearwork Microsoft directory, so only @nearwork.co work accounts can get in.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Microsoft added as a Firebase Auth provider (not a separate auth system) so Firestore rules keep working off the same uid.',
          'Password sign-in kept behind a link as a temporary fallback; remove once Microsoft is confirmed for everyone.',
        ],
      },
    ],
  },
  {
    version: '1.21.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          "Job-match alerts: per-role toggle (off by default) + live reach count while adding a role's skills.",
        ],
      },
    ],
  },
  {
    version: '1.20.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Job-match alerts: OFF by default + preview matches before sending.',
        ],
      },
    ],
  },
  {
    version: '1.19.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Fire assessment-ready, brief-revised, and new-candidate broadcasts.',
          'Candidate job-match emails: on publish, alert available opted-in candidates who strongly match (4h delay, Colombia business hours).',
        ],
      },
    ],
  },
  {
    version: '1.18.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Staff notification detail popup + read-suppresses digest.',
        ],
      },
    ],
  },
  {
    version: '1.17.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Per-type notification defaults (important types on, common/noisy ones off).',
          'Broadcast declined + new-hire notifications; stage-move wording aligned to the 6 client stages.',
        ],
      },
    ],
  },
  {
    version: '1.16.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Read-in-app suppresses the pending digest email.',
        ],
      },
    ],
  },
  {
    version: '1.15.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Broadcast notifications to followers (stage moves, shared notes).',
        ],
      },
    ],
  },
  {
    version: '1.14.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Notification email digest (batched, 10-min rolling window).',
        ],
      },
    ],
  },
  {
    version: '1.13.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Staff notification preferences (Off / In-app / Email).',
        ],
      },
    ],
  },
  {
    version: '1.12.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Assign the account manager directly from the org edit form.',
        ],
      },
    ],
  },
  {
    version: '1.11.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          "Capture the recruiter's email on openings (for notification routing).",
        ],
      },
    ],
  },
  {
    version: '1.10.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Add /api/notify — unified in-app notification writer.',
        ],
      },
    ],
  },
  {
    version: '1.9.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          "Add /api/remove-member — client admins can revoke a teammate's workspace access (reversible).",
        ],
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-05',
    sections: [
      {
        title: 'Added',
        items: [
          'Client requests (advance / hire / reject / interview) now surface on the candidate for staff to action. When a client raises a request from their portal it appears in a "Client requests" card at the top of the candidate profile, showing the request type, the reason (prominent for rejections), who asked and when. Staff move the candidate with the existing stage controls, then Mark handled or Dismiss the request.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'candidate-detail.tsx subscribes live (onSnapshot) to the shared pipelineRequests collection by candidateId AND candidateCode, merging/deduping by doc id, and shows only status:"pending". Mark handled / Dismiss write { status, handledBy, handledByEmail, handledAt: serverTimestamp() } to the request doc via the client SDK (staff read/update allowed by existing rules).',
        ],
      },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-07-04',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate notes are now shared between Admin and the client portal. When adding a note you choose its visibility: Internal (Nearwork only, the default) or Shared with client. Notes the client writes now show here too, with a badge on every note — Internal, Shared with client, or From client. The client\'s own team-only notes stay private to them and are never shown to staff.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Admin now writes the unified candidateNotes model (candidateId, candidateCode, text+body, scope/visibility, side:"nearwork", author fields, orgId/orgName). Shared notes carry the real orgId (the client portal fetches shared notes by org id); internal notes carry orgId:"" so they never break the client\'s org-scoped query. New staff-only route GET /api/candidate-notes reads via the Admin SDK (bypasses rules), matches by candidateId + candidateCode, and filters out client_internal notes server-side.',
        ],
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-07-04',
    sections: [
      {
        title: 'Added',
        items: [
'Assessment PDF import on the candidate profile (Skills tab). Assessments are kept per role — a candidate can carry a different score for each pipeline they applied to, shown as a list (role · pipeline · score · upload date). Each row has two upload slots (Assessment & English, DISC); the PDF is read on the server and discarded (nothing stored). It extracts the overall score, pass/fail, English CEFR, integrity check, every question with the answer + feedback + score, and the DISC profile, recomputes the Nearwork Score (50% assessment, 30% English, 20% DISC), and updates the candidate’s English level automatically. "View report" opens the same report the client sees — so staff can review it in Admin. Clients only ever see their own role’s result. Grading is always attributed to the Nearwork talent team, never the AI vendor.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'New route POST /api/assessment-upload (staff-only, in-memory parse, no file persistence). Parsers in src/lib/assessment-parser.ts (parseAssessment/parseDisc) are deterministic string parsing tuned to the current Proba template. pdf-parse@1.1.1 added as a serverExternalPackage. The parsed report drives the client-portal candidate detail (client + staff).',
        ],
      },
    ],
  },
  {
    version: '1.5.1',
    date: '2026-07-03',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Adding members to the Team now works. Inviting a staff member was silently failing — the security rule for staff invites was never created, so the app couldn’t save the invite. Super admins can now create invites again, and invited teammates can accept their link to set up their account.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Added a Firestore rule for staffInvites (read: staff; create/delete: super admins). Invite acceptance moved server-side: new routes POST /api/staff-invite/verify and POST /api/staff-invite/accept use the Admin SDK to create the Auth account + users profile with the role taken from the invite (server-authoritative — no client self-assignment), then mark the invite accepted. /join now calls these routes instead of writing to Firestore directly. NOTE: the staffInvites rule must be deployed by hand in the Firebase console.',
        ],
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-07-01',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate profile now updates in real time — if another recruiter moves the candidate’s stage while you have their profile open, you’ll see it change without refreshing.',
          'Candidate profile now shows the last stage a candidate reached before being moved to Not Selected, along with the drop-off reason and note.',
          'You can now change a candidate’s stage directly from their profile — but only when they’re in an active opening and an active pipeline. Moving to Not Selected asks for the reason first. It behaves exactly like the board (updates everywhere in real time, and sends the same stage email after the 5-minute grace window).',
          'Approving an applicant into the pipeline (or adding a candidate straight into a stage) now emails the candidate — previously these paths sent nothing. Entering the “Applied” stage uses the “you’ve moved to the next stage” template.',
          'You can now fully delete a candidate from their own profile (Danger zone) — same complete purge as the list: Firebase account, all collections, and uploaded files; hired/payroll kept.',
          'Pause / Cancel a pipeline from the pipeline view. A paused or cancelled pipeline is frozen — moving a candidate on the board is blocked (an error asks you to contact an Account Manager) and no stage email is sent.',
          'The top search bar now finds candidates by their Nearwork ID (the short code like K7M2PX), not just name/email/role.',
          'Stage-change emails — on for every pipeline: moving a candidate forward — or to Not Selected — sends that stage’s email to the candidate after a 5-minute grace window; moving them again within the window cancels it, so accidental moves never email anyone (that delay is the safety net). The 7 branded stage templates are loaded (Background Check → Not Selected); the “Applied” stage sends nothing because the apply-time email already welcomes them. The rejection email uses a candidate-safe line chosen from the reason you pick when dropping someone; the assessment email links to talent.nearwork.co/assessment.',
          'The apply-time “Application received” email was refreshed to the new branded design.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'New route POST /api/stage-email (staff-only). Uses Resend scheduled_at (+5 min) and cancel-on-move instead of a cron. Eligibility: forward move or rejection; backward moves cancel; same-stage drops are ignored. Queue/audit in stageEmailQueue; kill switch at appSettings/stageEmails.enabled (default off → “simulated” records only). Placeholder templates per stage in /api/stage-email/templates.ts await Byron’s HTML.',
        ],
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-07-01',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Deleting a candidate now fully removes them. Before, delete only removed the candidate record and left their login account (Firebase Auth) and data in other collections behind — which blocked them from signing up again. It now also deletes their login account, users profile, applications, assessments, activity, notifications and notes, their uploaded CV/photo/files in Storage, and removes them from any pipeline. Hired/payroll records are kept as business records.',
          'New Settings → Data cleanup: scan Firebase for orphaned login accounts (leftovers from older deletes) — accounts with a login but no candidate profile — and remove each one with a press-and-hold. Staff and client accounts are never listed. Read-only until you confirm each removal.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'New server route POST /api/delete-candidate (staff-only, Bearer token). Resolves the Auth user by email for Admin-created candidates that have no stored uid; deletes in batches then removes the Auth user last so a partial failure stays retryable. Mirrors the existing Talent self-delete endpoint.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-07-01',
    sections: [
      {
        title: 'Added',
        items: [
          'Mobile-friendly layout (first pass). The app now renders at the phone’s real width instead of a zoomed-out desktop view.',
          'On phones the sidebar collapses into a slide-in menu opened by a ☰ button in the top bar; tapping a link closes it.',
          'Top bar, page titles, dashboard stat cards and two-column sections now stack/shrink to fit small screens; wide tables scroll sideways instead of overlapping.',
          'On mobile the page sits on a light grey canvas so white cards/sections regain clear framing, and the page no longer pans sideways (pinch-to-read) — wide tables scroll within their own card instead.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Added a viewport meta (device-width), a useIsMobile() hook, and a responsive CSS layer (.nw-content / .nw-grid-4 / .nw-grid-2col / .nw-table-scroll / .nw-topbar). Layout/CSS only — no data or behaviour changes.',
        ],
      },
    ],
  },
  {
    version: '1.2.1',
    date: '2026-06-30',
    sections: [
      {
        title: 'Fixed',
        items: [
          'FX & rates page showed “Failed to load FX data”. The live USD/COP rate is fetched from the jsdelivr CDN, which the Content-Security-Policy was blocking. Added cdn.jsdelivr.net to connect-src so the rate and 90-day history load again.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidates (ATS) list is now paginated — Prev/Next controls, a “Showing X–Y of Z” count, and a “Per page” selector (25 / 50 / 100, default 25). Filters, sort, and CSV export still apply across the whole list.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Dashboard “Live activity” now shows candidates applying for roles (e.g. “Maria Lopez applied for Senior CSM”), not just new sign-ups. Account creations and applications are merged into one feed, newest first.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-29',
    sections: [
      {
        title: 'Added',
        items: [
          'Complete Admin redesign — a new design system (NW palette, Poppins, shared primitives) and a full-height shell with a new sidebar, centered global search, and rounded content inset.',
          'Rebuilt every section to the new design: Dashboard, Organizations (list + detail), Pipeline (list + kanban board), Candidates (list + detail), Openings (list + 3-tab detail: Pipeline & sourcing / Kick-off notes / Jobs listing) and the stepped kick-off brief wizard.',
          'Rebuilt Hired into a staffing + HR/EOR hub: placements list plus a 7-tab hire profile (Overview, Compensation, Time off, Reviews, EOR & benefits, Documents, Payments).',
          'New Managed teams module — group a client’s hires into pods with a lead and health, backed by a managedTeams collection.',
          'New SPP (Strategic Partner Program) page listing strategic-partner organizations with program totals (end-clients, hires, open roles, spend).',
          'Rebuilt Team, Profile, Settings and FX & rates to the new design.',
          'Hold-to-delete safety control: every destructive delete now requires a press-and-hold to confirm.',
        ],
      },
    ],
  },
  {
    version: '0.15.2',
    date: '2026-06-26',
    sections: [
      {
        title: 'Removed',
        items: [
          'Candidates are no longer pushed to HubSpot. HubSpot is now used solely for clients. Removed the candidate sync from the New Candidate form and from pipeline stage moves/approvals, along with the candidate sync API route.',
        ],
      },
    ],
  },
  {
    version: '0.15.1',
    date: '2026-06-15',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate directory now shows the profile photo candidates upload from talent.nearwork.co (falls back to initials when none is set).',
        ],
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-06-12',
    sections: [
      {
        title: 'Added',
        items: [
          'Password fields across login, sign-up, and join pages now have a show/hide (eye) toggle.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Salary and rate displays now show a consistent "$ amount CODE" format (e.g. "$1,500 USD" or "$1.500.000 COP") with locale-correct thousands separators, across the kick-off brief, salary rates, candidate profiles, and placements.',
        ],
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-06-11',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate profiles now have an "English assessment" card where staff can directly record a CEFR level (A1–C2) and comments — independent of the pipeline English-score gate. Visible to staff in Admin and to clients on the candidate profile in the client portal.',
        ],
      },
    ],
  },
  {
    version: '0.13.1',
    date: '2026-06-11',
    sections: [
      {
        title: 'Added',
        items: [
          'Openings can now have their salary hidden from jobs.nearwork.co — toggle "Hide salary" while editing an opening to show "Salary on request" on the public listing instead of the $min–$max range.',
        ],
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-06-10',
    sections: [
      {
        title: 'Added',
        items: [
          'Organizations can be flagged "Internal" (e.g. Nearwork\'s own lead-tracking org) — for these orgs, Nearwork staff can approve/request changes on kick-off briefs themselves, since there\'s no separate client to do it.',
        ],
      },
    ],
  },
  {
    version: '0.12.3',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Kick-off page redesigned with an Anchored Rail — a fixed left sidebar shows all 10 sections as numbered circles; the active section is highlighted as you scroll.',
          '"New Opening" now creates a blank draft instantly (no intermediate form) and jumps straight to the kick-off brief.',
          'Opening title and organization can be set inline on the kick-off page header — click the pencil icon to edit. Every save writes the title and org back to the opening and pipeline docs.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Kick-off brief submit error: "this.auth.getUniverseDomain is not a function" — patched ExternalAccountClient to implement getUniverseDomain() so google-gax universe validation passes.',
        ],
      },
    ],
  },
  {
    version: '0.12.2',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          '"New Opening" button now navigates to a full page (/openings/new) instead of opening a popup modal — same fields, better form.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Kick-off brief submit error: "Failed to initialize Google Cloud Firestore client with the available credentials" — fixed by bypassing firebase-admin\'s credential type check and constructing Firestore directly with the Vercel OIDC → GCP WIF credential.',
        ],
      },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-06-02',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Kick-off brief submit now shows a clear error message instead of a cryptic "Unexpected end of JSON" dialog (API route wrapped in top-level error handler).',
          'Deleting an opening now also deletes the linked pipeline and kick-off brief.',
        ],
      },
      {
        title: 'Added',
        items: [
          'Opening detail shows a clickable pipeline row that navigates to the pipeline workspace.',
          'Pipeline workspace has a "View opening" button that navigates to the opening detail.',
        ],
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Each opening now has a unique URL (/openings/NW-XXXXXX) and its Firestore doc ID equals the pipeline code — the same ID is shared across Admin, Jobs, and Talent.',
          'Opening list shows the NW-XXXXXX code in a dedicated column; clicking a row navigates to the opening\'s own page.',
          'New Opening button now shows a minimal form (title + org + recruiter + priority) and goes straight to the kick-off brief after creation.',
        ],
      },
    ],
  },
  {
    version: '0.11.1',
    date: '2026-06-02',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Resolved a deployment failure that blocked new releases from going live — a leftover legacy kick-off API file collided with the current one. The kick-off brief flow is unchanged.',
        ],
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Opening detail now leads with Stage 1 — the Kick-off Brief — showing whether it\'s a draft, sent to the client, has changes requested, or is approved, with a one-click button to open the full brief. The existing opening and publishing flow is now clearly labelled Stage 2.',
        ],
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidates now get a short, readable ID (like K7M2PX) shown on their profile and list — click it to copy. The same ID becomes the candidate\'s page address, so /candidates/<id> is easy to share.',
          'Recording a placement now links it to the candidate: pick the person from a searchable directory instead of re-typing their name, so /hired/<id> and /candidates/<id> are the same person and a candidate can\'t be double-placed.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Recruiter and account-manager fields on openings and pipelines now search your Nearwork team instead of free text — pick the real person from a searchable list so names stay consistent everywhere',
        ],
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-06-02',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Pipeline chat messages now sync reliably both ways between Admin and the client portal — a message stamped without an organization no longer hides the entire conversation on app.nearwork.co',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Added',
        items: [
          'Creating a new opening now takes you straight into its kick-off brief, so you can capture everything from the kick-off call before sourcing begins',
          'Clients can now review, approve, or request changes to the kick-off brief from app.nearwork.co — once they approve, the brief is locked as the agreed source of truth for the search',
          'Kick-off briefs now sync end-to-end: drafts you save in Admin, submissions for client review, client approvals and change requests all flow through a single secure, audited channel (internal-only notes are never shown to the client)',
        ],
      },
    ],
  },
  {
    version: '0.7.4',
    date: '2026-06-01',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Pipeline chat messages sent from Admin now reliably appear on app.nearwork.co, and partner messages now stay visible in their own chat history — older messages are automatically tagged with their organisation when a Nearwork teammate opens the thread, so the partner view no longer goes blank',
        ],
      },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-05-31',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Partners on app.nearwork.co could not send or see pipeline chat messages ("Missing or insufficient permissions") — chat access is now granted by company/organisation membership instead of an exact role match, so any invited partner on the right company can read and reply',
          'Pipeline chat messages now carry the organisation they belong to, keeping each company’s thread private to that company',
        ],
      },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-05-31',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Pipeline chat messages were not appearing after sending — the message thread now loads reliably without depending on a Firestore index, and sorts correctly by time',
          'Chat read errors are now logged to the console instead of being silently hidden, so any future issue is easy to diagnose',
        ],
      },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-05-31',
    sections: [
      {
        title: 'Added',
        items: [
          'Pipeline chat is now a single shared thread with the client portal (app.nearwork.co) — messages you send here appear for the partner, and theirs appear here, with the same redesigned chat (avatars, Nearwork/Partner badges, reactions, @-mentions, /candidate cards)',
          'Partners on the App now see the same polished pipeline chat design that Admin has',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Interview cards posted to chat now carry an explicit internal:false flag so they surface in the partner’s (client-side) message query',
          'Internal notes (internal:true) stay Nearwork-only: the App only ever queries non-internal messages, so Firestore rules can deny client reads on internal notes without them leaving the server',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-05-31',
    sections: [
      {
        title: 'Added',
        items: [
          'Openings now publish to jobs.nearwork.co — every opening gets an “Opening sheet” you fill in (public summary, skills, industry, seniority, work mode, city, benefits), then hit Publish to make it live for candidates (Opening → Jobs bridge)',
          'New opening sheet editor on every opening detail page, with a clear “Live” badge once it’s published',
          'Publish to Jobs button (replaces the old Publish step) is gated until the sheet has a public summary and at least one skill, so we never push an empty listing',
          'When published, the opening shows a “View on Jobs” link straight to the public apply page, plus a one-click Unpublish to pull it back down',
          'Every new opening now gets a shared NW-code at creation — the same ID flows across Admin, the pipeline, the kickoff brief, and Jobs',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Openings created in Admin never appeared on jobs.nearwork.co — Admin only flipped an internal approval flag and never wrote the public listing fields Jobs reads. Publishing now writes published:true plus the full candidate-facing projection',
          'Pausing, filling, or cancelling an opening now automatically removes it from jobs.nearwork.co',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Opening gains code, publicSummary, skills, industry, seniority, workMode, city, benefits, plus the Jobs-schema mirrors (published, publishedAt, currency, wfh, exp, sb-exp)',
          'New WorkMode type + WORK_MODE_LABELS; saveOpening generates the NW code first and stores it on both the opening and its pipeline',
        ],
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-05-31',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Pipeline chat: sending a message could silently do nothing if your staff profile hadn’t finished loading — the composer now falls back to your signed-in account so messages always go through',
          'Pipeline chat now shows the real reason when a message can’t be sent (instead of a generic failure), making permission issues easy to spot',
        ],
      },
      {
        title: 'Technical',
        items: [
          'pipeline-chat send/schedule/react paths use a getIdentity() fallback to auth.currentUser when the users-doc profile is null (e.g. hardcoded super admins) and surface caught Firestore errors',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Pipeline cards redesigned — each candidate card now leads with their Nearwork Score (colour-coded) and English level, and shows the name as first name + last initial (Pipeline rebuild: cards)',
          'Click any pipeline card to jump straight to that candidate’s full profile (/candidates/<id>); a “Brief” button keeps the quick stage/English/drop-off summary one tap away',
          'Pipeline workspace header now shows the Recruiter and Account Manager on the opening',
          'Pipeline workspace header now shows the deal — the Partner (organization) and how many candidates have been placed (Hired count)',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Pipeline page loads Nearwork Scores from the assessments collection keyed by candidateId (highest score per candidate) and threads them down to the board cards',
          'Placements count derived from candidates currently in the Hired stage',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Added',
        items: [
          'Candidate profile now shows the Nearwork Score with 90-day validity — a clear “valid for N days” badge, or “expired — re-assess” once it lapses (Candidate rebuild Sprint 3)',
          'Assessment results on the profile: technical score (x/50 + %), DISC style, completion date, and a link into Assessments',
          'Skills radar — a 5-axis chart (English, Technical, Experience, Communication, Culture) auto-generated from assessment, English-gate and experience data',
          'When a candidate has been placed, their profile shows a “Hired at …” banner that deep-links to their hired/contractor profile (Sprint 4)',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Candidate profile reads assessments + placements by candidateId; Nearwork Score validity computed from completedAt + 90 days',
          'Communication & Culture radar axes are derived from DISC scores (Influence/Steadiness/Conscientiousness) until dedicated scoring exists',
        ],
      },
    ],
  },
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
