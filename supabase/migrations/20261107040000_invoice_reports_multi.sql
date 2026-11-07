-- Phase 2 (P4a): Invoice pending report status & several reports on one invoice
-- 1. public.invoice_reports join table (many-to-many between invoices and reports, constrained so a report can appear on at most one non-cancelled invoice)
-- 2. Trigger private.check_invoice_report():
--    - Only approved reports (approved_at is not null or status in ('approved', 'sent'))
--    - Only reports belonging to the same customer GSTIN (or same customer_id when both have blank GSTIN)
--    - One report on at most one live (status <> 'cancelled') invoice
-- 3. Trigger private.sync_invoice_report_link() to keep invoices.report_id mirrored into invoice_reports

create table if not exists public.invoice_reports (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invoice_id, report_id)
);

create index if not exists invoice_reports_report_id_idx
  on public.invoice_reports (report_id);

alter table public.invoice_reports enable row level security;

drop policy if exists "staff_read_invoice_reports" on public.invoice_reports;
create policy "staff_read_invoice_reports" on public.invoice_reports
  for select to authenticated
  using (private.is_staff());

drop policy if exists "office_write_invoice_reports" on public.invoice_reports;
create policy "office_write_invoice_reports" on public.invoice_reports
  for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

create or replace function private.check_invoice_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv_job_id uuid;
  v_inv_status text;
  v_inv_customer_id uuid;
  v_inv_gstin text;
  v_rep_job_id uuid;
  v_rep_status public.report_status;
  v_rep_approved_at timestamptz;
  v_rep_customer_id uuid;
  v_rep_gstin text;
  v_existing_invoice_id uuid;
  v_existing_invoice_no text;
begin
  -- 1. Load target invoice and its customer GSTIN
  select i.job_id, i.status, j.customer_id, upper(btrim(coalesce(c.gstin, '')))
    into v_inv_job_id, v_inv_status, v_inv_customer_id, v_inv_gstin
  from public.invoices i
  join public.jobs j on j.id = i.job_id
  join public.customers c on c.id = j.customer_id
  where i.id = new.invoice_id;

  if v_inv_job_id is null then
    raise exception 'Invoice % does not exist.', new.invoice_id;
  end if;

  -- 2. Load report and its customer GSTIN
  select r.job_id, r.status, r.approved_at, j.customer_id, upper(btrim(coalesce(c.gstin, '')))
    into v_rep_job_id, v_rep_status, v_rep_approved_at, v_rep_customer_id, v_rep_gstin
  from public.reports r
  join public.jobs j on j.id = r.job_id
  join public.customers c on c.id = j.customer_id
  where r.id = new.report_id;

  if v_rep_job_id is null then
    raise exception 'Report % does not exist.', new.report_id;
  end if;

  -- 3. Report must be approved before being linked to an invoice
  if v_rep_approved_at is null and v_rep_status not in ('approved', 'sent') then
    raise exception 'Only approved reports can be added to an invoice (report % has status %).', new.report_id, v_rep_status;
  end if;

  -- 4. Report customer GSTIN must match the invoice customer GSTIN
  if v_inv_gstin <> '' or v_rep_gstin <> '' then
    if v_inv_gstin <> v_rep_gstin then
      raise exception 'All reports on an invoice must belong to the same customer GSTIN (% vs %).',
        coalesce(nullif(v_inv_gstin, ''), 'unregistered'),
        coalesce(nullif(v_rep_gstin, ''), 'unregistered');
    end if;
  elsif v_inv_customer_id <> v_rep_customer_id then
    raise exception 'All reports on an invoice must belong to the same customer when GSTIN is not set.';
  end if;

  -- 5. A report can be linked to at most one non-cancelled invoice at a time
  if v_inv_status <> 'cancelled' then
    select i.id, coalesce(i.invoice_no, i.number, 'Draft')
      into v_existing_invoice_id, v_existing_invoice_no
    from public.invoices i
    where i.id <> new.invoice_id
      and i.status <> 'cancelled'
      and (
        i.report_id = new.report_id
        or exists (
          select 1
          from public.invoice_reports ir
          where ir.invoice_id = i.id
            and ir.report_id = new.report_id
        )
      )
    limit 1;

    if v_existing_invoice_id is not null then
      raise exception 'Report % is already linked to active invoice % (%). Cancel that invoice first before re-billing.',
        new.report_id, v_existing_invoice_no, v_existing_invoice_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists check_invoice_report_before_write on public.invoice_reports;
create trigger check_invoice_report_before_write
  before insert or update on public.invoice_reports
  for each row execute function private.check_invoice_report();

create or replace function private.sync_invoice_report_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_id is not null then
    insert into public.invoice_reports (invoice_id, report_id)
    values (new.id, new.report_id)
    on conflict (invoice_id, report_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_invoice_report_after_write on public.invoices;
create trigger sync_invoice_report_after_write
  after insert or update of report_id on public.invoices
  for each row execute function private.sync_invoice_report_link();

-- Backfill existing invoices that already have report_id set
insert into public.invoice_reports (invoice_id, report_id)
select i.id, i.report_id
from public.invoices i
join public.reports r on r.id = i.report_id
where i.report_id is not null
  and (r.approved_at is not null or r.status in ('approved', 'sent'))
on conflict (invoice_id, report_id) do nothing;
