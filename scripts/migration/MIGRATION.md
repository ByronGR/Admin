# Firebase → Supabase migration

Branch: `feature/supabase-migration`. Nothing here touches `main` or production.

## Two rules that make this safe

**1. Every row keeps its Firebase id.** Each Supabase table gets a
`legacy_id text unique` column holding the original Firestore document id. The
copy script upserts on `legacy_id`, so running it ten times produces the same
rows as running it once. Duplicates are structurally impossible, not just
unlikely.

**2. Every row keeps its original document.** Each table gets a `raw jsonb`
column holding the complete Firestore document, exactly as it was. If a field is
mapped to the wrong column, or a field nobody noticed turns out to matter, the
data is still in `raw` and we fix the mapping with an UPDATE — no re-migration,
no trip back to Firebase. This matters because `candidates` alone has 90 fields
with a lot of historical duplication (`linkedin`/`linkedIn`,
`photoUrl`/`photoURL`, `cv`/`cvUrl`/`activeCvId`, and five different salary
fields).

Firebase is **only ever read**. It is not written to, and nothing is deleted
from it — not during the migration and not after cutover. It stays as the
fallback until Byron says otherwise.

## Order of work

Copy the slow-changing data first and rehearse against it; copy the live,
still-growing data last, in the cutover window. Candidates and applications keep
arriving while Firebase is live, so an early copy of those would just go stale.

| Phase | Data | Why this order |
|---|---|---|
| 1 | organizations, users, openings, pipelines, sourced candidates, kickoff briefs, engagements | Changes rarely, and only by staff. Safe to copy now and test against. |
| 2 | Admin's API routes repointed to Supabase, tested on a preview URL | Real data, real screens, production untouched |
| 3 | **candidates, applications, candidate activity, CVs** | Live and growing — copied last so nothing is missed |
| 4 | Logins (203 accounts, 8 that matter) | Last. Nothing else can lock anyone out. |
| 5 | Stop using Firebase | Project stays, just idle |

## Collection mapping

32 live collections. 1,722 documents. 213 files / 54 MB.

### Already have a home in the `n365` schema

| Firestore | Rows | Supabase | Note |
|---|---|---|---|
| `organizations` | 3 | `public.organizations` | `orgUsers` array expands into `org_members` |
| `users` | 201 | `public.profiles` + `org_members` + `staff` | split by `role`: 193 candidate, 5 client, 3 staff |
| `openings` | 12 | `n365.openings` | |
| `pipelines` | 12 | `n365.pipelines` | `candidates` array expands into `pipeline_candidates` |
| `candidates` | 192 | `n365.candidates` | `source` → `'nearwork'`; 90 fields collapse into columns + `raw` |
| `applications` | 231 | `n365.applications` | |
| `candidateNotes` | 2 | `n365.notes` | |
| `pipeline_messages` | 11 | `n365.messages` | |
| `pipelineRequests` | 2 | `n365.requests` | |
| `notifications` | 17 | `n365.notifications` | |
| `orgInvites` + `org_invites` | 4 + 4 | `n365.invites` | **a rename left both collections behind — dedupe on cutover** |

### Need new tables

| Firestore | Rows | New table |
|---|---|---|
| `sourcedCandidates` | 716 | `n365.sourced_candidates` — staff-only, never visible to a client |
| `candidateActivity` | 123 | `n365.candidate_activity` |
| `kickoffBriefs` | 17 | `n365.kickoff_briefs` |
| `notificationPreferences` | 3 | `n365.notification_prefs` |
| `engagements` | 1 | `n365.engagements` |
| `engagementDocuments` | 1 | `n365.engagement_documents` |
| `organizationDocuments` | 1 | `n365.organization_documents` |
| `deals` | 1 | `n365.deals` — one test row; confirm before building |

### Vera's own data (already on Supabase)

`veraAssessments` (8), `veraBanks` (3), `veraBankJobs` (2) — these belong to
Vera's schema, reached through the existing `n365.vera_assessments` and
`n365.vera_credits` views. No new tables; reconcile against what Vera already
holds.

### Archive only — no table

Counters, queues and rate-limit records with no value once the app that wrote
them is gone. They are in the JSON export and stay there.

`_rateLimits` (77) · `passwordResetTokens` (11) · `veraAiUsage` (34) ·
`stageEmailQueue` (10) · `searchRuns` (9) · `sourcingUsage` (6) ·
`cvParseUsage` (3) · `searchPlans` (2) · `veraAiDaily` (2) · `veraAiMonthly` (1)

### Collections in the code but never created in Firestore

No data to move. Build a table only when the feature is actually wanted:
`contacts`, `crmTasks`, `crmActivities`, `serviceOrders`, `managedTeams`,
`contractors`, `placements`, `assessments`, `staffInvites`, `orgMembers`,
`aiUsage`, `aiUsageMonthly`, `vettingRecords`, `follows`, `engagementPayments`,
`notificationDigestQueue`.

## Storage

| Prefix | Files | Destination |
|---|---|---|
| `cvs/` | 126 | Supabase Storage, private bucket |
| `candidate-cvs/` | 70 | same bucket |
| `candidate-photos/` | 15 | same bucket |
| `engagements/`, `organizations/` | 2 | same bucket |

Every file is already downloaded and MD5-verified under `export/<date>/files/`.

## Apps on this Firebase

| App | Role | Plan |
|---|---|---|
| **Admin** | staff console, 39 collections | migrates |
| **App** | old client portal | retired — N365 replaces it |
| **Jobs** | the API behind the apply form on nearwork.co | **retired** — see below |
| **Talent** | candidate portal and onboarding | migrates; becomes the only front door |
| **Marketing** | nearwork.co; rebuilds the job board from Firestore every 2h | repointed to Supabase |

### One front door for candidates

Jobs and Talent both create accounts, which is why intake is split almost evenly
(candidates: 102 via Jobs / 90 via Talent; applications: 111 / 120). They also
duplicate six endpoints: `auth-handoff`, `confirm-reset`, `intercom-token`,
`parse-cv`, `send-email-proxy`, `send-reset`.

Talent becomes the single portal. It needs the three endpoints Jobs has and it
does not: `submit-application`, `check-application`, `send-confirmation`. The
job board at `nearwork.co/jobs` stays as the public, SEO-indexed listing, but
its Apply button points at Talent instead of its own form. Jobs is then deleted
rather than migrated — which takes the migration from three apps to two.

## Export / backup

```
python3 scripts/migration/export-firebase.py   # all 32 collections -> JSON
python3 scripts/migration/export-storage.py    # all 213 files, MD5-verified
```

Read-only, re-runnable, writes to `scripts/migration/export/<date>/`.
