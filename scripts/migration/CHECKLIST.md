# Admin on Supabase — test checklist

Preview: the latest deployment of `feature/supabase-migration` in the Vercel
"admin" project. Sign in with your normal Nearwork account.

**This preview reads and writes Supabase. `admin.nearwork.co` still reads and
writes Firebase.** They are separate. Anything created in the preview will not
appear in production, and vice versa — that is the point, not a fault.

## Reading

- [ ] **Openings** — 12 openings, under Completed. Titles, companies, codes right?
- [ ] **Organizations** — Nearwork, Fresh Prints, Capital Human Management
- [ ] **Candidates** — 192, names, roles, emails
- [ ] **Pipeline** — pipelines open, candidates inside them
- [ ] **Dashboard** — counts look sane
- [ ] **Hired / Teams / Users / Assessments** — open without error
- [ ] **Search (⌘K)** — type a candidate name, a company name, an opening code
- [ ] **A candidate's detail page** — CV link, history, applications
- [ ] **An opening's detail page** — description, salary, pipeline

## Writing

- [ ] **Create an opening** — New opening, fill the kickoff brief, save
- [ ] **Edit it** — change the title, reload, confirm it stuck
- [ ] **Change its status** — and confirm the other fields did not change
- [ ] **Create an organization**
- [ ] **Add a note to a candidate**
- [ ] **Move a candidate** in a pipeline
- [ ] **Delete the test opening** when finished

## Things that are meant to behave differently

| | Why |
|---|---|
| **Deals, Contacts, Tasks, SPP** still read Firebase | One test row between them. Converting the most tangled code in the app to move no data is effort spent badly. |
| **Sourcing tab** still reads Firebase | It is a live subscription that also writes back. |
| **Candidate list does not update live** in this preview | Nothing is listening — there is one read instead. Production keeps the live listener. |
| **Logins are still Firebase** | The login migration is the last step, deliberately: nothing else can lock anyone out. |
| **Notifications are empty** | They point at user accounts, so they move with the logins. |

## If something looks wrong

Open the browser console (⌥⌘I) and read the red line. Every failed load and
save now reports why rather than showing an empty screen.

## What is not migrated yet

- Logins — 3 staff, 5 client, 193 candidate accounts
- Notifications (17)
- The Jobs and Talent apps, which also write to Firebase
