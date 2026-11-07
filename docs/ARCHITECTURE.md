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

## 2. Worked Example: `customers` Module

1. **Input validation (`lib/modules/customers/schema.ts`):**
   - `parseCustomerInput(raw)` accepts either `FormData` (from a Server Action) or a JSON object (from `POST /api/v1/customers` or `PATCH /api/v1/customers/:id`).
   - Validates required fields (`name`), normalizes uppercase codes and GSTINs, and checks `payment_terms_days` (0–365).
2. **Service layer (`lib/modules/customers/service.ts`):**
   - `listCustomers(supabase, { q })`
   - `getCustomerDetail(supabase, id)`
   - `createCustomerRecord(supabase, input)`
   - `updateCustomerRecord(supabase, id, input)`
   - `deleteCustomerRecord(supabase, id)` (delegates to `softDeleteRecord(supabase, "customers", id)`)
   - `restoreCustomerRecord(supabase, id)` (delegates to `restoreRecord(supabase, "customers", id)`)
   - `addCustomerContact`, `updateCustomerContact`, `deleteCustomerContact`
3. **API v1 routes (`app/api/v1/customers/`):**
   - `GET /api/v1/customers?q=...` → `listCustomers`
   - `POST /api/v1/customers` → `parseCustomerInput` + `createCustomerRecord`
   - `GET /api/v1/customers/:id` → `getCustomerDetail`
   - `PATCH /api/v1/customers/:id` → `parseCustomerInput` + `updateCustomerRecord`
   - `DELETE /api/v1/customers/:id` → `deleteCustomerRecord`
   - `POST /api/v1/customers/:id/restore` → `restoreCustomerRecord`
4. **Office screens (`app/(office)/customers/`):**
   - `page.tsx` calls `listCustomers(supabase, { q })`.
   - `[id]/page.tsx` calls `getCustomerDetail(supabase, id)` and renders a confirmation block for soft-deleting the customer.
   - `actions.ts` calls `parseCustomerInput` and the `lib/modules/customers/service.ts` functions.

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
- **Issued tax invoices:** Sent/issued tax invoices are never deleted; they are cancelled or adjusted via credit notes (P4c).

---

## 4. Settings Tables (`public.settings` & `public.settings_options`)

- `public.settings` (`key text primary key, value jsonb, description text, updated_at timestamptz, updated_by uuid`):
  - Stores configurable system settings (`permissions`, `invoice_numbering`, `reminder_timings`, `holidays`).
  - Read by `private.has_permission(perm)` in PostgreSQL and by `lib/modules/settings/service.ts` in the app.
- `public.settings_options` (`id uuid primary key, list_key text, value text, position integer, active boolean`):
  - Stores configurable dropdown options (`equipment_type`, `couplant`, `surface_condition`, etc.) managed at `/settings` and `/api/v1/settings`.
