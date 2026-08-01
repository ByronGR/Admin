# AI CV Parser — spec

Replaces the paid third-party parser (Affinda) with one Claude call per CV.
Measured on 5 real Nearwork CVs: **~3.3¢ per candidate**, all formats handled.

Branch: `feature/cv-ai-parser`

---

## 1. How it reads a CV

Two inputs are sent together, because each carries something the other loses:

| Input | Gives us | Loses |
|---|---|---|
| The **PDF itself** | Visual layout — pairs each job with its correct dates in two-column CVs | Hyperlink URLs (shows anchor text like "LinkedIn") |
| **Extracted text** | The real URLs behind links | Column order — scrambles two-column CVs |

Sending both fixes both. (Measured: text-only got Karina's work history completely wrong;
PDF-only got the jobs right but returned "LinkedIn" instead of the profile URL.)

`.docx` has no visual layout to lose — text extraction alone is fine there.

## 2. What we extract

See `SCHEMA` in the parse route. Grouped by purpose:

**Matching backbone** — controlled vocabulary, drives candidate↔opening matching.
Must come from a fixed list, never free text, or matching silently fails.
`function`, `subFunction`, `seniority`, `yearsExperience`, `yearsInFunction`,
`skills[]`, `tools[]`, `industries[]`, `countryCode`, `englishClaimed`,
`salaryExpectation`, `availability`

**Display** — human-readable, shown in the apps.
`headline`, `summary`, `workHistory[]` (company, title, dates, location,
`responsibilities[]`, `accomplishments[]`), `education[]`, `certifications[]`,
`languages[]`, `links`

**Internal** — never leaves Admin.
`rawText` (so re-parsing all candidates costs ~$2 instead of a migration),
`parsedAt`, `model`, `schemaVersion`, `lowConfidence[]`

## 3. Hard rules for the extractor

- **Never invent.** Empty string for unknown text, `null` for unknown numbers.
- **Accomplishments ≠ responsibilities.** Accomplishments are quantified outcomes
  ("reduced report prep from 6 hours to 2"); responsibilities are duties. Separate fields.
- **Education ≠ certifications.** A Google/DataCamp certificate is a certification,
  never an institution. (The old parser filed "Google" as a university.)
- **English is self-reported.** Recorded as claimed; the Nearwork assessment stays
  the source of truth. Never present a CV claim as a verified score.
- **`lowConfidence[]`** lists any field the model wasn't sure about → drives a
  staff review queue. In testing it correctly flagged the one profile it got wrong,
  and caught genuine CV oddities (overlapping dates, future dates).

## 4. Where it's stored

`candidates/{id}` — the full profile. Most fields already exist on the `Candidate`
type (`skills`, `experience`, `workHistory`, `languages`, `certifications`,
`summary`, `english`, `headline`, `linkedIn`, `portfolio`).

**To add:** `accomplishments` (per work entry), `function`, `subFunction`,
`seniority`, `tools`, `industries`, `rawText`, `lowConfidence`, parse metadata.

Client-visible subset flows to `pipelines` via `clientCandidateSnapshot()` —
already built. The portal reads only `pipelines`, so anything a client should see
must be added to that snapshot.

## 5. Where it's displayed — all three apps

| Surface | Needs |
|---|---|
| **Talent** (onboarding) | Same page whether the candidate applies to a role or signs up directly. On CV upload the parse runs and **pre-fills the form** — matching today's behaviour, which must not regress. |
| **Admin** (staff) | Full profile incl. internal fields + the `lowConfidence` review queue |
| **App** (client portal) | Display subset. **Accomplishments must be added — the client view has no section for them today.** |

**Empty sections are hidden, never shown empty.** No "Accomplishments — none found".
If a candidate has none, the section does not render.

## 6. Matching (phase 2 — no AI needed)

Because phase 1 normalises everything to fixed vocabularies, matching is plain
database work: fast, free, deterministic.

1. **Hard filter** — `function`/`subFunction` must match the opening's discipline,
   plus seniority band, English level, salary range, availability.
   This is what stops a *marketing* Account Manager role returning *operations*
   Account Managers.
2. **Score the survivors** — coverage of the opening's required skills.

> **Direction matters.** Score **what share of the ROLE's required skills the
> candidate has** — not what share of the candidate's skills match the role.
> A candidate with 50 skills applying to a role needing 8 would score terribly
> under the second definition, which is backwards.

Suggested: `must-have coverage ≥ 75%` to shortlist, weight must-haves above
nice-to-haves, show the matched/missing skills so staff see *why*.

Openings need their required skills extracted into the same vocabulary — same
one-time AI pass, run when an opening is created.

## 7. Cost

| | Per candidate | 140 candidates | What $100 buys |
|---|---|---|---|
| Affinda | ~$0.20–0.30 | ~$28–42 | ~330–500 candidates |
| **This (Sonnet 5)** | **~$0.033** | **~$4.61** | **~3,000 candidates** |
| This, Batch API (backfill) | ~$0.017 | ~$2.30 | ~6,000 candidates |

Skills + tools extraction is **included** in that per-candidate price, not an extra.

## 8. Guardrails

- Staff-only route, daily cap on parses (same pattern as the Sourcing X-ray tool).
- Store `rawText` so prompt improvements re-run over the whole database for ~$2.
- Human approves any candidate-facing outreach; matching only *suggests*.
