-- Round 3 (R3-3 Money, 20 Nov):
-- 1. Multi-job payment receipts (D-R3a): public.payment_receipts table, nullable public.payments.receipt_id,
--    and nullable public.jobs.paid_at + public.jobs.paid_receipt_id (additive only).
-- 2. Fix private.next_invoice_no() and private.next_credit_note_no() so settings 'invoice_numbering'
--    supports both 'next_tax_no' and 'next_tax_invoice_no' and strips any duplicate 'BITA/YY-YY/' prefix.

-- ---------------------------------------------------------------------------
-- 1. Multi-job payment receipts table and additive columns
-- ---------------------------------------------------------------------------

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  received_on date not null default current_date,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  mode text,
  reference text,
  advice_path text,
  job_ids uuid[] not null default '{}',
  notes text,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payment_receipts_customer_idx
  on public.payment_receipts (customer_id, received_on desc);

create index if not exists payment_receipts_received_on_idx
  on public.payment_receipts (received_on desc);

alter table public.payment_receipts enable row level security;

grant select, insert, update, delete on public.payment_receipts to authenticated, service_role;

drop policy if exists billing_read on public.payment_receipts;
create policy billing_read on public.payment_receipts
  for select to authenticated
  using (private.has_role('management') or private.has_role('office'));

drop policy if exists office_write on public.payment_receipts;
create policy office_write on public.payment_receipts
  for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

drop trigger if exists audit_payment_receipts on public.payment_receipts;
create trigger audit_payment_receipts
  after insert or update or delete on public.payment_receipts
  for each row execute function private.audit_row();

alter table public.payments
  add column if not exists receipt_id uuid references public.payment_receipts (id) on delete set null;

create index if not exists payments_receipt_idx
  on public.payments (receipt_id)
  where receipt_id is not null;

alter table public.jobs
  add column if not exists paid_at timestamptz,
  add column if not exists paid_receipt_id uuid references public.payment_receipts (id) on delete set null;

create index if not exists jobs_paid_at_idx
  on public.jobs (paid_at)
  where paid_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Normalize invoice_numbering lookup in private.next_invoice_no & private.next_credit_note_no
-- ---------------------------------------------------------------------------

create or replace function private.next_invoice_no(
  p_kind public.invoice_kind default 'tax_invoice'
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  start_year integer := extract(year from today)::integer - case when extract(month from today) < 4 then 1 else 0 end;
  fy text := lpad((start_year % 100)::text, 2, '0') || '-' || lpad(((start_year + 1) % 100)::text, 2, '0');
  v_cfg jsonb := '{}'::jsonb;
  v_prefix text;
  v_counter_key text;
  v_floor integer := 1;
  v_floor_alt integer := 1;
  n integer;
begin
  select value into v_cfg
  from public.settings
  where key = 'invoice_numbering';

  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  if p_kind = 'proforma' then
    v_prefix := coalesce(nullif(btrim(v_cfg->>'proforma_prefix'), ''), 'PI-');
    v_counter_key := fy || ':PI';
    if (v_cfg->>'next_proforma_no') ~ '^\d+$' then
      v_floor := greatest((v_cfg->>'next_proforma_no')::integer, 1);
    end if;
  else
    v_prefix := coalesce(nullif(btrim(v_cfg->>'tax_prefix'), ''), 'INV-');
    v_counter_key := fy;
    if (v_cfg->>'next_tax_invoice_no') ~ '^\d+$' then
      v_floor := greatest((v_cfg->>'next_tax_invoice_no')::integer, 1);
    end if;
    if (v_cfg->>'next_tax_no') ~ '^\d+$' then
      v_floor_alt := greatest((v_cfg->>'next_tax_no')::integer, 1);
    end if;
    v_floor := greatest(v_floor, v_floor_alt);
  end if;

  -- Strip any accidental leading 'BITA/YY-YY/' or 'BITA/<fy>/' from v_prefix so it is never doubled
  v_prefix := regexp_replace(v_prefix, '^BITA/([0-9]{2}-[0-9]{2}|YY-YY)/', '', 'i');

  insert into public.invoice_counters as c (financial_year, last_no)
  values (v_counter_key, v_floor)
  on conflict (financial_year)
  do update set last_no = greatest(c.last_no + 1, v_floor)
  returning last_no into n;

  if p_kind = 'proforma' then
    update public.settings
    set value = jsonb_set(coalesce(value, '{}'::jsonb), '{next_proforma_no}', to_jsonb(n + 1), true),
        updated_at = now()
    where key = 'invoice_numbering';
  else
    update public.settings
    set value = jsonb_set(
          jsonb_set(coalesce(value, '{}'::jsonb), '{next_tax_invoice_no}', to_jsonb(n + 1), true),
          '{next_tax_no}',
          to_jsonb(n + 1),
          true
        ),
        updated_at = now()
    where key = 'invoice_numbering';
  end if;

  return 'BITA/' || fy || '/' || v_prefix || lpad(n::text, 4, '0');
end;
$$;

create or replace function private.next_credit_note_no()
returns text
language plpgsql
security definer
set search_path = public, private
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
  v_prefix := regexp_replace(v_prefix, '^BITA/([0-9]{2}-[0-9]{2}|YY-YY)/', '', 'i');

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

revoke all on function
  private.next_invoice_no(public.invoice_kind),
  private.next_credit_note_no()
from public, anon;

grant execute on function
  private.next_invoice_no(public.invoice_kind),
  private.next_credit_note_no()
to authenticated, service_role;
