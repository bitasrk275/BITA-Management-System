-- ===========================================================================
-- Migration: 20261107030000_equipment_register_v2.sql
-- Description: Phase 2 Equipment Register v2 (Task A2)
--   - equipment_types table (UT flaw detector, probe, block, MT yoke, thickness gauge, hardness tester, etc.)
--   - equipment columns: equipment_type_id, status (in_office, at_site, out_for_calibration),
--     current_location, current_job_id
--   - equipment_movements table with delivery challan no and file path
--   - soft delete and recycle bin support for equipment_types
--   - RLS policies for equipment_types and equipment_movements
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. equipment_types table
-- ---------------------------------------------------------------------------

create table if not exists public.equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.people(id)
);

create index if not exists equipment_types_active_idx on public.equipment_types (name) where deleted_at is null;

-- Seed default equipment types
insert into public.equipment_types (name, description)
values
  ('UT flaw detector', 'Ultrasonic flaw detectors'),
  ('UT probe', 'Normal and angle beam probes'),
  ('Calibration block', 'V1, V2, step wedge and reference blocks'),
  ('MT yoke', 'Magnetic particle inspection yokes'),
  ('Thickness gauge', 'Ultrasonic thickness gauges'),
  ('Hardness tester', 'Portable hardness testers')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Alter public.equipment for v2 fields
-- ---------------------------------------------------------------------------

-- Relax the old equipment_kind not null constraint so new equipment types work
alter table public.equipment alter column kind drop not null;

-- Reference to equipment_types
alter table public.equipment add column if not exists equipment_type_id uuid references public.equipment_types(id);

-- Operational status
alter table public.equipment add column if not exists status text not null default 'in_office'
  check (status in ('in_office', 'at_site', 'out_for_calibration'));

-- Current physical location
alter table public.equipment add column if not exists current_location text default 'In office';

-- Current job if deployed at site
alter table public.equipment add column if not exists current_job_id uuid references public.jobs(id) on delete set null;

-- Backfill equipment_type_id for existing equipment rows based on enum kind
update public.equipment e
set equipment_type_id = et.id
from public.equipment_types et
where e.equipment_type_id is null
  and (
    (e.kind = 'ut_flaw_detector' and et.name = 'UT flaw detector')
    or (e.kind = 'mpi_yoke' and et.name = 'MT yoke')
  );

create index if not exists equipment_type_id_idx on public.equipment(equipment_type_id);
create index if not exists equipment_status_idx on public.equipment(status);
create index if not exists equipment_current_job_idx on public.equipment(current_job_id);

-- Update RLS on equipment to permit office staff to insert and update equipment (Rule 2 / Settings default)
drop policy if exists management_insert on public.equipment;
create policy staff_insert_equipment on public.equipment for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);

drop policy if exists management_update on public.equipment;
create policy staff_update_equipment on public.equipment for update to authenticated
  using (private.has_role('management') or private.has_role('office') or private.can_delete())
  with check (private.has_role('management') or private.has_role('office') or private.can_delete());

-- ---------------------------------------------------------------------------
-- 3. equipment_movements table (Movement log with delivery challans)
-- ---------------------------------------------------------------------------

create table if not exists public.equipment_movements (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  delivery_challan_no text,
  delivery_challan_path text,
  from_location text,
  to_location text not null,
  status text not null check (status in ('in_office', 'at_site', 'out_for_calibration')),
  moved_on date not null default current_date,
  moved_by uuid references public.people(id),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists equipment_movements_equipment_idx on public.equipment_movements(equipment_id, moved_on desc);
create index if not exists equipment_movements_job_idx on public.equipment_movements(job_id);

-- ---------------------------------------------------------------------------
-- 4. RLS Policies
-- ---------------------------------------------------------------------------

alter table public.equipment_types enable row level security;
alter table public.equipment_movements enable row level security;

-- equipment_types policies
create policy equipment_types_select on public.equipment_types
  for select to authenticated
  using (
    deleted_at is null
    or private.has_role('management')
  );

create policy equipment_types_insert on public.equipment_types
  for insert to authenticated
  with check (
    private.has_role('management')
    or private.has_role('office')
  );

create policy equipment_types_update on public.equipment_types
  for update to authenticated
  using (
    private.has_role('management')
    or private.has_role('office')
  );

create policy equipment_types_delete on public.equipment_types
  for delete to authenticated
  using (
    private.has_role('management')
  );

-- equipment_movements policies
create policy equipment_movements_select on public.equipment_movements
  for select to authenticated
  using (
    private.has_role('management')
    or private.has_role('office')
    or private.has_role('reviewer')
    or (
      private.has_role('technician')
      and job_id is not null
      and exists (
        select 1 from public.assignments a
        where a.job_id = equipment_movements.job_id
          and a.person_id = private.my_person_id()
      )
    )
  );

create policy equipment_movements_insert on public.equipment_movements
  for insert to authenticated
  with check (
    private.has_role('management')
    or private.has_role('office')
  );

create policy equipment_movements_update on public.equipment_movements
  for update to authenticated
  using (
    private.has_role('management')
    or private.has_role('office')
  );

create policy equipment_movements_delete on public.equipment_movements
  for delete to authenticated
  using (
    private.has_role('management')
  );

-- ---------------------------------------------------------------------------
-- 5. Extend recycle bin RPCs for equipment_types
-- ---------------------------------------------------------------------------

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
    when 'equipment_types' then
      update public.equipment_types set deleted_at = now(), deleted_by = private.my_person_id()
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
    when 'equipment_types' then
      update public.equipment_types set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null;
    else
      raise exception 'Unsupported restore table: %', p_table;
  end case;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Record not found in recycle bin';
  end if;
end;
$$;

drop function if exists public.list_recycle_bin();
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
      coalesce(nullif(e.subject, ''), '(no subject)') as label,
      e.source || ' · ' || e.status as detail,
      e.deleted_at,
      e.deleted_by
    from public.enquiries e
    where e.deleted_at is not null

    union all

    select
      'quotations'::text as table_name,
      q.id as record_id,
      q.ref_no as label,
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
      j.status::text as detail,
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
      coalesce(nullif(concat_ws(' ', eq.make, eq.model), ''), eq.serial_no, 'Equipment') as label,
      coalesce(eq.serial_no, eq.status) as detail,
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

    union all

    select
      'equipment_types'::text as table_name,
      et.id as record_id,
      et.name as label,
      coalesce(et.description, 'Equipment type') as detail,
      et.deleted_at,
      et.deleted_by
    from public.equipment_types et
    where et.deleted_at is not null
  ) items
  left join public.people actor on actor.id = items.deleted_by
  order by items.deleted_at desc;
end;
$$;

revoke all on function public.list_recycle_bin() from public, anon;
grant execute on function public.list_recycle_bin() to authenticated, service_role;

