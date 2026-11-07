-- In-app GST invoicing (D-017): invoices are generated, issued, downloaded as PDF/Word and tracked for
-- payment directly inside the BITA app (no Zoho Books dependency).
-- Keeps due_date, balance, number and reminders_paused working for payment reminders (lib/reminders).

-- ---------------------------------------------------------------------------
-- 1. Invoice counter per financial year (BITA/YY-YY/INV-0001)
-- ---------------------------------------------------------------------------

create table public.invoice_counters (
  financial_year text primary key,              -- e.g. '26-27'
  last_no integer not null
);

alter table public.invoice_counters enable row level security;

create function private.next_invoice_no() returns text
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  start_year integer := extract(year from today)::integer - case when extract(month from today) < 4 then 1 else 0 end;
  fy text := lpad((start_year % 100)::text, 2, '0') || '-' || lpad(((start_year + 1) % 100)::text, 2, '0');
  n integer;
begin
  insert into public.invoice_counters as c (financial_year, last_no) values (fy, 1)
  on conflict (financial_year) do update set last_no = c.last_no + 1
  returning last_no into n;
  return 'BITA/' || fy || '/INV-' || lpad(n::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reshape public.invoices
-- ---------------------------------------------------------------------------

alter table public.invoices alter column zoho_id drop not null;

alter table public.invoices
  add column invoice_no text unique,
  add column report_id uuid references public.reports (id),
  add column quotation_id uuid references public.quotations (id),
  add column place_of_supply text,
  add column taxable_value numeric(14, 2) not null default 0,
  add column cgst numeric(14, 2) not null default 0,
  add column sgst numeric(14, 2) not null default 0,
  add column igst numeric(14, 2) not null default 0,
  add column round_off numeric(14, 2) not null default 0,
  add column issued_at timestamptz,
  add column pdf_path text,
  add column notes text;

-- Normalize any existing seed/mirror rows before adding NOT NULL and CHECK constraints.
update public.invoices
set
  invoice_no = coalesce(invoice_no, number),
  total = coalesce(total, 0),
  balance = coalesce(balance, total, 0),
  issued_at = case
    when status in ('sent', 'overdue', 'issued', 'paid', 'partly_paid') or zoho_id is not null
      then coalesce(issued_at, created_at)
    else issued_at
  end,
  status = case
    when status in ('draft', 'issued', 'partly_paid', 'paid', 'cancelled') then status
    when coalesce(balance, total, 0) = 0 and coalesce(total, 0) > 0 then 'paid'
    when status in ('sent', 'overdue') or zoho_id is not null then 'issued'
    else 'draft'
  end;

alter table public.invoices
  alter column total set default 0,
  alter column total set not null,
  alter column balance set default 0,
  alter column balance set not null,
  alter column status set default 'draft',
  alter column status set not null,
  add constraint invoices_status_check check (status in ('draft', 'issued', 'partly_paid', 'paid', 'cancelled'));

-- One active GST invoice per job (cancelled invoices do not block issuing a replacement).
drop index if exists public.invoices_one_tax_invoice_per_job;
create unique index invoices_one_tax_invoice_per_job
  on public.invoices (job_id)
  where kind = 'tax_invoice' and status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. Invoice lines and payments
-- ---------------------------------------------------------------------------

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position integer not null default 1,
  description text not null,
  sac text not null default '',
  qty numeric(12, 3) not null default 1,
  unit text,
  rate numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  mode text,
  reference text,
  created_at timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id, paid_on);

-- ---------------------------------------------------------------------------
-- 4. Triggers: freeze after Issue, validate line/tax totals & due_date on Issue,
--    assign invoice_no on Issue, and maintain balance = total - payments
-- ---------------------------------------------------------------------------

create or replace function private.before_invoice_write() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  was_frozen boolean := false;
  issuing boolean := false;
  line_count integer := 0;
  lines_sum numeric(14, 2) := 0;
  terms_days integer := 30;
  paid_sum numeric(14, 2) := 0;
begin
  if tg_op = 'INSERT' and new.zoho_id is not null and new.status = 'draft' then
    new.status := 'issued';
  end if;

  if tg_op = 'UPDATE' then
    was_frozen := old.status in ('issued', 'partly_paid', 'paid', 'cancelled')
      or old.issued_at is not null
      or old.zoho_id is not null;

    if was_frozen then
      if (
        new.job_id, new.kind, new.report_id, new.quotation_id, new.invoice_no,
        new.place_of_supply, new.taxable_value, new.cgst, new.sgst, new.igst,
        new.round_off, new.total, new.invoice_date, new.due_date,
        new.customer_po_number, new.notes
      ) is distinct from (
        old.job_id, old.kind, old.report_id, old.quotation_id, old.invoice_no,
        old.place_of_supply, old.taxable_value, old.cgst, old.sgst, old.igst,
        old.round_off, old.total, old.invoice_date, old.due_date,
        old.customer_po_number, old.notes
      ) then
        raise exception 'Issued invoices cannot be edited; only cancellation, payment recording, or reminder pause is allowed';
      end if;

      if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
        raise exception 'A cancelled invoice cannot be reopened';
      end if;

      if new.status = 'draft' then
        raise exception 'An issued invoice cannot be returned to draft';
      end if;
    end if;
  end if;

  issuing := new.status in ('issued', 'partly_paid', 'paid')
    and new.zoho_id is null
    and (tg_op = 'INSERT' or old.status = 'draft');

  -- 1. Totals must match lines and GST consistency when issuing an in-app invoice.
  if issuing then
    select count(*), coalesce(sum(l.amount), 0)
    into line_count, lines_sum
    from public.invoice_lines l
    where l.invoice_id = new.id;

    if line_count = 0 then
      raise exception 'Cannot issue an invoice without at least one line item';
    end if;

    if new.taxable_value is distinct from lines_sum then
      raise exception 'Invoice taxable_value (%) does not match sum of line amounts (%)', new.taxable_value, lines_sum;
    end if;

    if new.cgst < 0 or new.sgst < 0 or new.igst < 0 then
      raise exception 'GST amounts cannot be negative';
    end if;

    if new.igst > 0 and (new.cgst > 0 or new.sgst > 0) then
      raise exception 'Invoice cannot have both IGST and CGST/SGST';
    end if;

    if (new.taxable_value + new.cgst + new.sgst + new.igst + new.round_off) is distinct from new.total then
      raise exception 'Invoice total (%) does not equal taxable_value + cgst + sgst + igst + round_off (%)',
        new.total, (new.taxable_value + new.cgst + new.sgst + new.igst + new.round_off);
    end if;
  end if;

  -- 2. Assign invoice_no, issued_at, invoice_date and due_date (from customer payment_terms_days) when issued.
  if new.status in ('issued', 'partly_paid', 'paid') then
    if new.invoice_no is null and new.number is null and new.zoho_id is null then
      new.invoice_no := private.next_invoice_no();
    end if;
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.invoice_date is null then
      new.invoice_date := (now() at time zone 'Asia/Kolkata')::date;
    end if;
    if new.due_date is null and new.job_id is not null then
      select coalesce(c.payment_terms_days, 30) into terms_days
      from public.jobs j
      join public.customers c on c.id = j.customer_id
      where j.id = new.job_id;

      new.due_date := new.invoice_date + coalesce(terms_days, 30);
    end if;
  end if;

  -- Keep legacy number column and invoice_no synchronized.
  new.invoice_no := coalesce(new.invoice_no, new.number);
  new.number := coalesce(new.invoice_no, new.number);

  -- Maintain balance = total - payments (and status transitions for issued invoices).
  if new.id is not null then
    select coalesce(sum(p.amount), 0) into paid_sum
    from public.payments p
    where p.invoice_id = new.id;
  end if;

  if new.status = 'cancelled' then
    new.balance := 0;
  elsif tg_op = 'INSERT' and new.status = 'paid' and paid_sum = 0 then
    new.balance := 0;
  else
    new.balance := greatest(coalesce(new.total, 0) - paid_sum, 0);
    if new.status in ('issued', 'partly_paid', 'paid') then
      if paid_sum > 0 and new.balance = 0 then
        new.status := 'paid';
      elsif paid_sum > 0 and new.balance > 0 then
        new.status := 'partly_paid';
      elsif paid_sum = 0 then
        new.status := 'issued';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger invoices_before_write
  before insert or update on public.invoices
  for each row execute function private.before_invoice_write();

create or replace function private.check_invoice_line_write() returns trigger
language plpgsql set search_path = public, private as $$
declare
  inv record;
  target_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  select status, issued_at, zoho_id into inv from public.invoices where id = target_id;
  if inv.status in ('issued', 'partly_paid', 'paid', 'cancelled') or inv.issued_at is not null or inv.zoho_id is not null then
    raise exception 'Cannot modify lines of an issued or cancelled invoice';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_lines_check_write
  before insert or update or delete on public.invoice_lines
  for each row execute function private.check_invoice_line_write();

create or replace function private.check_payment_write() returns trigger
language plpgsql set search_path = public, private as $$
declare
  inv record;
  allowed_balance numeric(14, 2);
begin
  select status, zoho_id, balance into inv from public.invoices where id = new.invoice_id;
  if inv.status in ('draft', 'cancelled') and inv.zoho_id is null then
    raise exception 'Payments can only be recorded against an issued invoice';
  end if;

  allowed_balance := coalesce(inv.balance, 0) + case when tg_op = 'UPDATE' then coalesce(old.amount, 0) else 0 end;
  if new.amount > allowed_balance then
    raise exception 'Payment amount (%) exceeds the invoice balance (%)', new.amount, allowed_balance;
  end if;

  return new;
end;
$$;

create trigger payments_check_write
  before insert or update on public.payments
  for each row execute function private.check_payment_write();

create or replace function private.sync_invoice_payments() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  target_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  -- Touching the invoice runs before_invoice_write(), which recomputes balance and status.
  update public.invoices set balance = balance where id = target_id;
  return coalesce(new, old);
end;
$$;

create trigger payments_sync_invoice
  after insert or update or delete on public.payments
  for each row execute function private.sync_invoice_payments();

-- Audit log triggers for invoices, lines and payments.
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function private.audit_row();
create trigger audit_invoice_lines after insert or update or delete on public.invoice_lines
  for each row execute function private.audit_row();
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and privileges (management and office read/write; technicians blocked)
-- ---------------------------------------------------------------------------

alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;

grant select, insert, update, delete on public.invoices, public.invoice_lines, public.payments to authenticated, service_role;

drop policy if exists management_pause_reminders on public.invoices;

create policy office_write on public.invoices for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

create policy billing_read on public.invoice_lines for select to authenticated
  using (private.has_role('management') or private.has_role('office'));
create policy office_write on public.invoice_lines for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

create policy billing_read on public.payments for select to authenticated
  using (private.has_role('management') or private.has_role('office'));
create policy office_write on public.payments for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

revoke all on function
  private.next_invoice_no(),
  private.before_invoice_write(),
  private.check_invoice_line_write(),
  private.check_payment_write(),
  private.sync_invoice_payments()
from public, anon;

grant execute on function
  private.next_invoice_no(),
  private.before_invoice_write(),
  private.check_invoice_line_write(),
  private.check_payment_write(),
  private.sync_invoice_payments()
to authenticated, service_role;
