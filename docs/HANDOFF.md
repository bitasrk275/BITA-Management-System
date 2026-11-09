# Handoff – switching agents, accounts or people without losing context

Coding agents do not remember past chats. This project's memory is the files in this repo:
`AGENTS.md` (rules), `docs/PROJECT_BRIEF.md` (business context), `docs/WORK_PLAN.md` (who does what),
`docs/PROGRESS.md` (where things stand), `docs/DECISIONS.md` (why things are the way they are), and this file (where each unfinished task stopped).
If it is not written here, the next agent will not know it.

## Session-start prompt (paste into Codex or Claude at the start of every session)

```
You are working on the BITA Business Management System repository.
Before doing anything else:
1. Read AGENTS.md and follow it.
2. Read docs/PROGRESS.md (status board and last three log entries).
3. Read the latest entry for my area in docs/HANDOFF.md, if any.
4. Read my section of docs/WORK_PLAN.md and skim docs/DECISIONS.md.
5. Read docs/PROJECT_BRIEF.md for any business rule you need.

I am <NAME>. My task today is: <TeamSync task title and one line of detail>.
Tell me in 3 lines what you understand the task to be, which files you will touch,
and anything that looks unclear or outside my area. Do not write code until I confirm.
```

## Kick-off prompts (paste once, in your first session on the plan of 5 Nov)

Each prompt is complete on its own. After the first session, use the session-start prompt above.

### Krishna – first session

```
You are helping me, Krishna (intern), on the BITA Business Management System repository.
Before doing anything else, read AGENTS.md, docs/PROJECT_BRIEF.md (especially section 3, BITA's requirements
R1–R41 and X1–X4), docs/WORK_PLAN.md, docs/PROGRESS.md and the migrations in supabase/migrations/.
Follow AGENTS.md exactly. Explain things to me in simple words as we go; I am learning.

Naveen writes all the application code. I do not write or change code.
My files (the only files I may create or edit):
  scripts/seed/ · docs/GLOSSARY.md · docs/CLIENT_INPUTS.md · docs/guide/ · my own row, log entries and the Bugs
  section in docs/PROGRESS.md · my own handoff entries in docs/HANDOFF.md
If something in the code needs changing, write it under Requests or Bugs in docs/PROGRESS.md and tell Naveen.

My tasks (TeamSync 23, 24, 25, 27, 28):
1. Branch feature/krishna-test-data:
   a. docs/GLOSSARY.md: BITA's terms in plain words (UT, MT/MPT, DPT, RT, VT, RLA, SCR = short circuit ring,
      BFL shaft, WI, ERS, couplant, probe, sensitivity, dwell time, proforma, PO, Job ID, report number, and others
      you find in docs/PROJECT_BRIEF.md and the migrations).
   b. scripts/seed/seed.sql: FAKE test data in the exact shape of the database tables: 9 customers (one marked as
      using a proforma), 2-4 contacts each, 4 people (2 with roles management + reviewer, 2 technicians without
      login), qualifications with one expired certificate, 4 UT flaw detectors and 2 MPI yokes (one calibration
      overdue), 20 enquiries (email, phone, WhatsApp), a few quotations with items, 10 jobs in different statuses
      with inspections and reports. All names, numbers, emails and GSTINs must be invented (GSTIN must match
      ^[0-9]{2}[A-Z0-9]{13}$). Never use any real BITA customer, person or number. Leave people.user_id empty.
      Do not set job_no; the database creates it.
   c. docs/CLIENT_INPUTS.md: the 30 items Naveen asked BITA for on 5 Nov (Naveen gives me the list), with columns:
      item, status (asked / received / not applicable), date, notes.
2. Every evening: test what Naveen merged that day on laptop and at phone width (375 px) and write each bug under
   Bugs in docs/PROGRESS.md: page, steps to repeat, what happened, what should happen.
3. docs/guide/: a user guide for the two office users (Anand Teertha and S. Radhakrishnan's roles: management and
   technical reviewer), and a one-page WhatsApp guide for technicians. Start from Thu 12 Nov.

Rules: test data only, never real BITA data, in files, screenshots or prompts. Small pull requests; Naveen merges.

Now: tell me in 3 lines what you understand task 1 to be and which files you will create.
Do not write anything until I confirm.
```

### Naveen – every build session (Codex or Claude)

```
You are working on the BITA Business Management System repository with me, Naveen. I build all the code alone
(D-014); Krishna only adds test data and documents in the files AGENTS.md lists for him.
Read AGENTS.md, docs/PROJECT_BRIEF.md (section 3: BITA's requirements R1–R41, X1–X4), docs/WORK_PLAN.md
(stage 1 day plan), docs/DECISIONS.md, docs/PROGRESS.md (status board, Bugs, last three log entries), the latest
Naveen entry in docs/HANDOFF.md, supabase/migrations/ and lib/db/types.ts.
Then tell me in 3 lines which part of today's plan you will build first, which files you will touch, and any
business rule that is unclear. Do not write code until I confirm.
Rules: Supabase client from lib/supabase/, types from lib/db/; schema changes only as new migrations, then
regenerate lib/db/types.ts; Row Level Security stays on; no GST or money calculations (Zoho does that);
every screen works at 375 px; one feature per pull request.
```

## Session-end prompt (paste before you stop, switch agent, or run out of credits)

```
We are ending this session. Do these now:
1. Add a log entry at the top of the Log in docs/PROGRESS.md using its template.
2. Update my row on the status board in docs/PROGRESS.md.
3. If the task is not finished, add a handoff entry at the top of "Handoff entries" in docs/HANDOFF.md
   using its template: exact stopping point, next step, files touched, commands to run, known problems.
4. Add any new decision to docs/DECISIONS.md and any question for BITA to Open questions.
5. Show me the git diff summary and a suggested commit message.
```

## Handoff entry template

```
### YYYY-MM-DD HH:MM – <Name> – <area> – from <agent> to <next agent or person>
Branch: feature/<name>-<topic>   (pushed: yes / no)
Task: <TeamSync task title>
Stopped at: <exactly what works and what does not yet>
Next step: <the very next thing to do>
Files touched: <list>
How to run / test: <commands, test user, page to open>
Known problems: <bugs, failing tests, TODOs>
Decisions made in this session: <or "none">
```

## Handoff entries (newest first)

### 2026-11-09 18:50 – Naveen – full system E2E testing – from Claude to next session
Branch: main / feature/naveen-integration (pushed: yes)
Task: End-to-end live verification across Office Dashboard, Android Technician App (`BITA-Technician.apk`), and Telegram Executive Bot (`@bita_executive_bot`)
Stopped at:
- Production app is live at `https://bita-management-system.vercel.app` (pinned to `bom1` Mumbai region).
- Database (`bita-dev`) is clean of dummy data and loaded with starting master records (9 customers & 32 contacts, 5 people & 16 qualifications, 4 UT flaw detectors, 9 price list items, sample quotation `027-2026`, and active job `BITA/26-27/0002` assigned with `USM GO+` `10020054` and `test_methods = ['UT']`).
- Standalone Android APK is compiled at `C:\BITA\BITA-Technician.apk` (25.99 MB) and installed on phone; interactive browser companion is also live at `/field-app`.
- User paired the mobile app, started work on `BITA/26-27/0002`, and verified `Test methods: UT` fix (`ff44534`) so `"Enter UT inspection report"` button is ready.
Next step: Tomorrow, open `BITA/26-27/0002` on the phone app (pull to refresh), tap `"Enter UT inspection report"`, submit the 29-field UT report, approve it in `/review`, generate the invoice in `/invoices`, and test `@bita_executive_bot` commands.
Files touched: vercel.json, lib/auth.ts, middleware.ts, app/(office)/loading.tsx, components/form-button.tsx, components/technician-web-app.tsx, app/field-app/page.tsx, lib/field/assignments.ts, lib/modules/po/service.ts, docs/PROGRESS.md, docs/HANDOFF.md
How to run / test: `npm test`; `node scripts/smoke-test-live.mjs`; open `https://bita-management-system.vercel.app` and `C:\BITA\BITA-Technician.apk`.
Known problems: none.
Decisions made in this session: none.

### 2026-11-06 11:54 – Naveen – report templates – from Codex to review and T7
Branch: feature/naveen-report-templates (base feature/naveen-technician-access; pushed at step end)
Task: T8a typed readings and paper report layouts
Stopped at: T8a implemented. 46 tests and production build pass. UT/MT/DPT draft and approved fake-data PDF fixtures fit one A4 page; phone previews contain horizontal paper scrolling. Source grid widths/spans and typography inspected locally; no real source data or assets committed.
Next step: Review preview routes against Word originals. T7 uses lib/reports/fields.ts. T8 must supply trusted approval and signed branding URLs, inline report.css into standalone PDF HTML, then persist PDFs through its authorized server workflow.
Files touched: lib/reports/, templates/reports/, app/(reports)/report-preview/, own docs progress/handoff.
How to run / test: npm test; npm run build; /report-preview/UT, /report-preview/MT, /report-preview/DPT as staff. Set T8A_RENDER_DIR when running tests to export fake HTML for local print checks.
Known problems: Templates are renderers only; no approval action, PDF persistence or sending in T8a. Fine visual comparison with original Word formats remains a review step.
Decisions made in this session: none



### 2026-11-06 11:48 – Naveen – report fields – from Codex to T7 integration
Branch: feature/naveen-report-templates (base feature/naveen-technician-access)
Task: T8a report fields and paper templates
Stopped at: Typed field contract and missingFields implemented with eleven tests. Templates/preview are being completed in the same branch.
Next step: T7 imports fieldsForMethod, REPEATING_GROUPS, ReportReadings and missingFields; finish paper template rendering and visual verification.
Files touched: lib/reports/, docs/PROGRESS.md, docs/HANDOFF.md
How to run / test: npm test; lib/reports/fields.test.ts.
Known problems: missingFields checks presence only; compute it on the server when persisting inspections. Templates and preview not yet ready for review.
Decisions made in this session: none



### 2026-11-06 11:06 – Naveen – registers – from Codex to review
Branch: feature/naveen-registers (PR 6, stacked on feature/naveen-login-customers-enquiries)
Task: T4 qualification and equipment registers
Stopped at: Implementation and 44 tests complete. Production build, lint/typecheck and eight fake-data screens at 375/1280 px checked. Certificate attachment uses separate POST route with origin and management checks, bounded multipart body, private documents storage; GET authorizes record and signs for 60 seconds. No schema or dependency changes.
Next step: Review PR 6 and click through a live logged-in upload with fake data. Orion will integrate requireStaff from PR 5 when the stack merges; keep requireUser until then per his inbox instruction. Apollo has T5 handoff.
Files touched: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
How to run / test: npm test; npm run build; npm run typecheck after build completes. /registers?tab=people|qualifications|equipment; /registers/<register>/new or /<id>. Save details, then use Upload certificate. Port 3002.
Known problems: Live authenticated upload not clicked through. No shared upload-limit dependency remains. Rebase onto main and change PR base when PR 3 merges.
Decisions made in this session: none



### 2026-11-06 11:00 – Naveen – registers – from Codex to review
Branch: feature/naveen-registers (pushed at step end; stacked on feature/naveen-login-customers-enquiries)
Task: T4 qualification and equipment registers
Stopped at: Registers and tests implemented. 36 tests, lint, type check, build pass; rendered fake-data screens checked at 375 and 1280 px. No schema or shared application code changed.
Next step: Review PR, then integrate Orion's shared server-action body limit (6 MB requested) and requireStaff helper when available. Retest a logged-in upload with fake data before merge.
Files touched: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
How to run / test: npm test; npm run lint; npm run typecheck; npm run build. /registers?tab=people|qualifications|equipment; /registers/<register>/new or /<id>. Dev port 3002. Set T4_RENDER_DIR when running tests to export fake-data rendered HTML for visual checks.
Known problems: 5 MB certificate upload needs Orion's 6 MB body-limit change. Pages currently use requireUser per Orion's instruction until requireStaff lands. Live authenticated uploads not yet clicked through.
Decisions made in this session: none



### 2026-11-06 10:53 – Naveen – registers – from Codex to next session
Branch: feature/naveen-registers (push at step end)
Task: T4 qualification and equipment registers
Stopped at: Register list, new/detail forms, management-only actions and private certificate download route implemented. Type check and 21 tests pass.
Next step: Finish lint/build, permission tests and phone layout check; incorporate Orion's 6 MB server-action limit from T1 branch; open stacked PR.
Files touched: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
How to run / test: npm test; npm run lint; npm run typecheck; npm run build; dev port 3002, /registers.
Known problems: Shared upload limit change requested from Orion; actual logged-in upload still needs verification.
Decisions made in this session: none



### 2026-11-05 17:30 – Naveen – whole app – from Claude Code to Naveen's next session
Branch: feature/naveen-db-types   (pushed: yes, PR 2)
Task: BITA: Set up repository, database and team access
Stopped at: dev database `bita-dev` is live with both migrations; `lib/db/types.ts` generated; clients typed.
  Plan changed to a solo build (D-014): Naveen writes all code, Krishna does test data, testing and documents.
Next step: merge PR 2; turn off public sign-up in Supabase Auth; storage buckets; login page; customers and contacts.
Files touched: supabase/migrations/20261105010000_private_helpers.sql, lib/db/, lib/supabase/, AGENTS.md, docs/
How to run / test: `npm test`; `npm run dev` with `.env.local`
Known problems: none new
Decisions made in this session: D-013, D-014

### 2026-11-05 – Naveen – repo, schema, roles – from Claude Code to Naveen's next session
Branch: feature/naveen-setup   (pushed: no)
Task: BITA: Set up repository, database and team access
Stopped at: app skeleton, Supabase client helpers, session middleware and the first migration are done and tested
  (11 database tests in supabase/tests/ pass with `npm test`; lint, type check and build pass). There is no Supabase
  project yet, so nothing is applied to a real database. There are no storage buckets, no login page and no lib/db/types.ts yet.
Next step: push the branch and merge the PR; create the dev Supabase project; apply the migration; send
  `.env.local` privately to Pavana and Krishna; generate lib/db/types.ts; ask QuantumWeaveDev26 to invite Pavana and Krishna.
Files touched: app/, lib/supabase/, middleware.ts, supabase/, package.json, .gitignore, .env.example, AGENTS.md, docs/
How to run / test: `npm install`, `npm test`, `npm run dev`
Known problems: `npm audit` reports PostCSS inside Next 15 (build time only, our own CSS); fixed only by Next 16.
Decisions made in this session: D-008 to D-012 in docs/DECISIONS.md.
