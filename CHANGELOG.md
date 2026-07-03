# Changelog — Nearwork Admin

All notable changes are documented here, newest first.
Format: `vMAJOR.MINOR.PATCH` — MAJOR = full rebuild / new product; MINOR = new features; PATCH = fixes & tweaks.

---

## [1.5.0] — 2026-07-01

### Added
- **Candidate profile updates in real time** — if another recruiter moves the candidate's stage while you have their profile open, it changes without a refresh (part of the pipeline-emails sprint).
- **Last stage before "Not Selected"** now shown on the profile, with the drop-off reason and note.
- **Change a candidate's stage from their profile** — only when they're in an active opening + active pipeline. A stage dropdown appears on the "Current application" card; picking Not Selected asks for the reason first. Behaves exactly like the board (real-time everywhere + same 5-minute-delayed stage email).
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
