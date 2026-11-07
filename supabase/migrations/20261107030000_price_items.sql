-- Phase 2 (P3): Price list module (public.price_items)
-- Stores BITA's services and charges with default rates, units, and SAC codes.
-- Supports soft delete, recycle bin restoration, audit logging, and RLS.
-- Invoice lines copy description, SAC, unit, and rate so changing a price item never alters past invoices.

create table if not exists public.price_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sac text,
  unit text not null default 'nos',
  default_rate numeric(14, 2) not null default 0 check (default_rate >= 0),
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_items_active_idx
  on public.price_items (active, name)
  where deleted_at is null;

create index if not exists price_items_deleted_at_idx
  on public.price_items (deleted_at)
  where deleted_at is not null;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_price_items_updated_at on public.price_items;
create trigger touch_price_items_updated_at
  before update on public.price_items
  for each row execute function private.touch_updated_at();

drop trigger if exists soft_delete_price_items on public.price_items;
create trigger soft_delete_price_items
  before delete on public.price_items
  for each row execute function private.soft_delete();

drop trigger if exists audit_price_items on public.price_items;
create trigger audit_price_items
  after insert or update or delete on public.price_items
  for each row execute function private.audit_row();

alter table public.price_items enable row level security;

drop policy if exists "staff_read" on public.price_items;
create policy "staff_read" on public.price_items
  for select to authenticated using (
    private.is_staff() and (deleted_at is null or private.include_deleted())
  );

drop policy if exists "office_insert" on public.price_items;
create policy "office_insert" on public.price_items
  for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);

drop policy if exists "office_update" on public.price_items;
create policy "office_update" on public.price_items
  for update to authenticated
  using (private.has_role('management') or private.has_role('office') or private.can_delete())
  with check (private.has_role('management') or private.has_role('office') or private.can_delete());

drop policy if exists "office_delete" on public.price_items;
create policy "office_delete" on public.price_items
  for delete to authenticated using (private.can_delete());

-- Extend soft_delete_record, restore_record, and list_recycle_bin to include price_items
create or replace function public.soft_delete_record(p_table text, p_id uuid) returns void
language plpgsql security invoker set search_path = public, private as $$
declare
  affected integer;
begin
  if auth.uid() is not null and not private.can_delete() then
    raise exception 'Only management can delete records';
  end if;

  perform set_config('app.include_deleted', 'true', true);

  case p_table
    when 'customers' then
      update public.customers set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'enquiries' then
      update public.enquiries set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'quotations' then
      update public.quotations set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'jobs' then
      update public.jobs set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'people' then
      update public.people set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'equipment' then
      update public.equipment set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    when 'price_items' then
      update public.price_items set deleted_at = now(), deleted_by = private.my_person_id()
      where id = p_id and deleted_at is null;
    else
      raise exception 'Unsupported soft-delete table: %', p_table;
  end case;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Record not found or already deleted';
  end if;
end;
$$;

create or replace function public.restore_record(p_table text, p_id uuid) returns void
language plpgsql security invoker set search_path = public, private as $$
declare
  affected integer;
begin
  if auth.uid() is not null and not private.can_delete() then
    raise exception 'Only management can restore records';
  end if;

  perform set_config('app.include_deleted', 'true', true);

  case p_table
    when 'customers' then
      update public.customers set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'enquiries' then
      update public.enquiries set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'quotations' then
      update public.quotations set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'jobs' then
      update public.jobs set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'people' then
      update public.people set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'equipment' then
      update public.equipment set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    when 'price_items' then
      update public.price_items set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    else
      raise exception 'Unsupported restore table: %', p_table;
  end case;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Deleted record not found';
  end if;
end;
$$;

create or replace function public.list_recycle_bin()
returns table (
  table_name text,
  record_id uuid,
  label text,
  detail text,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_name text
)
language plpgsql security invoker set search_path = public, private as $$
begin
  if auth.uid() is not null and not private.is_staff() then
    raise exception 'Only staff can view the recycle bin';
  end if;

  perform set_config('app.include_deleted', 'true', true);

  return query
  select
    items.table_name,
    items.record_id,
    items.label,
    items.detail,
    items.deleted_at,
    items.deleted_by,
    actor.full_name as deleted_by_name
  from (
    select
      'customers'::text as table_name,
      c.id as record_id,
      c.name as label,
      coalesce(c.gstin, c.code, 'Customer') as detail,
      c.deleted_at,
      c.deleted_by
    from public.customers c
    where c.deleted_at is not null

    union all

    select
      'enquiries'::text as table_name,
      e.id as record_id,
      coalesce(e.subject, 'Enquiry') as label,
      e.source::text as detail,
      e.deleted_at,
      e.deleted_by
    from public.enquiries e
    where e.deleted_at is not null

    union all

    select
      'quotations'::text as table_name,
      q.id as record_id,
      coalesce(q.ref_no, q.subject, 'Draft quotation') as label,
      q.status::text as detail,
      q.deleted_at,
      q.deleted_by
    from public.quotations q
    where q.deleted_at is not null

    union all

    select
      'jobs'::text as table_name,
      j.id as record_id,
      j.job_no as label,
      coalesce(j.site, j.scope, j.status::text) as detail,
      j.deleted_at,
      j.deleted_by
    from public.jobs j
    where j.deleted_at is not null

    union all

    select
      'people'::text as table_name,
      p.id as record_id,
      p.full_name as label,
      coalesce(p.position, array_to_string(p.roles, ', ')) as detail,
      p.deleted_at,
      p.deleted_by
    from public.people p
    where p.deleted_at is not null

    union all

    select
      'equipment'::text as table_name,
      eq.id as record_id,
      coalesce(nullif(concat_ws(' ', eq.make, eq.model), ''), eq.kind::text) as label,
      coalesce(eq.serial_no, eq.kind::text) as detail,
      eq.deleted_at,
      eq.deleted_by
    from public.equipment eq
    where eq.deleted_at is not null

    union all

    select
      'price_items'::text as table_name,
      pi.id as record_id,
      pi.name as label,
      coalesce(pi.description, pi.unit) as detail,
      pi.deleted_at,
      pi.deleted_by
    from public.price_items pi
    where pi.deleted_at is not null
  ) as items
  left join public.people actor on actor.id = items.deleted_by
  order by items.deleted_at desc;
end;
$$;

-- Seed default BITA price list items (safe to run multiple times)
insert into public.price_items (id, name, description, sac, unit, default_rate, active)
values
  ('00000000-0000-0000-0000-000000000301', 'UT service', 'Ultrasonic Testing (UT) inspection charges', '998346', 'nos', 7500.00, true),
  ('00000000-0000-0000-0000-000000000302', 'MT service', 'Magnetic Particle Testing (MPT) inspection charges', '998346', 'nos', 5500.00, true),
  ('00000000-0000-0000-0000-000000000303', 'DPT service', 'Dye Penetrant Testing (DPT) inspection charges', '998346', 'nos', 4500.00, true),
  ('00000000-0000-0000-0000-000000000304', 'Conveyance', 'Site visit and conveyance charges', '998346', 'visit', 4000.00, true),
  ('00000000-0000-0000-0000-000000000305', 'Hardness testing', 'Portable hardness testing charges', '998346', 'nos', 6000.00, true),
  ('00000000-0000-0000-0000-000000000306', 'Visual inspection', 'Visual Testing (VT) inspection charges', '998346', 'nos', 3500.00, true)
on conflict (id) do nothing;
