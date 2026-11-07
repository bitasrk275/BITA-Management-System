-- Phase 2 Foundation (P1):
-- 1. Settings tables: public.settings (key-value JSONB) and public.settings_options (dropdown lists).
-- 2. Permission check helper private.has_permission(perm) & private.can_delete() backed by public.settings.
-- 3. Soft delete (deleted_at, deleted_by) on customers, enquiries, quotations, jobs, people, equipment,
--    with RLS hiding soft-deleted rows from normal selects, audit triggers on all lists, and
--    helper RPC functions (soft_delete_record, restore_record, list_recycle_bin).

-- ---------------------------------------------------------------------------
-- 1. Settings tables (Rule 3: Settings, not code)
-- ---------------------------------------------------------------------------

create table public.settings (
  id uuid not null default gen_random_uuid() unique,
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id)
);

create table public.settings_options (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  value text not null,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (list_key, value)
);

create index settings_options_list_idx on public.settings_options (list_key, position);

alter table public.settings enable row level security;
alter table public.settings_options enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Soft delete columns on customers, enquiries, quotations, jobs, people, equipment
-- ---------------------------------------------------------------------------

alter table public.customers
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

alter table public.enquiries
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

alter table public.quotations
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

alter table public.jobs
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

alter table public.people
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

alter table public.equipment
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.people (id);

create index customers_deleted_at_idx on public.customers (deleted_at) where deleted_at is not null;
create index enquiries_deleted_at_idx on public.enquiries (deleted_at) where deleted_at is not null;
create index quotations_deleted_at_idx on public.quotations (deleted_at) where deleted_at is not null;
create index jobs_deleted_at_idx on public.jobs (deleted_at) where deleted_at is not null;
create index people_deleted_at_idx on public.people (deleted_at) where deleted_at is not null;
create index equipment_deleted_at_idx on public.equipment (deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Permissions helper backed by public.settings ('permissions' key)
-- ---------------------------------------------------------------------------

create function private.has_permission(perm text) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare
  user_roles public.app_role[];
  allowed_roles jsonb;
begin
  select roles into user_roles from public.people where user_id = auth.uid() and active and deleted_at is null;
  if user_roles is null then
    return false;
  end if;

  select value -> perm into allowed_roles from public.settings where key = 'permissions';
  if allowed_roles is null or jsonb_typeof(allowed_roles) <> 'array' then
    -- Default when settings row is absent: only management has elevated permission
    return 'management'::public.app_role = any(user_roles);
  end if;

  return exists (
    select 1
    from unnest(user_roles) as r
    where allowed_roles ? (r::text)
  );
end;
$$;

create function private.can_delete() returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.has_permission('delete');
$$;

create function private.include_deleted() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(current_setting('app.include_deleted', true), '') = 'true'
     and private.is_staff();
$$;

revoke all on function private.has_permission(text), private.can_delete(), private.include_deleted() from public, anon;
grant execute on function private.has_permission(text), private.can_delete(), private.include_deleted() to authenticated, service_role;

-- RLS on settings and settings_options
create policy staff_read on public.settings for select to authenticated
  using (private.is_staff());
create policy management_write on public.settings for all to authenticated
  using (private.has_role('management'))
  with check (private.has_role('management'));

create policy authenticated_read on public.settings_options for select to authenticated
  using (private.is_staff() or private.has_role('technician'));
create policy management_write on public.settings_options for all to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));

-- Update role helpers so soft-deleted people have no active permissions
create or replace function private.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.people
    where user_id = auth.uid() and active and deleted_at is null and r = any (roles)
  );
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.people
    where user_id = auth.uid()
      and active
      and deleted_at is null
      and roles && array['management', 'office', 'reviewer']::public.app_role[]
  );
$$;

create or replace function private.person_has_role(p uuid, r public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.people
    where id = p and active and deleted_at is null and r = any (roles)
  );
$$;

create or replace function private.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() and active and deleted_at is null;
$$;

-- Trigger enforcing soft-delete and restore permissions and setting deleted_by
create function private.soft_delete() returns trigger
language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      raise exception 'Cannot insert an already deleted record';
    end if;
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if auth.uid() is not null and not private.can_delete() then
      raise exception 'Only management can delete or restore records';
    end if;

    if new.deleted_at is not null then
      new.deleted_by := coalesce(new.deleted_by, private.my_person_id());
    else
      new.deleted_by := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.soft_delete() from public, anon;
grant execute on function private.soft_delete() to authenticated, service_role;

create trigger soft_delete_customers before insert or update on public.customers
  for each row execute function private.soft_delete();
create trigger soft_delete_enquiries before insert or update on public.enquiries
  for each row execute function private.soft_delete();
create trigger soft_delete_quotations before insert or update on public.quotations
  for each row execute function private.soft_delete();
create trigger soft_delete_jobs before insert or update on public.jobs
  for each row execute function private.soft_delete();
create trigger soft_delete_people before insert or update on public.people
  for each row execute function private.soft_delete();
create trigger soft_delete_equipment before insert or update on public.equipment
  for each row execute function private.soft_delete();

-- Ensure every list logs changes to audit_log (Rule 2)
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function private.audit_row();
create trigger audit_customer_contacts after insert or update or delete on public.customer_contacts
  for each row execute function private.audit_row();
create trigger audit_enquiries after insert or update or delete on public.enquiries
  for each row execute function private.audit_row();
create trigger audit_people after insert or update or delete on public.people
  for each row execute function private.audit_row();
create trigger audit_equipment after insert or update or delete on public.equipment
  for each row execute function private.audit_row();
create trigger audit_settings after insert or update or delete on public.settings
  for each row execute function private.audit_row();
create trigger audit_settings_options after insert or update or delete on public.settings_options
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- 4. Update RLS policies on the 6 soft-delete tables so normal SELECTs hide deleted rows
-- ---------------------------------------------------------------------------

-- people
drop policy if exists staff_read on public.people;
drop policy if exists technician_read_self on public.people;
drop policy if exists management_write on public.people;

create policy staff_read on public.people for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy technician_read_self on public.people for select to authenticated
  using (user_id = auth.uid() and deleted_at is null);
create policy management_insert on public.people for insert to authenticated
  with check (private.has_role('management') and deleted_at is null);
create policy management_update on public.people for update to authenticated
  using (private.has_role('management') or private.can_delete())
  with check (private.has_role('management') or private.can_delete());
create policy management_delete on public.people for delete to authenticated
  using (private.can_delete());

-- equipment
drop policy if exists staff_read on public.equipment;
drop policy if exists technician_read_equipment on public.equipment;
drop policy if exists management_write on public.equipment;

create policy staff_read on public.equipment for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy technician_read_equipment on public.equipment for select to authenticated
  using (private.has_role('technician') and deleted_at is null);
create policy management_insert on public.equipment for insert to authenticated
  with check (private.has_role('management') and deleted_at is null);
create policy management_update on public.equipment for update to authenticated
  using (private.has_role('management') or private.can_delete())
  with check (private.has_role('management') or private.can_delete());
create policy management_delete on public.equipment for delete to authenticated
  using (private.can_delete());

-- customers
drop policy if exists staff_read on public.customers;
drop policy if exists technician_read_customers on public.customers;
drop policy if exists office_write on public.customers;

create policy staff_read on public.customers for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy technician_read_customers on public.customers for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.jobs j
      where j.customer_id = customers.id
        and j.deleted_at is null
        and private.is_assigned_to_job(j.id::text)
    )
  );
create policy office_insert on public.customers for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);
create policy office_update on public.customers for update to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));
create policy office_delete on public.customers for delete to authenticated
  using (private.can_delete());

-- enquiries
drop policy if exists staff_read on public.enquiries;
drop policy if exists office_write on public.enquiries;

create policy staff_read on public.enquiries for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy office_insert on public.enquiries for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);
create policy office_update on public.enquiries for update to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));
create policy office_delete on public.enquiries for delete to authenticated
  using (private.can_delete());

-- quotations
drop policy if exists staff_read on public.quotations;
drop policy if exists office_write on public.quotations;

create policy staff_read on public.quotations for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy office_insert on public.quotations for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);
create policy office_update on public.quotations for update to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));
create policy office_delete on public.quotations for delete to authenticated
  using (private.can_delete());

-- jobs
drop policy if exists staff_read on public.jobs;
drop policy if exists technician_read_jobs on public.jobs;
drop policy if exists office_write on public.jobs;

create policy staff_read on public.jobs for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));
create policy technician_read_jobs on public.jobs for select to authenticated
  using (deleted_at is null and private.is_assigned_to_job(id::text));
create policy office_insert on public.jobs for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);
create policy office_update on public.jobs for update to authenticated
  using (private.has_role('management') or private.has_role('office'))
  with check (private.has_role('management') or private.has_role('office'));
create policy office_delete on public.jobs for delete to authenticated
  using (private.can_delete());

-- ---------------------------------------------------------------------------
-- 5. Recycle bin RPC functions (soft_delete_record, restore_record, list_recycle_bin)
-- ---------------------------------------------------------------------------

create function public.soft_delete_record(p_table text, p_id uuid) returns void
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
    else
      raise exception 'Unsupported soft-delete table: %', p_table;
  end case;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Record not found or already deleted';
  end if;
end;
$$;

create function public.restore_record(p_table text, p_id uuid) returns void
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
    else
      raise exception 'Unsupported restore table: %', p_table;
  end case;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Deleted record not found';
  end if;
end;
$$;

create function public.list_recycle_bin()
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
      coalesce(nullif(concat_ws(' ', eq.make, eq.model), ''), eq.kind::text) as label,
      coalesce(eq.serial_no, eq.kind::text) as detail,
      eq.deleted_at,
      eq.deleted_by
    from public.equipment eq
    where eq.deleted_at is not null
  ) items
  left join public.people actor on actor.id = items.deleted_by
  order by items.deleted_at desc;
end;
$$;

revoke all on function public.soft_delete_record(text, uuid), public.restore_record(text, uuid), public.list_recycle_bin() from public, anon;
grant execute on function public.soft_delete_record(text, uuid), public.restore_record(text, uuid), public.list_recycle_bin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed default settings and dropdown options
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description)
values
  (
    'permissions',
    '{"delete": ["management"], "view_salaries": ["management"], "approve_reports": ["reviewer", "management"], "issue_invoices": ["management", "office"]}'::jsonb,
    'Role permissions matrix for deleting records, viewing salaries, approving reports, and issuing invoices'
  ),
  (
    'invoice_numbering',
    '{"tax_prefix": "INV-", "next_tax_invoice_no": 1, "proforma_prefix": "PI-", "next_proforma_no": 1, "credit_note_prefix": "CN-", "next_credit_note_no": 1}'::jsonb,
    'Numbering series prefixes and starting sequence numbers for tax invoices, proforma invoices, and credit notes'
  ),
  (
    'reminder_timings',
    '{"days_before_due": 2, "on_due_date": true, "overdue_start_day": 5, "calibration_days_before_due": 14}'::jsonb,
    'Timing rules for unpaid tax invoice email reminders and equipment calibration alerts'
  ),
  (
    'holidays',
    '{"dates": []}'::jsonb,
    'BITA holiday dates (YYYY-MM-DD); Sundays are always off'
  )
on conflict (key) do nothing;

insert into public.settings_options (list_key, value, position, active)
values
  ('equipment_type', 'UT flaw detector', 1, true),
  ('equipment_type', 'UT probe', 2, true),
  ('equipment_type', 'Calibration block', 3, true),
  ('equipment_type', 'MT yoke', 4, true),
  ('equipment_type', 'Thickness gauge', 5, true),
  ('equipment_type', 'Hardness tester', 6, true),
  ('couplant', 'Oil', 1, true),
  ('couplant', 'Grease', 2, true),
  ('couplant', 'Water', 3, true),
  ('couplant', 'Glycerin', 4, true),
  ('surface_condition', 'As welded', 1, true),
  ('surface_condition', 'Ground flush', 2, true),
  ('surface_condition', 'Machined', 3, true),
  ('surface_condition', 'Shot blasted', 4, true)
on conflict (list_key, value) do nothing;
