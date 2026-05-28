# Changelog — Nearwork Admin

All notable changes are documented here, newest first.
Format: `vMAJOR.MINOR.PATCH` — MAJOR = full rebuild / new product; MINOR = new features; PATCH = fixes & tweaks.

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
