-- UAT database reset script (G12).
-- Clears all UAT operational and demo master records so `supabase/seed/demo.sql` can be re-run cleanly,
-- while preserving `auth.users` and any `public.people` rows linked to `auth.users` (`user_id is not null`).
-- NEVER run on bita-dev or production: the first statement below refuses to execute if
-- `public.customers` contains any customer row not marked as fake.

-- ---------------------------------------------------------------------------
-- 0. Safety guard: refuse to run if public.customers has non-fake rows
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.customers c
    where coalesce(c.notes, '') not ilike '%[FAKE%'
      and coalesce(c.zoho_contact_id, '') not like 'DEMO-%'
      and not exists (
        select 1
        from public.customer_contacts cc
        where cc.customer_id = c.id
          and cc.email like '%.example.test'
      )
  ) then
    raise exception 'Refusing to run uat-reset.sql: public.customers contains non-fake customer records (never run uat-reset.sql on production or bita-dev).';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Truncate operational & master tables in dependency order
-- ---------------------------------------------------------------------------
truncate table
  public.credit_notes,
  public.payments,
  public.payment_reminders,
  public.invoice_reports,
  public.invoice_lines,
  public.invoices,
  public.invoice_counters,
  public.job_counters,
  public.reports,
  public.inspection_edits,
  public.attachments,
  public.inspections,
  public.job_expenses,
  public.log_book_entries,
  public.assignment_equipment,
  public.assignments,
  public.leave_days,
  public.technician_messages,
  public.equipment_movements,
  public.jobs,
  public.quotation_items,
  public.quotations,
  public.enquiries,
  public.customer_contacts,
  public.customers,
  public.qualifications,
  public.equipment,
  public.price_items,
  public.pairing_codes,
  public.technician_devices,
  public.audit_log
restart identity cascade;

-- ---------------------------------------------------------------------------
-- 2. Remove only unlinked demo people (preserve any logged-in UAT accounts)
-- ---------------------------------------------------------------------------
delete from public.people
where user_id is null;

-- ---------------------------------------------------------------------------
-- 3. Reset invoice numbering counters back to 1
-- ---------------------------------------------------------------------------
update public.settings
set value = '{
  "tax_prefix": "INV-",
  "next_tax_no": 1,
  "next_tax_invoice_no": 1,
  "proforma_prefix": "PI-",
  "next_proforma_no": 1,
  "credit_note_prefix": "CN-",
  "next_credit_note_no": 1,
  "default_sac": "998393"
}'::jsonb,
    updated_at = now()
where key = 'invoice_numbering';
