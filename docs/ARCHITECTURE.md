# BITA Architecture – Modules, API v1, Soft Delete & Settings

This document defines the modular, API-first architecture for Phase 2 of the **BITA Business Management System** (`PHASE2_PLAN.md` Rule 1–4).

---

## 1. Module & API-First Rule

Every business domain lives in its own module under `lib/modules/<module>/` and exposes both TypeScript service functions and HTTP JSON routes under `app/api/v1/<module>/`.

### Folder Structure per Module

```text
lib/modules/<module>/
  schema.ts          # Pure input parsing, normalization, and validation
  service.ts         # Business logic + Supabase queries (accepts SupabaseClient<Database>)
  <module>.test.ts   # Unit and integration tests

app/api/v1/<module>/
  route.ts           # GET (list), POST (create)
  [id]/route.ts      # GET (detail), PATCH/PUT (update), DELETE (soft-delete)
  [id]/restore/
    route.ts         # POST (restore soft-deleted record)
```

### Key Invariants

1. **Single source of business logic (`service.ts`):**
   - `service.ts` functions take `supabase: SupabaseClient<Database>` as their first argument.
   - Next.js Server Components, Server Actions (`app/(office)/.../actions.ts`), and `/api/v1/*` Route Handlers call the **exact same service functions** and never duplicate validation or query logic.
2. **Cross-module boundaries:**
   - Modules communicate through their exported `service.ts` functions rather than reaching directly into another module's tables from UI screens.
3. **Incremental migration:**
   - Existing Phase 1 code is moved into `lib/modules/<module>/` when a Phase 2 task touches that domain.
4. **Unified Session & RLS Authentication (`/api/v1/*`):**
   - `requireApiStaff()` in `lib/api/v1.ts` authenticates `/api/v1/*` requests using the logged-in Supabase session from cookies (`createClient()` from `lib/supabase/server.ts`).
   - All database calls run under the caller's Supabase session so PostgreSQL Row Level Security (RLS) and `audit_log` triggers apply identically whether an action comes from a browser form, an `/api/v1/*` endpoint, or a future AI/MCP assistant.

---

## 2. Complete API v1 Route Table

| Domain | Endpoint | Methods | Service Module | Description |
| --- | --- | --- | --- | --- |
| **Customers** | `/api/v1/customers` | `GET`, `POST` | `lib/modules/customers` | List customers (`?q=`), create customer |
| **Customers** | `/api/v1/customers/[id]` | `GET`, `PATCH`, `PUT`, `DELETE` | `lib/modules/customers` | Get detail, update, soft-delete customer |
| **Customers** | `/api/v1/customers/[id]/restore` | `POST` | `lib/modules/customers` | Restore soft-deleted customer |
| **Customers** | `/api/v1/customers/[id]/contacts` | `POST`, `PATCH`, `DELETE` | `lib/modules/customers` | Add, update, or remove customer contact |
| **Enquiries** | `/api/v1/enquiries` | `GET`, `POST` | `lib/modules/enquiries` | List enquiries (`?status=&customer_id=&q=`), create enquiry |
| **Enquiries** | `/api/v1/enquiries/[id]` | `GET`, `PATCH`, `PUT`, `DELETE` | `lib/modules/enquiries` | Get detail, update, soft-delete enquiry |
| **Enquiries** | `/api/v1/enquiries/[id]/restore` | `POST` | `lib/modules/enquiries` | Restore soft-deleted enquiry |
| **Quotations** | `/api/v1/quotations` | `GET`, `POST` | `lib/modules/quotations` | List quotations (`?status=&customer_id=&q=`), create quotation + items |
| **Quotations** | `/api/v1/quotations/[id]` | `GET`, `PATCH`, `PUT`, `DELETE` | `lib/modules/quotations` | Get detail, update, soft-delete quotation (refused if linked job exists) |
| **Quotations** | `/api/v1/quotations/[id]/restore` | `POST` | `lib/modules/quotations` | Restore soft-deleted quotation |
| **Quotations / PO** | `/api/v1/quotations/[id]/accept` | `POST` | `lib/modules/po` | Accept quotation, record Customer PO (`po_number`, `po_date`, `po_value`, `po_file`), and create job |
| **Jobs** | `/api/v1/jobs` | `GET`, `POST` | `lib/modules/jobs` | List jobs (`?status=&customer_id=&q=`), create job |
| **Jobs** | `/api/v1/jobs/[id]` | `GET`, `PATCH`, `PUT`, `DELETE` | `lib/modules/jobs` | Get detail, update, soft-delete job (refused if issued invoice exists) |
| **Jobs** | `/api/v1/jobs/[id]/restore` | `POST` | `lib/modules/jobs` | Restore soft-deleted job |
| **Jobs / PO** | `/api/v1/jobs/[id]/po` | `POST`, `PATCH` | `lib/modules/po` | Record or update Customer PO on an existing job |
| **Reports** | `/api/v1/reports` | `GET` | `lib/modules/reports` | List reports (`?status=&invoice_pending=1&job_id=&method=`) |
| **Reports** | `/api/v1/reports/[id]` | `GET` | `lib/modules/reports` | Get report detail + `invoice_pending` flag |
| **Reports** | `/api/v1/reports/[id]/approve` | `POST` | `lib/modules/reports` | Technical reviewer approval (`signatory_id`, `calibration_override_note`) |
| **Reports** | `/api/v1/reports/[id]/return` | `POST` | `lib/modules/reports` | Return report to technician with required `note` |
| **Reports** | `/api/v1/reports/[id]/pdf` | `GET` | `lib/modules/reports` | Download report PDF (signed if approved, draft otherwise) |
| **Reports** | `/api/v1/reports/[id]/docx` | `GET` | `lib/modules/reports` | Download editable Word (`.docx`) report |
| **Calendar** | `/api/v1/calendar` | `GET` | `lib/modules/calendar` | Week/month schedule, assignments, equipment bookings, leave, holidays |
| **Calendar** | `/api/v1/calendar/assign` | `POST` | `lib/modules/calendar` | Create single/multi-day technician & equipment assignment |
| **Calendar** | `/api/v1/calendar/assignments/[id]` | `PATCH`, `DELETE` | `lib/modules/calendar` | Update or soft-delete assignment |
| **Calendar** | `/api/v1/calendar/assignments/[id]/move` | `POST` | `lib/modules/calendar` | Move assignment date range with conflict checks |
| **Calendar** | `/api/v1/calendar/conflicts` | `GET` | `lib/modules/calendar` | Check technician/equipment/qualification/calibration conflicts |
| **Calendar** | `/api/v1/calendar/leave` | `GET`, `POST` | `lib/modules/calendar` | List or record employee leave days |
| **Calendar** | `/api/v1/calendar/leave/[id]` | `DELETE` | `lib/modules/calendar` | Soft-delete leave day |
| **Log Book** | `/api/v1/log-book` | `GET`, `POST`, `PATCH`, `DELETE` | `lib/modules/log-book` | Monthly log-book overview, status updates, and `job_expenses` |
| **Employees** | `/api/v1/employees` | `GET`, `POST` | `lib/modules/employees` | List employees (`view_salaries` gated), create employee |
| **Employees** | `/api/v1/employees/[id]` | `GET`, `PATCH`, `DELETE` | `lib/modules/employees` | Employee detail, worked/idle/leave summary, soft-delete |
| **Employees** | `/api/v1/employees/[id]/restore` | `POST` | `lib/modules/employees` | Restore soft-deleted employee |
| **Equipment** | `/api/v1/equipment` | `GET`, `POST` | `lib/modules/equipment` | List equipment with calibration status, create equipment |
| **Equipment** | `/api/v1/equipment/[id]` | `GET`, `PATCH`, `DELETE` | `lib/modules/equipment` | Equipment detail, update, soft-delete |
| **Equipment** | `/api/v1/equipment/[id]/restore` | `POST` | `lib/modules/equipment` | Restore soft-deleted equipment |
| **Equipment** | `/api/v1/equipment/[id]/movements` | `GET`, `POST` | `lib/modules/equipment` | Record equipment movement & delivery challan (`DC-xxxx`) |
| **Equipment** | `/api/v1/equipment/types` | `GET`, `POST` | `lib/modules/equipment` | List or create equipment types |
| **Equipment** | `/api/v1/equipment/types/[id]` | `PATCH`, `DELETE` | `lib/modules/equipment` | Update or soft-delete equipment type |
| **Price List** | `/api/v1/price-items` | `GET`, `POST` | `lib/modules/price-items` | List or create price-list items |
| **Price List** | `/api/v1/price-items/[id]` | `PATCH`, `PUT`, `DELETE` | `lib/modules/price-items` | Update or soft-delete price-list item |
| **Price List** | `/api/v1/price-items/[id]/restore` | `POST` | `lib/modules/price-items` | Restore soft-deleted price-list item |
| **Invoices** | `/api/v1/invoices` | `GET`, `POST` | `lib/modules/invoices` | List invoices, create proforma/tax invoice from 1+ approved reports |
| **Invoices** | `/api/v1/invoices/pending-reports` | `GET` | `lib/modules/invoices` | List approved reports pending invoicing, grouped by customer GSTIN |
| **Invoices** | `/api/v1/invoices/[id]/convert-to-tax` | `POST` | `lib/modules/invoices` | Convert a proforma invoice to a tax invoice in one click |
| **Invoices** | `/api/v1/invoices/[id]/payments` | `POST` | `lib/modules/invoices` | Record full/part payment with optional `tds_amount` |
| **Invoices** | `/api/v1/invoices/[id]/credit-notes` | `POST`, `DELETE` | `lib/modules/invoices` | Issue or cancel a credit note (`BITA/YY-YY/CN-xxxx`) |
| **Finance** | `/api/v1/finance` | `GET` | `lib/modules/finance` | Full financial overview (`?fy=&month=&section=&format=csv`, `view_finance` gated) |
| **Finance** | `/api/v1/finance/[report]` | `GET` | `lib/modules/finance` | Individual finance report (`ageing`, `customer-revenue`, `monthly`, `payments`, `proformas`) + CSV |
| **Recycle Bin** | `/api/v1/recycle-bin` | `GET`, `POST` | `lib/modules/recycle-bin` | List soft-deleted records across tables or restore (`table_name`, `record_id`) |
| **Settings** | `/api/v1/settings` | `GET`, `PUT`, `POST`, `PATCH`, `DELETE` | `lib/modules/settings` | System settings (`permissions`, `invoice_numbering`, `reminder_timings`, `holidays`) & dropdown options |

---

## 3. Soft Delete, Change Log & Recycle Bin

- **Soft-delete columns:** `customers`, `enquiries`, `quotations`, `jobs`, `people`, and `equipment` carry `deleted_at timestamptz` and `deleted_by uuid references public.people(id)`.
- **RLS filtering:** Normal `SELECT` policies require `deleted_at is null`, automatically hiding deleted rows from all lists and lookups.
- **Database trigger (`private.soft_delete()`):**
  - Enforces `private.can_delete()` (backed by the `'permissions'` key in `public.settings`, defaulting to `management` only).
  - Automatically populates `deleted_by = private.my_person_id()` on soft-delete and clears `deleted_by = null` on restore.
- **Audit trail (`private.audit_row()`):**
  - Every insert, update, soft-delete, and restore is recorded in `public.audit_log` with `old_row`, `new_row`, `changed_fields`, and actor IDs.
- **Recycle bin (`/recycle-bin` & `/api/v1/recycle-bin`):**
  - Uses `public.list_recycle_bin()`, `public.soft_delete_record(p_table, p_id)`, and `public.restore_record(p_table, p_id)` (`lib/modules/recycle-bin/service.ts`).
- **Issued tax invoices & linked records:**
  - Sent/issued tax invoices are never deleted; they are cancelled or adjusted via credit notes (P4c).
  - Deleting a job that has an issued invoice is refused.
  - Deleting a quotation that has an active linked job is refused.

---

## 4. Settings Tables (`public.settings` & `public.settings_options`)

- `public.settings` (`key text primary key, value jsonb, description text, updated_at timestamptz, updated_by uuid`):
  - Stores configurable system settings (`permissions`, `invoice_numbering`, `reminder_timings`, `holidays`, `company_profile`, `report_templates`, `telegram_config`).
  - Read by `private.has_permission(perm)` in PostgreSQL and by `lib/modules/settings/service.ts` in the app.
- `public.settings_options` (`id uuid primary key, list_key text, value text, position integer, active boolean`):
  - Stores configurable dropdown options (`equipment_type`, `couplant`, `surface_condition`, `test_methods`, etc.) managed at `/settings` and `/api/v1/settings`.
