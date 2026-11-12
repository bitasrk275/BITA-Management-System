# UAT Environment Setup Guide (`bita-uat`)

Because `bita-dev` now serves as BITA's live production database (holding real customer records and the real tax-invoice sequence starting at `5388`), BITA staff must run their acceptance testing ([UAT_GUIDE.md](./UAT_GUIDE.md)) on a separate, isolated UAT environment (`bita-uat`).

This guide walks through spinning up the `bita-uat` Supabase database + `bita-uat` Vercel deployment in under 10 minutes, loading the fake UAT seed (`supabase/seed/demo.sql`), and resetting it whenever needed (`supabase/seed/uat-reset.sql`).

> **Safety Guard:** Both `supabase/seed/demo.sql` and `supabase/seed/uat-reset.sql` begin with an automatic PL/pgSQL guard that **refuses to run and raises an exception** if `public.customers` contains any customer row not marked as fake (`[FAKE-UAT]`, `DEMO-%`, or `.example.test`). Never run either script against `bita-dev`.

---

## Step 1: Create the `bita-uat` Supabase Project

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and click **New project**.
2. Set the project details:
   - **Name:** `bita-uat`
   - **Region:** `South Asia (Mumbai)` (`ap-south-1`)
   - **Plan:** Free tier
3. Once provisioned, copy the project's **Project ID (`ref`)**, **Project URL** (`https://<project-ref>.supabase.co`), **`anon` public key**, and **`service_role` secret key** from **Project Settings → API**.

---

## Step 2: Apply All 20 Migrations in Order (via Supabase MCP)

Using the Antigravity Supabase MCP (`apply_migration` targeting the new `bita-uat` project ref — **never** `supabase db push`), apply the 20 migration files in `supabase/migrations/` in exact chronological order:

1. `supabase/migrations/20261105000000_initial_schema.sql`
2. `supabase/migrations/20261105010000_private_helpers.sql`
3. `supabase/migrations/20261106000000_storage.sql`
4. `supabase/migrations/20261106010000_technician_access.sql`
5. `supabase/migrations/20261106020000_approval_actor.sql`
6. `supabase/migrations/20261106030000_technician_pairing.sql`
7. `supabase/migrations/20261106040000_invoices_in_app.sql`
8. `supabase/migrations/20261106050000_invoice_zoho_guard.sql`
9. `supabase/migrations/20261107000000_report_edits_and_photos.sql`
10. `supabase/migrations/20261107010000_phase2_foundation.sql`
11. `supabase/migrations/20261107020000_customer_po_value.sql`
12. `supabase/migrations/20261107030000_price_items.sql`
13. `supabase/migrations/20261107040000_invoice_reports_multi.sql`
14. `supabase/migrations/20261107050000_equipment_register_v2.sql`
15. `supabase/migrations/20261107051000_proforma_and_tax_numbering.sql`
16. `supabase/migrations/20261107060000_calendar_and_leave.sql`
17. `supabase/migrations/20261107061000_credit_notes_and_tds.sql`
18. `supabase/migrations/20261107070000_log_book_employees_equipment_guard.sql`
19. `supabase/migrations/20261107080000_ut_report_dropdowns_and_settings.sql`
20. `supabase/migrations/20261111010000_equipment_conflict_invoker.sql`

*(If Atlas's G7 branding migration is present in `supabase/migrations/`, apply it immediately after #20.)*

---

## Step 3: Run the Fake UAT Seed (`supabase/seed/demo.sql`)

Execute `supabase/seed/demo.sql` against `bita-uat` (via the Supabase SQL Editor or the Supabase MCP `execute_sql` tool).

What `supabase/seed/demo.sql` loads (100% fake data, idempotent):
- **Settings (`public.settings`):**
  - `company_profile`: `"DEMO INSPECTION & TESTING AGENCY (UAT SANDBOX)"`, fake GSTIN `29AAACD0000F1Z5`, fake PAN `AAACD0000F`, default SAC `998393`, and fake bank details.
  - `invoice_numbering`: `next_tax_no = 1`, `next_proforma_no = 1`, `next_credit_note_no = 1`.
  - `holidays`: 5 sample holiday dates (`2026-01-26`, `2026-05-01`, `2026-08-15`, `2026-10-02`, `2026-11-01`).
- **Customers & Contacts:** Fake industrial customers across **3 GST states** so both intra-state **CGST + SGST** and inter-state **IGST** appear automatically:
  - `Test Turbines India Ltd` (`29AAACT0001A1Z5` — Karnataka `29`, `uses_proforma = true`)
  - `Sample Forgings Pvt Ltd` (`33AAACS0002B1Z5` — Tamil Nadu `33`, IGST 18%)
  - `Demo Gears & Pinions Co` (`27AAACD0003C1Z5` — Maharashtra `27`, IGST 18%)
  - Plus additional fake customers and `.example.test` contacts.
- **People & Qualifications:**
  - `Demo Director (Management & Reviewer)` (`{management,reviewer}`)
  - `Demo Coordinator (Office)` (`{office}`)
  - 2 Technicians without web logins (`Ramesh Sample (Technician)` and `Kiran Mock (Technician)`) with active Level II/III qualifications and 1 expired UT qualification (`DEMO-SNT-UT-EXP`).
- **Equipment (`public.equipment`):**
  - 4 UT flaw detectors and 2 MPI yokes linked to `equipment_types`, including 1 due within 14 days (`DEMO-UT-36-02`) and **1 expired calibration** (`DEMO-UT-D70-04`, overdue by 15 days).
- **Price List (`public.price_items`):** 5 standard NDT service items (`SAC 998393`).
- **Workflow Records:** Enquiries, an uploaded quotation (`DEMO-021-2026` with PDF object in `storage.objects`), accepted jobs including `BITA/26-27/9003` scheduled on the Calendar, inspections, reports, and sample invoices (`draft`, `issued`, `partly_paid`, `paid`).

---

## Step 4: Create the `bita-uat` Vercel Project

1. In the [Vercel Dashboard](https://vercel.com/dashboard), click **Add New… → Project** and import `bitasrk275/BITA-Management-System`.
2. Name the project **`bita-uat`** and set the Production Branch to `main`.
3. Copy the environment variables from the production Vercel project, **replacing** the Supabase and company header variables with the `bita-uat` values:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<bita-uat-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<bita-uat-anon-key>`
   - `SUPABASE_SERVICE_ROLE_KEY` = `<bita-uat-service-role-key>`
   - `NEXT_PUBLIC_BITA_COMPANY_NAME` = `DEMO INSPECTION & TESTING AGENCY (UAT SANDBOX)`
   - `NEXT_PUBLIC_BITA_GSTIN` = `29AAACD0000F1Z5`
   - `NEXT_PUBLIC_BITA_PAN` = `AAACD0000F`
   - `NEXT_PUBLIC_BITA_ADDRESS` = `Plot 99, Fake Industrial Estate, Peenya Test Zone, Bengaluru 560058`
   - `NEXT_PUBLIC_BITA_PHONE` = `+91 80 0000 0000`
   - `NEXT_PUBLIC_BITA_EMAIL` = `uat-office@example.test`
   - `ANTHROPIC_API_KEY` = *(copy from production Vercel project so `/enquiries/new` AI email assist works in UAT)*
   - `ANTHROPIC_MODEL` = `claude-sonnet-5-5`
   - `REMINDERS_CRON_SECRET` = *(any random 32-char secret for UAT)*
   - *(Leave `TELEGRAM_BOT_TOKEN` unset in `bita-uat` unless using a separate UAT bot, so the live `@bita_executive_bot` webhook stays pointed at production.)*
4. Click **Deploy**.

---

## Step 5: Create the Two UAT Logins (`Management` and `Office`)

1. In the **`bita-uat` Supabase Dashboard → Authentication → Users**, click **Add user → Create new user** and create two logins (with **Auto Confirm User** enabled):
   - **Management & Reviewer login:** `uat.director@example.test` (set a password for UAT testers)
   - **Office staff login:** `uat.office@example.test` (set a password for UAT testers)
2. Link those two `auth.users` rows to the seeded `public.people` rows by running this snippet in the **`bita-uat` SQL Editor** (or via `/settings/users` after linking the management user):
   ```sql
   update public.people
   set user_id = (select id from auth.users where email = 'uat.director@example.test'),
       email   = 'uat.director@example.test'
   where id = '71000000-0000-0000-0000-000000000001';

   update public.people
   set user_id = (select id from auth.users where email = 'uat.office@example.test'),
       email   = 'uat.office@example.test'
   where id = '71000000-0000-0000-0000-000000000002';
   ```

---

## Step 6: Pair a Technician Phone for Field Testing

1. Log into the `bita-uat` web app as `uat.director@example.test`.
2. Open **Employees** (or **Equipment → Registers → People**), select **Ramesh Sample (Technician)**, and click **Link a phone** to generate a 6-digit pairing code (valid for 15 minutes).
3. Open `<bita-uat-url>/field-app` in a mobile browser (or open the Android APK configured for the UAT URL) and enter the 6-digit code to pair the device as **Ramesh Sample (Technician)**.

---

## Step 7: Resetting UAT Data Anytime (`supabase/seed/uat-reset.sql`)

Whenever BITA finishes a UAT pass and wants a clean slate with invoice numbering reset back to `1`:

1. Run **`supabase/seed/uat-reset.sql`** in the `bita-uat` SQL Editor (or via the Supabase MCP `execute_sql` tool).
   - It verifies the safety guard (refusing to run if any real customer row exists), truncates all operational and master tables, **preserves** `auth.users` and any `public.people` rows linked to `auth.users` (`user_id is not null`), and resets `invoice_numbering` to `1`.
2. Immediately run **`supabase/seed/demo.sql`** to restore the fresh fake UAT dataset.
   - Re-link `71000000-0000-0000-0000-000000000001` and `71000000-0000-0000-0000-000000000002` if needed (since `uat-reset.sql` preserves any `people` row whose `user_id is not null`, your linked logins remain intact!).
