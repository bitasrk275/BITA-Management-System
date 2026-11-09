# Progress – where the project stands

Everyone reads the status board and the last three log entries at the start of every session.
Everyone adds a log entry at the end of every session (newest at the top of the log).

## Status board

| Area | Owner | Status | Branch / PR | Notes |
| --- | --- | --- | --- | --- |
| Repo, schema, roles, security | Naveen | In review | feature/naveen-p1-foundation | Phase 2 Foundation (P1): modules + /api/v1, soft delete + recycle bin, settings & settings_options tables, docs/ARCHITECTURE.md |
| Email intake + AI extraction | Naveen | Not started | | |
| Customer and enquiry screens | Naveen | In review | feature/naveen-login-customers-enquiries | Login, customers with contacts, enquiries with customer link |
| Jobs, quotations, POs, scheduling | Naveen | In review | feature/naveen-p2-customer-po | Phase 2 P2: Customer PO on quotation accept (PO number, date, value, file + 1-click job creation), jobs.po_value, PO link & over-PO invoice warning |
| Technician field form | Naveen | Done | feature/naveen-retire-field-web | Web routes retired for Android APK (D-016); /technician notice; Expo app in apps/technician |
| Report templates + approval + PDF | Naveen | In review | feature/naveen-report-templates | T8a fields/templates/staff preview ready; T8 review/approval/PDF persistence is separate |
| AI report drafting | Naveen | Not started | | |
| Zoho Books integration | Naveen | Not started | | Needs Zoho admin access |
| Payments, reminders, job closure | Naveen | In review | feature/naveen-p4c-credit-notes-tds | Phase 2 P4c: Credit notes (`BITA/YY-YY/CN-0001`) linked to issued tax invoices + TDS deducted on payments (`payments.tds_amount`) settling invoice balance |
| Dashboard | Naveen | Not started | | |
| WhatsApp intake + technician messages (R3, X1) | Naveen | Not started | | Needs BITA's WhatsApp Business number |
| Financial reports from Zoho (X4) | Naveen | In review | feature/naveen-gst-export | T36 CA GST export (GSTR-1 B2B & B2C CSV + Excel XML workbook at /invoices/export) |
| Submission checks + correction history view (X2, X3) | Naveen | Not started | | Database side done in setup PR |
| Qualification + equipment registers (R19–R20, R29–R31) | Naveen | In review | PR 6, feature/naveen-registers | Registers and private certificate copies built; 44 tests, build, lint/typecheck and 375 px fixture checks pass |
| Glossary | Krishna | Not started | | |
| Test data | Krishna | Not started | | |
| Client inputs tracker | Krishna | Not started | | See `docs/CLIENT_INPUTS.md` |
| Excel import | Naveen | Not started | | Needs BITA lists |
| Smoke tests | Naveen | In review | feature/naveen-field-db-tests | T42 Field API PGlite tests (tests/field-api.test.ts); T40 e2e flow |
| User guide | Krishna | Not started | | |

Status values: Not started · In progress · In review · Done · Blocked

## Bugs (Krishna adds after each evening's testing; Naveen fixes)

| Date | Page | Steps to repeat | What happened | What should happen | Status |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Requests (someone needs something from another area)

| Date | From | To | Request | Status |
| --- | --- | --- | --- | --- |
| | | | | |

## Open questions (for BITA, asked only by Naveen)

| Date | Asked by | Question | Answer |
| --- | --- | --- | --- |
| 2026-11-05 | Naveen | One email to BITA with 30 items: mailbox and Zoho access, WhatsApp number, separate user emails, technician mobiles, customer billing addresses and codes, report and quotation number rules, Job ID format, other report types, field datasheets, MPI yokes, past jobs and quotations, hosting account, test job and training date | Due Sat 7 Nov |

## Blockers

| Date | Who | Blocked on | Since |
| --- | --- | --- | --- |
| 2026-11-05 | Naveen | Mailbox access (email intake), Zoho Books access (BITA's migration not finished), WhatsApp Business number (R3, X1) | 2026-11-05 |

## Log

### Template (copy this for each entry)

```
### YYYY-MM-DD HH:MM – <Name> – <agent used: Codex / Claude Code / Claude>
Task: <TeamSync task title>
Done: <what was finished, in plain words>
Files changed: <main files or folders>
Next: <the next concrete step>
Blockers / questions: <or "none">
```

### 2026-11-09 10:43 – Naveen – Claude
Task: P4c Credit notes (`BITA/YY-YY/CN-0001`) + TDS deducted on payments (`payments.tds_amount`)
Done: Added migration `supabase/migrations/20261107061000_credit_notes_and_tds.sql` adding `tds_amount` on `public.payments` and creating `public.credit_notes` with RLS, `private.next_credit_note_no()` (`BITA/YY-YY/CN-0001` honoring `next_credit_note_no` in `public.settings`), `private.before_credit_note_write()`, `private.sync_invoice_credit_notes()`, and updated `private.before_invoice_write()` / `private.check_payment_write()` so both `(amount + tds_amount)` and issued `credit_notes.total` reduce `invoices.balance`. Added `recordInvoicePayment`, `createCreditNoteForInvoice`, and `cancelCreditNoteById` in `lib/modules/invoices/service.ts` and `/api/v1/invoices/[id]/{payments,credit-notes}`. Updated `/invoices/[id]` with TDS field on payment recording, TDS breakdown in payment history, and Credit Notes creation/cancellation UI.
Files changed: supabase/migrations/20261107061000_credit_notes_and_tds.sql, lib/db/types.ts, lib/modules/invoices/, app/api/v1/invoices/[id]/, app/(office)/invoices/, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Merge P4c and PR #20 (A3 Calendar) into `feature/naveen-integration`, apply migrations to `bita-dev`, deploy Phase 2 to `main` (Vercel), and proceed to P4d.
Blockers / questions: none.

### 2026-11-07 18:19 – Naveen – Claude
Task: P4b Proforma vs Tax invoice choice, proforma series (`BITA/YY-YY/PI-0001`), Convert to tax invoice, and tax numbering from `invoice_numbering` setting
Done: Added migration `supabase/migrations/20261107050000_proforma_and_tax_numbering.sql` adding `converted_from_id` on `public.invoices`, updating `private.next_invoice_no(p_kind)` to assign `BITA/YY-YY/PI-0001` for proforma invoices and `BITA/YY-YY/INV-0001` for tax invoices while honoring `next_tax_invoice_no` / `next_proforma_no` from `public.settings` (`key = 'invoice_numbering'`), and updating `private.check_invoice_report()` so converting a proforma to a tax invoice links the same approved reports cleanly. Added `convertProformaToTaxInvoice` in `lib/modules/invoices/service.ts` and `POST /api/v1/invoices/[id]/convert-to-tax`. Updated `/invoices`, `/review`, `/review/[reportId]`, and `/invoices/[id]` so the office can choose **Tax invoice** or **Proforma**, filter proforma invoices, and click **Convert to tax invoice**.
Files changed: supabase/migrations/20261107050000_proforma_and_tax_numbering.sql, lib/db/types.ts, lib/modules/invoices/, app/api/v1/invoices/[id]/convert-to-tax/route.ts, app/(office)/invoices/, app/(office)/review/, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Open PR for P4b, merge into `feature/naveen-integration`, and proceed to P4c (Credit notes + TDS on payments).
Blockers / questions: none.

### 2026-11-07 18:03 – Naveen – Claude
Task: P4a `Invoice pending` report status + several reports on one invoice (same GSTIN)
Done: Added migration `supabase/migrations/20261107040000_invoice_reports_multi.sql` creating `public.invoice_reports (invoice_id, report_id)` with RLS, `private.check_invoice_report()` trigger (enforcing approved status, same customer GSTIN, and one active invoice per report), and `private.sync_invoice_report_link()` trigger. Built `lib/modules/invoices/` (`schema.ts`, `service.ts`, `invoices-module.test.ts`) and `/api/v1/invoices` + `/api/v1/invoices/pending-reports`. Updated `/review`, `/review/[reportId]`, `/dashboard`, `/invoices`, and `/invoices/[id]` so approved reports not yet on any non-cancelled invoice display `Invoice pending`, the dashboard shows an **Invoices pending** counter, and the office can tick one or several `Invoice pending` reports of the same customer GSTIN to combine them onto one invoice (combining all distinct PO numbers).
Files changed: supabase/migrations/20261107040000_invoice_reports_multi.sql, lib/db/types.ts, lib/modules/invoices/, app/api/v1/invoices/, app/(office)/review/page.tsx, app/(office)/review/[reportId]/page.tsx, app/(office)/dashboard/page.tsx, app/(office)/invoices/page.tsx, app/(office)/invoices/[id]/page.tsx, app/(office)/invoices/actions.ts, app/(office)/invoices/db.ts, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Open PR for P4a, merge into `feature/naveen-integration`, and proceed to P4b (Proforma or Tax choice + proforma series + convert to tax invoice).
Blockers / questions: none.

### 2026-11-07 17:32 – Naveen – Claude
Task: P3 Price list module (`price_items`, `/price-list`, `/api/v1/price-items`) + invoice line price-list dropdown
Done: Added migration `supabase/migrations/20261107030000_price_items.sql` creating `public.price_items` with RLS (hidden from technicians), soft delete, recycle bin restoration, audit logging, and default BITA NDT services (`UT service`, `MT service`, `DPT service`, `Conveyance`, `Hardness testing`, `Visual inspection`). Built `lib/modules/price-items/` (`schema.ts`, `service.ts`, `price-items.test.ts`), `/api/v1/price-items` (`GET`, `POST`, `PATCH`, `DELETE`, `restore`), and `/price-list` UI page (`app/(office)/price-list/`). Updated `InvoiceDraftEditor` and `app/(office)/invoices/` so invoice lines are chosen from the price list dropdown (with inline `+ Add new item` and editable rates per invoice) instead of pulling rates from the quotation.
Files changed: supabase/migrations/20261107030000_price_items.sql, lib/db/types.ts, lib/modules/price-items/, lib/modules/recycle-bin/service.ts, app/api/v1/price-items/, app/(office)/price-list/, app/(office)/recycle-bin/page.tsx, app/(office)/invoices/, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Cross-review/merge open PRs into `feature/naveen-integration` and start P4a (Invoice pending report status + several reports on one invoice).
Blockers / questions: none.

### 2026-11-07 17:20 – Naveen – Antigravity
Task: A1 Technician edits after submit + office report photo selection (Phase 2)
Done: Replaced 409 lock on submitted field inspections with approval-based locking: technicians can edit and resubmit from the phone until technical reviewer approves the report. Every resubmission logs diff and old/new readings to `inspection_edits` and `audit_log`, and notifies the office via the dashboard "Report edits" attention item and dedicated diff view list. Added `include_in_report` boolean flag to `attachments` with migration `20261107000000_report_edits_and_photos.sql` and RLS; added photo inclusion review controls in `/review/[reportId]` so office can select/unselect which photos and drawings appear in the final report; updated Word (.docx) and PDF report generators to include only chosen photos. Updated Expo app `ReportScreen` to keep submitted reports editable until reviewer approval with clear status banners, and lock read-only upon approval. Verified unlinking phones remains accessible via register actions. 257 tests green, ESLint clean, tsc clean, and production build clean.
Files changed: supabase/migrations/20261107000000_report_edits_and_photos.sql, lib/db/types.ts, lib/field/assignments.ts, lib/field/field.test.ts, lib/reports/docx.ts, lib/reports/review.ts, templates/reports/types.ts, app/(office)/dashboard/page.tsx, app/(office)/review/[reportId]/page.tsx, app/(office)/review/actions.ts, app/(office)/review/[reportId]/docx/route.ts, app/(office)/review/[reportId]/pdf/route.ts, apps/technician/src/screens/ReportScreen.tsx, apps/technician/src/types.ts, tests/field-api.test.ts, docs/PROGRESS.md
Next: Open PR on bitasrk275/BITA-Management-System with base feature/naveen-integration.
Blockers / questions: none.
### 2026-11-07 17:20 – Naveen – Claude
Task: P2 Customer PO on quotation accept + jobs.po_value + PO link & warning on invoices
Done: Added migration `supabase/migrations/20261107020000_customer_po_value.sql` (`po_value numeric(14,2) check (po_value is null or po_value >= 0)` on `public.jobs`) and updated `lib/db/types.ts` and `app/(office)/invoices/db.ts`. Built `lib/modules/po/` (`schema.ts`, `service.ts`, `po.test.ts`) and `/api/v1/quotations/[id]/accept` and `/api/v1/jobs/[id]/po`. Updated `/quotations/[id]` so "Accepted by customer" allows recording PO number, PO date, PO value, PO file, and creating the linked job in one step (while keeping PO optional so work can start before the PO arrives). Updated `/jobs/[id]`, `JobForm`, `/invoices/[id]`, and `InvoiceDraftEditor` to display `po_value`, prefill the job PO on invoices (editable), and warn whenever invoices against one PO total more than its value.
Files changed: supabase/migrations/20261107020000_customer_po_value.sql, lib/db/types.ts, lib/modules/po/, app/api/v1/quotations/[id]/accept/route.ts, app/api/v1/jobs/[id]/po/route.ts, app/(office)/quotations/, app/(office)/jobs/, app/(office)/invoices/, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Merge P1 & P2 into `feature/naveen-integration` and start P3 (Price list module).
Blockers / questions: none.

### 2026-11-07 17:06 – Naveen – Claude
Task: P1 Phase 2 Foundation: modules + /api/v1, soft delete + recycle bin, settings tables
Done: Added `docs/ARCHITECTURE.md` defining the modular, API-first pattern (`lib/modules/<module>/` + `app/api/v1/<module>/`) with `customers` as the worked example (`lib/modules/customers/`, `app/api/v1/customers/`, and refactored `app/(office)/customers/`). Added migration `supabase/migrations/20261107010000_phase2_foundation.sql` with `settings` and `settings_options` tables, `private.has_permission(perm)` and `private.can_delete()`, soft-delete columns (`deleted_at`, `deleted_by`) and `private.soft_delete()` trigger across `customers`, `enquiries`, `quotations`, `jobs`, `people`, and `equipment`, RLS policies hiding soft-deleted rows from normal SELECTs, audit triggers on all lists, and RPC helpers (`soft_delete_record`, `restore_record`, `list_recycle_bin`). Added `/recycle-bin` and `/settings` pages plus `/api/v1/recycle-bin` and `/api/v1/settings`, updated `lib/db/types.ts`, and added unit + PGlite tests (`lib/modules/customers/customers.test.ts`, `supabase/tests/phase2-foundation.test.ts`).
Files changed: supabase/migrations/20261107010000_phase2_foundation.sql, lib/db/types.ts, lib/api/v1.ts, lib/modules/customers/, lib/modules/recycle-bin/, lib/modules/settings/, app/api/v1/, app/(office)/customers/, app/(office)/recycle-bin/, app/(office)/settings/, docs/ARCHITECTURE.md, supabase/tests/phase2-foundation.test.ts, docs/PROGRESS.md
Next: Merge P1 into `feature/naveen-integration` and start P2 (Customer PO on accept + po_value + PO warning).
Blockers / questions: none.
### 2026-11-07 16:37 – Naveen – Claude
Task: T41 Deployment readiness for either host (.env.example, lib/env.ts, docs/DEPLOY.md, .github/workflows/reminders.yml)
Done: Updated `.env.example` with every environment variable read across the codebase (names only, one-line comments, marking `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` required, plus `REMINDERS_CRON_SECRET` and `EXPO_PUBLIC_API_URL`). Added `lib/env.ts` and unit tests (`lib/env.test.ts`) for server-side required variable checks and wired them into `lib/field/service.ts`, `app/api/reminders/plan/route.ts`, and `lib/ai/extract-enquiry.ts`. Added `docs/DEPLOY.md` covering Netlify Free, Vercel Hobby (noting non-commercial terms), Supabase production checklist, daily payment reminders via n8n or free cron, and building the technician APK against the live URL. Added `.github/workflows/reminders.yml` (`workflow_dispatch` by default with commented daily cron).
Files changed: .env.example, lib/env.ts, lib/env.test.ts, lib/field/service.ts, app/api/reminders/plan/route.ts, lib/ai/extract-enquiry.ts, docs/DEPLOY.md, .github/workflows/reminders.yml, docs/PROGRESS.md
Next: Merge PR into `feature/naveen-integration`.
Blockers / questions: none.

### 2026-11-07 16:45 – Naveen – Antigravity
Task: T42 Field API tests against real database rules (PGlite) and RLS
Done: Added tests/field-api.test.ts running against real PostgreSQL (PGlite) via createTestDb(). Tested production field API operations against real database constraints and schema without mocks: 1) pairing code generation, redemption, single-use enforcement, double-redeem failure, and expiry check; 2) authenticateDevice secret check, 401 on wrong secret, 401 on revoked device; 3) technician assignment isolation (technician A cannot acknowledge, start, report, or upload photo on technician B's assignment -> 404); 4) inspection report draft vs. completion, mandatory fields validation, automatic transition of job to inspection_done, assignment completed_at timestamp, 409 conflict on re-submitting already completed report, valid photo attachment and rejection of photos > 6 MB; 5) technician delay messages and validation; 6) RLS enforcement verifying authenticated staff role cannot insert into pairing_codes directly (RLS refusal) while service role succeeds and staff can read per 77cdf95. Verified apps/technician with Expo SDK 58 (typecheck clean). Full test suite (27 test files, 252 tests), lint, typecheck, and next build pass cleanly.
Files changed: tests/field-api.test.ts, docs/PROGRESS.md
Next: Open PR on bitasrk275/BITA-Management-System with base feature/naveen-integration.
Blockers / questions: none.

### 2026-11-07 13:45 – Naveen – Antigravity
Task: T39 Remove leftover Zoho / WhatsApp wording (D-017) and 375 px mobile audit across office screens
Done: Cleaned leftover Zoho Books references and WhatsApp copy per D-017 while retaining enquiry intake source 'whatsapp' and database mirror columns. Audited all office screens at 375 px phone width (dashboard, office, enquiries, quotations, jobs, technician assignment, technical report review & history, in-app invoices, GSTR-1 export, registers, customer details, and users/logins). Fixed overflow, text wrapping, and tap target issues strictly without visual redesign (added break-words/break-all for emails, addresses and audit diffs, flex-wrap on header and row action containers, w-full on file inputs, and stacked metric grid on narrow viewports). 244 tests green, ESLint clean, tsc clean, and production build clean.
Files changed: app/(office)/dashboard/page.tsx, app/(office)/jobs/labels.ts, app/(office)/invoices/db.ts, app/(office)/registers/register-form.tsx, app/(office)/enquiries/[id]/page.tsx, app/(office)/quotations/page.tsx, app/(office)/quotations/[id]/page.tsx, app/(office)/jobs/[id]/page.tsx, app/(office)/jobs/[id]/assign/page.tsx, app/(office)/review/page.tsx, app/(office)/review/[reportId]/page.tsx, app/(office)/review/[reportId]/history/page.tsx, app/(office)/invoices/page.tsx, app/(office)/invoices/[id]/page.tsx, app/(office)/invoices/[id]/invoice-draft-editor.tsx, app/(office)/customers/[id]/page.tsx, app/(office)/settings/users/page.tsx, docs/PROGRESS.md
Next: Open PR on bitasrk275/BITA-Management-System with base feature/naveen-integration.
Blockers / questions: none.

### 2026-11-07 13:34 – Naveen – Claude
Task: T40 End-to-end PGlite flow test plus demo in-app invoices
Done: Added shared PGlite test harness (`supabase/tests/setup.ts`) and full end-to-end lifecycle test (`tests/e2e-flow.test.ts`) covering one fake job from customer enquiry -> uploaded quotation & items -> management approval & acceptance -> job creation -> qualification/equipment registers & technician assignment -> service-role device pairing -> field inspection submission (with mandatory reading guard) -> report drafting -> reviewer approval & freeze -> in-app GST invoice generation & issue (`BITA/YY-YY/INV-xxxx`) -> partial & full payments -> job closure, asserting status and role-based refusals at each step. Updated `supabase/seed/demo.sql` with idempotent in-app tax invoices (`draft`, `issued`, `partly_paid`, `paid`), lines, and payments.
Files changed: supabase/tests/setup.ts, supabase/tests/schema.test.ts, tests/e2e-flow.test.ts, supabase/seed/demo.sql, docs/PROGRESS.md
Next: Merge PR into `feature/naveen-integration`.
Blockers / questions: none.
### 2026-11-07 11:18 – Naveen – Antigravity
Task: T38 Retire technician web screens (APK only, D-016) + apps/technician fixes & README
Done: Removed technician-only web routes (app/(field)/my-jobs and all subroutes) and retired technician menu in app-shell. Updated lib/roles.ts (homeFor sends technicians to /technician) and lib/auth.ts (requireStaff redirects technicians to /technician). Added /technician notice page directing technicians to the Android APK and office pairing code. Added lib/roles.test.ts. In apps/technician: fixed 3 lint warnings (unused Alert in PairScreen, unused err in ReportScreen), added HTTP 409 handling and read-only mode for already submitted reports, enabled viewing submitted reports from job details, updated README with EAS free-tier APK build steps and what BITA must provide (Expo account, Firebase project under BITA's Google account). cd apps/technician && npm run typecheck passes cleanly.
Files changed: app/(field)/, lib/roles.ts, lib/roles.test.ts, lib/auth.ts, components/app-shell.tsx, apps/technician/, docs/FIELD_APP.md, docs/PROGRESS.md
Next: Open PR on bitasrk275/BITA-Management-System with base feature/naveen-integration.
Blockers / questions: none.

### 2026-11-07 11:25 – Naveen – Claude
Task: T37 Email-only payment reminders on in-app invoices + n8n workflow export
Done: Adapted payment reminder planning (`lib/reminders/` and `/api/reminders/plan`) to in-app tax invoices (`kind = 'tax_invoice'`, `status in ('issued', 'partly_paid')`, `balance > 0`, `reminders_paused = false`, `due_date` set), added email-only subject/body composition (`buildReminderEmailContent`) and `PATCH /api/reminders/plan` to mark `sent_at`, surfaced email reminder history on `/invoices/[id]`, and added the importable n8n workflow export (`n8n/payment-reminders-email.json` + `n8n/README.md`) with zero WhatsApp nodes.
Files changed: lib/reminders/schedule.ts, lib/reminders/sender.ts, lib/reminders/plan.ts, lib/reminders/reminders.test.ts, app/api/reminders/plan/route.ts, app/api/reminders/plan/route.test.ts, app/(office)/invoices/db.ts, app/(office)/invoices/[id]/page.tsx, n8n/payment-reminders-email.json, n8n/README.md, docs/PROGRESS.md
Next: Import `n8n/payment-reminders-email.json` into n8n once BITA's SMTP credentials arrive.
Blockers / questions: none.

### 2026-11-07 11:12 – Naveen – Claude
Task: T36 CA GST export (GSTR-1 B2B & B2C)
Done: Built single-source GSTR-1 export module (lib/invoices/gst-export.ts + unit tests) separating B2B (with Customer GSTIN) and B2C (without Customer GSTIN) rows from issued, partly_paid and paid tax invoices, listing cancelled invoices with zero amounts and excluding drafts. Added /invoices/export screen with month & date-range pickers, live B2B/B2C tables, and /invoices/export/download route for combined CSV, B2B CSV, B2C CSV and multi-sheet Excel (.xls) workbook.
Files changed: lib/invoices/gst-export.ts, lib/invoices/gst-export.test.ts, lib/invoices/index.ts, app/(office)/invoices/export/, app/(office)/invoices/page.tsx, docs/PROGRESS.md
Next: T37 email-only payment reminders on in-app invoices and n8n workflow export.
Blockers / questions: none.
### 2026-11-06 18:38 – Naveen – Claude
Task: T35 Generate Invoice inside the app (no Zoho, Decision D-017)
Done: Built in-app GST invoicing migration (20261106040000_invoices_in_app.sql with invoice_counters, reshaped invoices, invoice_lines, payments, line/tax consistency on Issue, due_date from customer payment_terms_days, freezing after Issue, and overpayment protection), pure invoicing library (lib/invoices/ for 18% intra/inter-state GST, exact paise rounding & whole-rupee round-off, Indian amount in words, quotation+report line builder with minimum charge, and single PDF/Word .docx invoice template), and /invoices screens + routes (/invoices, /invoices/[id], /invoices/[id]/pdf, /invoices/[id]/docx, plus Generate invoice on approved reports and jobs). All 184 tests, lint, type check and production build pass.
Files changed: supabase/migrations/20261106040000_invoices_in_app.sql, supabase/tests/schema.test.ts, lib/invoices/, app/(office)/invoices/, app/(office)/review/[reportId]/page.tsx, app/(office)/jobs/[id]/page.tsx, docs/PROGRESS.md
Next: Merge PR into feature/naveen-integration; plug in BITA's exact SAC code, bank details and terms into DEFAULT_BITA_INVOICE_PROFILE when reference invoices arrive.
Blockers / questions: none.

### 2026-11-06 11:54 – Naveen – Codex
Task: T8a typed report fields and UT/MT/DPT paper templates
Done: Typed field validation and React paper layouts preserve the source table grids, merged cells and section order. A4 print CSS, draft-only staff previews, and signature/seal rendering gated on trusted approval. All 46 tests, production build, lint/type validation pass. Six fake-data draft/approved PDFs each fit one A4 page; previews checked at 375 px with contained paper scrolling.
Files changed: lib/reports/, templates/reports/, app/(reports)/report-preview/, docs/PROGRESS.md, docs/HANDOFF.md
Next: Compare staff previews with the original Word documents; T7 imports the pushed field contract. T8 adds approval workflow/PDF persistence separately.
Blockers / questions: Source Word files and real assets are not committed. Fine visual comparison with originals remains a reviewer check; A4 was explicitly confirmed.

### 2026-11-06 11:48 – Naveen – Codex
Task: T8a report field definitions and paper layouts
Done: Added typed UT/MPT/DPT readings, MT alias, shared fields and repeated technician/item groups. missingFields returns stable scalar/dotted paths for inspections.missing_fields and validates every row. Eleven field tests pass. Orion approved the contract; pushing it early for T7.
Files changed: lib/reports/fields.ts, lib/reports/fields.test.ts, docs/PROGRESS.md, docs/HANDOFF.md
Next: Finish source-format paper templates, approval-gated signature slots, staff-only fake-data preview and A4 print checks.
Blockers / questions: none for the field contract.

### 2026-11-06 11:06 – Naveen – Codex
Task: T4 qualification and equipment registers, PR 6
Done: Certificate uploads now use a separate management-only route with origin checks and a bounded 5 MB multipart body, so they do not depend on the shared server-action limit. Save details first, then attach a certificate; previous copies remain linked if upload fails. All 44 tests and production build pass; eight fake-data screens checked at 375/1280 px without overflow.
Files changed: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
Next: Review PR 6. Apollo owns T5 and has the register handoff. Orion will switch register reads to requireStaff when the technician-access stack merges; current requireUser retained at his request.
Blockers / questions: No upload configuration dependency remains. Live authenticated certificate upload still needs click-through with fake data.

### 2026-11-06 11:00 – Naveen – Codex
Task: T4 qualification and equipment registers
Done: Verified management-only saves, RLS-denied updates, certificate directory isolation and partial-upload errors. All 36 tests, lint, type check and production build pass. Six fake-data register lists/forms checked in Chromium at 375 px and 1280 px with no overflow; screenshots inspected. Removed outdated technician job-link wording.
Files changed: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
Next: Review stacked PR; integrate Orion's shared upload limit and staff-only access helpers before the technician-login rollout. Live authenticated certificate upload still needs a click-through.
Blockers / questions: Shared next.config.ts upload limit remains 1 MB until Orion raises it; 5 MB files need the requested 6 MB body limit. No shared application files, schema or dependencies changed.

### 2026-11-06 10:53 – Naveen – Codex
Task: T4 qualification and equipment registers
Done: Added searchable people, qualification and equipment registers; management-only save actions; private certificate uploads and authorized downloads; database qualification expiry flags and India-date calibration warnings. Type check and all 21 tests pass. No shared code, schema or dependencies changed.
Files changed: app/(office)/registers/, docs/PROGRESS.md, docs/HANDOFF.md
Next: Finish permission and phone-layout verification, then open a PR based on the login/customers/enquiries branch.
Blockers / questions: Orion asked to raise the shared server-action body limit to 6 MB for 5 MB certificate uploads.

### 2026-11-05 18:30 – Naveen – Claude Code
Task: BITA: Customer and enquiry screens
Done: Storage buckets (documents, branding, reports; staff only, signatures by management only), applied to bita-dev. Login page, office layout with menu, customers (list with search, new, edit, contacts with "receives reports/invoices"), enquiries (list with filters, manual entry for phone/WhatsApp/email, link to customer with automatic suggestion by sender email or mobile, status). 13 database tests pass; lint, type check and build pass; login page checked at 375 px.
Files changed: supabase/migrations/20261106000000_storage.sql, app/(auth)/, app/(office)/, components/ui.tsx, lib/auth.ts, lib/forms.ts
Next: quotations (letterhead PDF, past rates, approval), jobs and PO.
Blockers / questions: logged-in screens not yet clicked through; needs the first login user in bita-dev.

### 2026-11-05 17:00 – Naveen – Claude Code
Task: BITA: Set up repository, database and team access
Done: Dev Supabase project `bita-dev` created; both migrations applied; security advisor clean (one info note: job_counters has no policies, on purpose). `lib/db/types.ts` generated and the Supabase clients are typed. `.env.local` ready to share privately.
Files changed: supabase/migrations/20261105010000_private_helpers.sql, lib/db/types.ts, lib/supabase/, supabase/tests/, docs/
Next: storage buckets, login page, `lib/field/`; load Krishna's test data when it lands.
Blockers / questions: none new.

### 2026-11-05 – Naveen – Claude Code
Task: BITA: Set up repository, database and team access
Done: BITA's requirements (R1–R41, X1–X4) and files received; full scope agreed (D-008). Next.js app skeleton, Supabase client helpers, first database schema with roles, Row Level Security, Job ID numbering, report approval and readings checks, one-GST-invoice-per-job rule and correction log. 11 database tests pass (npm test). `.gitignore` keeps client files out of git.
Files changed: app/, lib/supabase/, middleware.ts, supabase/, package.json, .gitignore, .env.example, docs/
Next: create the Supabase project and apply the migration; storage buckets; login page; give Pavana and Krishna repo access.
Blockers / questions: mailbox, Zoho and WhatsApp access from BITA (asked 5 Nov, due 7 Nov).

### 2026-11-02 – Naveen – Claude
Task: Project kick-off
Done: Reviewed BITA's requirements and company profile; client roadmap deck and "Information and Documents Required" PDF prepared and sent to BITA; TeamSync project created with tasks for Naveen, Pavana and Krishna; team pack written (AGENTS.md, CLAUDE.md, docs/).
Files changed: AGENTS.md, CLAUDE.md, docs/
Next: Tue 3 Nov – repo setup, schema, access for team; team starts on their Day 1 tasks.
Blockers / questions: Waiting for BITA's priority inputs (due Tue 3 Nov).
