# Changelog — Nearwork Admin

All notable changes are documented here, newest first.
Format: `vMAJOR.MINOR.PATCH` — MAJOR = full rebuild / new product; MINOR = new features; PATCH = fixes & tweaks.

---

## [1.26.1] — 2026-07-22

### Changed
- SEO: serve `X-Robots-Tag: noindex, nofollow` on admin.nearwork.co (private app, kept out of search).

## [1.26.0] — 2026-07-20

### Added
- Candidate profiles now flow to the client portal: work history, resume, English, salary, location, availability & timezone are copied onto the pipeline entry when a candidate is added/approved, and kept in sync when edited. Powers the sourcing candidate view in the App (assessment/DISC stay Nearwork-only).

---

## [1.25.0] — 2026-07-20

### Added
- Candidate profile: staff can now enter **Availability** and **Timezone** inline in Quick facts (click to add/edit). These feed the sourcing client view.

---

## [1.20.0] — 2026-07-05

### Added
- Job-match alerts: OFF by default + preview matches before sending.

---

## [1.15.0] — 2026-07-05

### Added
- Broadcast notifications to followers (stage moves, shared notes).

---

## [1.12.0] — 2026-07-05

### Added
- Assign the account manager directly from the org edit form.

---

## [1.10.0] — 2026-07-05

### Added
- Add `/api/notify` — unified in-app notification writer.

---

## [1.9.0] — 2026-07-05

### Added
- Add `/api/remove-member` — client admins can revoke a teammate's workspace access (reversible).

---

## [1.8.0] — 2026-07-05

### Added
- **Client requests (advance / hire / reject / interview) now surface on the candidate for staff to action.** When a client raises a request from their portal it appears in a **Client requests** card at the top of the candidate profile, showing the request type, the reason (prominent for rejections), and who asked and when. Staff move the candidate with the **existing stage controls**, then **Mark handled** or **Dismiss** the request — marking handled does not itself move the candidate.

### Technical
- `candidate-detail.tsx` subscribes live (`onSnapshot`) to the shared `pipelineRequests` collection by **both** `candidateId` and `candidateCode`, merging/deduping by doc id, and shows only `status:"pending"`. **Mark handled** / **Dismiss** write `{ status, handledBy, handledByEmail, handledAt: serverTimestamp() }` to the request doc via the client SDK (staff read/update is already allowed by the Firestore rules). No new server route.

---

## [1.7.0] — 2026-07-04

### Added
- **Candidate notes are now shared between Admin and the client portal.** When you add a note you pick its visibility — **Internal** (Nearwork only, the default) or **Shared with client**. Notes the client writes now appear here too, and every note carries a badge: **Internal**, **Shared with client**, or **From client**. The client's own team-only notes stay private to them and are never shown to Nearwork staff.

### Technical
- Admin now writes the unified `candidateNotes` model (`candidateId`, `candidateCode`, `text`+`body`, `scope`/`visibility`, `side:"nearwork"`, `author`/`authorName`/`authorEmail`, `orgId`/`orgName`). **Shared** notes carry the real `orgId` (the client portal fetches shared notes by org id); **internal** notes carry `orgId:""` so they don't break the client's org-scoped query. New staff-only route `GET /api/candidate-notes` reads via the Admin SDK (bypasses rules), matches by both `candidateId` and `candidateCode`, and filters out `client_internal` notes server-side so they never leave the server.

---

## [1.6.0] — 2026-07-04

### Added
- **Assessment PDF import** on the candidate profile (Skills tab). Two upload slots — **Assessment & English** (the Proba report) and **DISC**. The PDF is parsed **on the server, in memory, then discarded** (nothing is stored). It extracts the overall score, pass/fail, English CEFR level, integrity check, and **every question with the candidate's answer, the feedback, and the score**, plus the DISC profile — and recomputes the **Nearwork Score** (50% assessment · 30% English · 20% DISC). The parsed report then shows on the candidate detail in **both Admin and the client portal**. Grading is always credited to the **Nearwork talent team**, never the AI vendor.

### Technical
- New route `POST /api/assessment-upload` (staff-only; in-memory parse; no file persistence). Deterministic parsers in `src/lib/assessment-parser.ts` tuned to the current Proba template. `pdf-parse@1.1.1` added as a `serverExternalPackage`. If the vendor's PDF template changes, the parser needs a small update.

---

## [1.5.1] — 2026-07-03

### Fixed
- **Adding members to the Team now works.** Inviting a staff member was silently failing ("Failed to create invite") because the Firestore security rule for `staffInvites` was never created — so the database blocked the write. Super admins can now create invites again, and invited teammates can accept their `/join` link to set up their account end-to-end.

### Technical
- Added a Firestore rule for `staffInvites` (read: staff; create/delete: super admins). **Must be deployed by hand in the Firebase console** (per repo convention).
- Invite acceptance moved server-side: new routes `POST /api/staff-invite/verify` and `POST /api/staff-invite/accept` use the Admin SDK to create the Auth account + `users/{uid}` profile with the role taken from the invite (server-authoritative — the invitee can't self-assign a role), then mark the invite `accepted`. `/join` now calls these routes instead of writing to Firestore directly, so invite tokens/emails are never exposed to unauthenticated clients.

---

## [1.5.0] — 2026-07-01

### Added
- **Candidate profile updates in real time** — if another recruiter moves the candidate's stage while you have their profile open, it changes without a refresh (part of the pipeline-emails sprint).
- **Last stage before "Not Selected"** now shown on the profile, with the drop-off reason and note.
- **Change a candidate's stage from their profile** — only when they're in an active opening + active pipeline. A stage dropdown appears on the "Current application" card; picking Not Selected asks for the reason first. Behaves exactly like the board (real-time everywhere + same 5-minute-delayed stage email).
- **Entering the pipeline now emails the candidate.** Approving an applicant from the applicant list into the pipeline (Applied), or adding a candidate straight into a stage, now sends the stage email (Applied uses the "you've moved to the next stage" template) — previously these paths sent nothing.
- **Delete a candidate from their profile** — a "Danger zone" on the profile does the same full purge as the list (Firebase account + all collections + uploaded files; hired/payroll kept), with press-and-hold.
- **Pause / Cancel a pipeline** from the pipeline view (with a status badge). A **paused or cancelled pipeline is frozen** — you can't move candidates on the board (an error tells you to contact an Account Manager) and no stage email is sent. Resume/Reopen restores it.
- **Global search now matches the Nearwork candidate ID** (the short code like `K7M2PX`), not just name/email/role.
- **Stage-change emails** — on for every pipeline. Moving a candidate forward — or to Not Selected — sends that stage's email to the candidate after a **5-minute grace window**; moving them again within the window cancels it, so accidental moves never email anyone (this delay is the safety net). Backward (corrective) moves send nothing. The **7 branded stage templates** are loaded (Background Check → Not Selected); "Applied" sends nothing (the apply-time email already welcomes them). Rejection email uses a candidate-safe line chosen from the drop-off reason; assessment email links to talent.nearwork.co/assessment.
- Apply-time **"Application received" email refreshed** to the new branded design.

### Technical
- New route `POST /api/stage-email` (staff-only): Resend `scheduled_at` (+5 min) + cancel-on-move instead of a cron; queue/audit records in `stageEmailQueue`; placeholder per-stage templates in `/api/stage-email/templates.ts` awaiting the final HTML.

---

## [1.4.0] — 2026-07-01

### Fixed
- **Deleting a candidate now fully removes them.** Previously delete only removed the candidate record, leaving their login account (Firebase Auth) and data in other collections behind — which blocked them from ever signing up again. It now also deletes their login account, `users` profile, applications, assessments, activity, notifications and notes, their **uploaded CV/photo/files in Storage**, and strips them from any pipeline. Hired/payroll records are kept as business records. (Matches the Talent self-delete, which already did a full purge.)

- **New Settings → Data cleanup.** Scan Firebase for **orphaned login accounts** — accounts with a login but no candidate profile, i.e. leftovers from older deletes that never removed the Auth account (or abandoned sign-ups). Staff and client accounts are never listed. Read-only until you press-and-hold to remove a specific account.

### Technical
- New server route `/api/delete-candidate` (staff-only, Bearer token). `POST` fully purges a candidate/orphan by candidateId/email/uid; `GET` returns the read-only orphan audit (cross-checks Firebase Auth users against `candidates`/`users`). Resolves the Auth user by email for Admin-created candidates that store no uid; batch-deletes Firestore docs then removes the Auth user last so a partial failure stays retryable.

---

## [1.3.0] — 2026-07-01

### Added
- **Mobile-friendly layout (first pass).** The app now renders at the phone's real width instead of a zoomed-out desktop view. On phones the sidebar collapses into a slide-in menu opened by a ☰ button; the top bar, page titles, dashboard stat cards and two-column sections stack/shrink to fit, and the Candidates table scrolls sideways instead of overlapping.

### Technical
- Added a viewport meta (device-width), a `useIsMobile()` hook, and a responsive CSS layer (`.nw-content` / `.nw-grid-4` / `.nw-grid-2col` / `.nw-table-scroll` / `.nw-topbar`). Layout/CSS only — no data or behaviour changes.

---

## [1.2.1] — 2026-06-30

### Fixed
- FX & rates page showed "Failed to load FX data". The live USD/COP rate is fetched from the jsdelivr CDN, which the Content-Security-Policy was blocking; added `cdn.jsdelivr.net` to `connect-src` (both enforced and report-only) so the rate and 90-day history load again.

---

## [1.2.0] — 2026-06-30

### Added
- Candidates (ATS) list is now **paginated**, with Prev/Next controls, a "Showing X–Y of Z" count, and a **"Per page" selector (25 / 50 / 100, default 25)**. Tabs, filters, sort, and CSV export continue to apply across the entire list.

---

## [1.1.0] — 2026-06-30

### Added
- Dashboard "Live activity" feed now also surfaces candidates **applying for roles** (e.g. "Maria Lopez applied for Senior CSM"), merged with new account sign-ups into a single newest-first feed.

---

## [1.0.0] — 2026-06-29

### Added
- Complete Admin redesign: new design system (NW palette, Poppins, shared primitives) and full-height shell (new sidebar, centered global search, rounded content inset).
- Every section rebuilt to the new design — Dashboard, Organizations, Pipeline (list + kanban), Candidates, Openings (3-tab detail) + kick-off wizard, Hired (staffing + 7-tab HR/EOR profile), Managed teams, SPP, Team, Profile, Settings, FX & rates.
- Hold-to-delete safety control on every destructive delete.

> Note: the in-app changelog (Settings → changelog) is the maintained source of truth; this file resumes at the 1.0.0 milestone.

---

## [0.1.3] — 2026-05-28

### Added
- Delete for organizations, openings, pipelines, and assessment records (inline confirm, no modal)
- Auto-create linked pipeline every time a new opening is saved — pipeline code shown in success toast

### Fixed
- FX calculator was always empty — root cause: Frankfurter API does not include COP (Colombian Peso). Switched to @fawazahmed0/currency-api CDN (free, no key, full COP history)
- 90-day history chart now fetches ~10 sampled dates in parallel

---

## [0.1.2] — 2026-05-28

### Fixed
- 404 on page refresh — added `cleanUrls: true` to vercel.json so /dashboard serves dashboard.html
- `routes-manifest.json` not found on Vercel — switched `framework` from `"nextjs"` to `null` in vercel.json; app is now served as a plain static site from `out/`

---

## [0.1.1] — 2026-05-28

### Fixed
- Firestore `orderBy('createdAt')` silently excludes documents without that field — removed from all 5 collection queries (openings, candidates, assessments, placements, dashboard) and replaced with client-side `sortByTimestamp()`
- Dashboard users query was filtered by `source == 'admin.nearwork.co'`, hiding staff added before that field existed — removed filter
- Added `sortByTimestamp<T>()` helper to utils.ts (handles Firestore Timestamps, ISO strings, epoch numbers, missing fields)

---

## [0.1.0] — 2026-05-27

### Added
- Complete Next.js 16 + TypeScript + Tailwind CSS v4 rebuild from single-page HTML admin
- Firebase Authentication — restricted to @nearwork.co domain
- Dashboard with live Firestore stats and report builder
- Organizations — create, list, detail, edit, delete
- Openings — create, list, detail (with org linking), edit, delete
- Pipeline — real-time kanban board with drag-and-drop (7 stages), candidate management, status updates
- Candidates — list, search, filter
- Assessments — results table + question bank management
- Hired / Placements — list and create placements
- Salary Rates — USD/COP FX calculator with NCR billing formula and 90-day sparkline chart
- Kickoff brief — 10-section form with auto-save and audit trail
- Login page with password reset

### Technical
- `output: 'export'` static export — zero Next.js serverless functions (stays within Vercel Hobby 12-function limit)
- Vercel `cleanUrls: true` + `framework: null` for correct static routing
- TypeScript strict mode — zero `tsc --noEmit` errors
- 12 Vercel serverless functions in `/api/` preserved untouched from v1

---

_Previous v1 was a monolithic HTML file (admin.nearwork.co/dashboard.html). This changelog tracks v0.1.0 onwards._
