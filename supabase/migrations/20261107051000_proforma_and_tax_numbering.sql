-- Phase 2 (P4b): Proforma vs Tax invoice choice, proforma series (BITA/YY-YY/PI-0001),
-- Convert to tax invoice (converted_from_id), and tax/proforma numbering from public.settings ('invoice_numbering').

alter table public.invoices
  add column if not exists converted_from_id uuid references public.invoices(id) on delete set null;

create index if not exists invoices_converted_from_idx
  on public.invoices (converted_from_id)
  where converted_from_id is not null;

-- Replace zero-arg private.next_invoice_no() with overloaded/defaulted function supporting 'tax_invoice' and 'proforma'
drop function if exists private.next_invoice_no();

create or replace function private.next_invoice_no(
  p_kind public.invoice_kind default 'tax_invoice'
)
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
  v_next_key text;
  v_counter_key text;
  v_floor integer := 1;
  n integer;
begin
  select value into v_cfg
  from public.settings
  where key = 'invoice_numbering';

  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  if p_kind = 'proforma' then
    v_prefix := coalesce(nullif(btrim(v_cfg->>'proforma_prefix'), ''), 'PI-');
    v_next_key := 'next_proforma_no';
    v_counter_key := fy || ':PI';
    if (v_cfg->>'next_proforma_no') ~ '^\d+$' then
      v_floor := greatest((v_cfg->>'next_proforma_no')::integer, 1);
    end if;
  else
    v_prefix := coalesce(nullif(btrim(v_cfg->>'tax_prefix'), ''), 'INV-');
    v_next_key := 'next_tax_invoice_no';
    v_counter_key := fy;
    if (v_cfg->>'next_tax_invoice_no') ~ '^\d+$' then
      v_floor := greatest((v_cfg->>'next_tax_invoice_no')::integer, 1);
    end if;
  end if;

  insert into public.invoice_counters as c (financial_year, last_no)
  values (v_counter_key, v_floor)
  on conflict (financial_year)
  do update set last_no = greatest(c.last_no + 1, v_floor)
  returning last_no into n;

  update public.settings
  set value = jsonb_set(coalesce(value, '{}'::jsonb), array[v_next_key], to_jsonb(n + 1), true),
      updated_at = now()
  where key = 'invoice_numbering';

  return 'BITA/' || fy || '/' || v_prefix || lpad(n::text, 4, '0');
end;
$$;

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

-- Allow converting a proforma invoice to a tax invoice while preserving the linked reports in invoice_reports
create or replace function private.check_invoice_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv_job_id uuid;
  v_inv_status text;
  v_inv_kind public.invoice_kind;
  v_inv_converted_from_id uuid;
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
  select i.job_id, i.status, i.kind, i.converted_from_id, j.customer_id, upper(btrim(coalesce(c.gstin, '')))
    into v_inv_job_id, v_inv_status, v_inv_kind, v_inv_converted_from_id, v_inv_customer_id, v_inv_gstin
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

  -- 5. A report can be linked to at most one non-cancelled invoice of the same kind
  --    (and converting a proforma via converted_from_id is explicitly permitted).
  if v_inv_status <> 'cancelled' then
    select i.id, coalesce(i.invoice_no, i.number, 'Draft')
      into v_existing_invoice_id, v_existing_invoice_no
    from public.invoices i
    where i.id <> new.invoice_id
      and i.id is distinct from v_inv_converted_from_id
      and i.status <> 'cancelled'
      and (i.kind = v_inv_kind or i.kind = 'tax_invoice')
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
