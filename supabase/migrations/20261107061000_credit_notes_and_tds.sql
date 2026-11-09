-- Phase 2 (P4c): Credit notes (BITA/YY-YY/CN-0001) linked to issued tax invoices + TDS deducted on payments (tds_amount)
-- Both issued credit notes and (amount + tds_amount) on payments reduce the invoice balance so short TDS payments aren't chased.

-- 1. Add tds_amount to public.payments
alter table public.payments
  add column if not exists tds_amount numeric(14, 2) not null default 0
  check (tds_amount >= 0);

-- 2. Create public.credit_notes
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  credit_note_no text unique,
  credit_date date not null default current_date,
  reason text not null,
  taxable_value numeric(14, 2) not null default 0 check (taxable_value >= 0),
  cgst numeric(14, 2) not null default 0 check (cgst >= 0),
  sgst numeric(14, 2) not null default 0 check (sgst >= 0),
  igst numeric(14, 2) not null default 0 check (igst >= 0),
  round_off numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0 check (total > 0),
  status text not null default 'issued' check (status in ('draft', 'issued', 'cancelled')),
  issued_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists credit_notes_invoice_idx
  on public.credit_notes (invoice_id, credit_date);

alter table public.credit_notes enable row level security;

grant select, insert, update, delete on public.credit_notes to authenticated, service_role;

drop policy if exists billing_read on public.credit_notes;
create policy billing_read on public.credit_notes
  for select to authenticated
  using (private.has_role('management') or private.has_role('office'));

drop policy if exists office_write on public.credit_notes;
create policy office_write on public.credit_notes
  for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

-- 3. Credit note number generator (BITA/YY-YY/CN-0001, configurable in public.settings 'invoice_numbering')
create or replace function private.next_credit_note_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  start_year integer := extract(year from today)::integer - case when extract(month from today) < 4 then 1 else 0 end;
  fy text := lpad((start_year % 100)::text, 2, '0') || '-' || lpad(((start_year + 1) % 100)::text, 2, '0');
  v_cfg jsonb := '{}'::jsonb;
  v_prefix text;
  v_counter_key text := fy || ':CN';
  v_floor integer := 1;
  n integer;
begin
  select value into v_cfg
  from public.settings
  where key = 'invoice_numbering';

  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_prefix := coalesce(nullif(btrim(v_cfg->>'credit_note_prefix'), ''), 'CN-');
  if (v_cfg->>'next_credit_note_no') ~ '^\d+$' then
    v_floor := greatest((v_cfg->>'next_credit_note_no')::integer, 1);
  end if;

  insert into public.invoice_counters as c (financial_year, last_no)
  values (v_counter_key, v_floor)
  on conflict (financial_year)
  do update set last_no = greatest(c.last_no + 1, v_floor)
  returning last_no into n;

  update public.settings
  set value = jsonb_set(coalesce(value, '{}'::jsonb), '{next_credit_note_no}', to_jsonb(n + 1), true),
      updated_at = now()
  where key = 'invoice_numbering';

  return 'BITA/' || fy || '/' || v_prefix || lpad(n::text, 4, '0');
end;
$$;

-- 4. Update private.before_invoice_write() to subtract both (payments.amount + payments.tds_amount) and issued credit_notes.total
create or replace function private.before_invoice_write() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  was_frozen boolean := false;
  issuing boolean := false;
  line_count integer := 0;
  lines_sum numeric(14, 2) := 0;
  terms_days integer := 30;
  paid_sum numeric(14, 2) := 0;
  credit_sum numeric(14, 2) := 0;
  settled_sum numeric(14, 2) := 0;
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
        new.customer_po_number, new.notes, new.converted_from_id
      ) is distinct from (
        old.job_id, old.kind, old.report_id, old.quotation_id, old.invoice_no,
        old.place_of_supply, old.taxable_value, old.cgst, old.sgst, old.igst,
        old.round_off, old.total, old.invoice_date, old.due_date,
        old.customer_po_number, old.notes, old.converted_from_id
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

  -- 2. Assign invoice_no (proforma PI-xxxx or tax INV-xxxx), issued_at, invoice_date and due_date when issued.
  if new.status in ('issued', 'partly_paid', 'paid') then
    if new.invoice_no is null and new.number is null and new.zoho_id is null then
      new.invoice_no := private.next_invoice_no(new.kind);
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

  -- Maintain balance = total - (payments.amount + payments.tds_amount) - issued credit_notes.total
  if new.id is not null then
    select coalesce(sum(p.amount + coalesce(p.tds_amount, 0)), 0) into paid_sum
    from public.payments p
    where p.invoice_id = new.id;

    select coalesce(sum(cn.total), 0) into credit_sum
    from public.credit_notes cn
    where cn.invoice_id = new.id
      and cn.status = 'issued';
  end if;

  settled_sum := paid_sum + credit_sum;

  if new.status = 'cancelled' then
    new.balance := 0;
  elsif tg_op = 'INSERT' and new.status = 'paid' and settled_sum = 0 then
    new.balance := 0;
  else
    new.balance := greatest(coalesce(new.total, 0) - settled_sum, 0);
    if new.status in ('issued', 'partly_paid', 'paid') then
      if settled_sum > 0 and new.balance = 0 then
        new.status := 'paid';
      elsif settled_sum > 0 and new.balance > 0 then
        new.status := 'partly_paid';
      elsif settled_sum = 0 then
        new.status := 'issued';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 5. Update private.check_payment_write() so (amount + tds_amount) cannot exceed invoice balance
create or replace function private.check_payment_write() returns trigger
language plpgsql set search_path = public, private as $$
declare
  inv record;
  allowed_balance numeric(14, 2);
  effective_payment numeric(14, 2);
begin
  select status, zoho_id, balance into inv from public.invoices where id = new.invoice_id;
  if inv.status in ('draft', 'cancelled') and inv.zoho_id is null then
    raise exception 'Payments can only be recorded against an issued invoice';
  end if;

  effective_payment := coalesce(new.amount, 0) + coalesce(new.tds_amount, 0);
  allowed_balance := coalesce(inv.balance, 0) + case when tg_op = 'UPDATE' then coalesce(old.amount, 0) + coalesce(old.tds_amount, 0) else 0 end;

  if effective_payment > allowed_balance then
    raise exception 'Payment amount (%) exceeds the invoice balance (%)', effective_payment, allowed_balance;
  end if;

  return new;
end;
$$;

-- 6. Credit note validation, numbering, and balance sync triggers
create or replace function private.before_credit_note_write() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  inv record;
  was_frozen boolean := false;
  allowed_balance numeric(14, 2);
begin
  select id, kind, status, balance into inv
  from public.invoices
  where id = new.invoice_id;

  if inv.id is null then
    raise exception 'Target invoice % does not exist', new.invoice_id;
  end if;

  if inv.kind <> 'tax_invoice' then
    raise exception 'Credit notes can only be issued against a tax invoice';
  end if;

  if inv.status in ('draft', 'cancelled') then
    raise exception 'Credit notes can only be created against an issued tax invoice';
  end if;

  if tg_op = 'UPDATE' then
    was_frozen := old.status in ('issued', 'cancelled') or old.issued_at is not null;
    if was_frozen then
      if (
        new.invoice_id, new.credit_note_no, new.credit_date, new.reason,
        new.taxable_value, new.cgst, new.sgst, new.igst, new.round_off, new.total
      ) is distinct from (
        old.invoice_id, old.credit_note_no, old.credit_date, old.reason,
        old.taxable_value, old.cgst, old.sgst, old.igst, old.round_off, old.total
      ) then
        raise exception 'Issued credit notes cannot be edited; only cancellation is allowed';
      end if;

      if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
        raise exception 'A cancelled credit note cannot be reopened';
      end if;

      if new.status = 'draft' then
        raise exception 'An issued credit note cannot be returned to draft';
      end if;
    end if;
  end if;

  if new.igst > 0 and (new.cgst > 0 or new.sgst > 0) then
    raise exception 'Credit note cannot have both IGST and CGST/SGST';
  end if;

  if (new.taxable_value + new.cgst + new.sgst + new.igst + new.round_off) is distinct from new.total then
    raise exception 'Credit note total (%) does not equal taxable_value + cgst + sgst + igst + round_off (%)',
      new.total, (new.taxable_value + new.cgst + new.sgst + new.igst + new.round_off);
  end if;

  if new.status = 'issued' then
    allowed_balance := coalesce(inv.balance, 0) + case when tg_op = 'UPDATE' and old.status = 'issued' then coalesce(old.total, 0) else 0 end;
    if new.total > allowed_balance then
      raise exception 'Credit note total (%) exceeds the remaining invoice balance (%)', new.total, allowed_balance;
    end if;

    if new.credit_note_no is null then
      new.credit_note_no := private.next_credit_note_no();
    end if;
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.credit_date is null then
      new.credit_date := (now() at time zone 'Asia/Kolkata')::date;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists credit_notes_before_write on public.credit_notes;
create trigger credit_notes_before_write
  before insert or update on public.credit_notes
  for each row execute function private.before_credit_note_write();

create or replace function private.sync_invoice_credit_notes() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  target_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices set balance = balance where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists credit_notes_sync_invoice on public.credit_notes;
create trigger credit_notes_sync_invoice
  after insert or update or delete on public.credit_notes
  for each row execute function private.sync_invoice_credit_notes();

drop trigger if exists audit_credit_notes on public.credit_notes;
create trigger audit_credit_notes
  after insert or update or delete on public.credit_notes
  for each row execute function private.audit_row();

revoke all on function
  private.next_credit_note_no(),
  private.before_credit_note_write(),
  private.sync_invoice_credit_notes()
from public, anon;

grant execute on function
  private.next_credit_note_no(),
  private.before_credit_note_write(),
  private.sync_invoice_credit_notes()
to authenticated, service_role;
