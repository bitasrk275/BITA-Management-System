-- ===========================================================================
-- Migration: 20261107070000_log_book_employees_equipment_guard.sql
-- Description: Phase 2 Tasks A4, A5, A6
--   - A4: Log book (log_book_entries synced via trigger on assignments, job_expenses)
--   - A5: Employee register (people.monthly_salary, people.per_job_allowance)
--   - A6: Equipment on reports + expired calibration approval guard
--         (reports.calibration_override_note, reports.calibration_override_by,
--          check_report() calibration guard, revoke public/anon on check_equipment_conflict)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Task A4: Log book entries and job expenses
-- ---------------------------------------------------------------------------

create table if not exists public.log_book_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid unique references public.assignments(id) on delete set null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  work_date date not null,
  end_date date,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  notes text,
  deleted_at timestamptz,
  deleted_by uuid references public.people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists log_book_entries_job_idx on public.log_book_entries(job_id);
create index if not exists log_book_entries_person_date_idx on public.log_book_entries(person_id, work_date desc);
create index if not exists log_book_entries_work_date_idx on public.log_book_entries(work_date desc);

create table if not exists public.job_expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  log_book_id uuid references public.log_book_entries(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  expense_date date not null default current_date,
  kind text not null default 'travel' check (kind in ('travel', 'food', 'lodging', 'consumables', 'other')),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  note text,
  created_by uuid references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

create index if not exists job_expenses_job_idx on public.job_expenses(job_id);
create index if not exists job_expenses_log_book_idx on public.job_expenses(log_book_id);
create index if not exists job_expenses_date_idx on public.job_expenses(expense_date desc);

alter table public.log_book_entries enable row level security;
alter table public.job_expenses enable row level security;

grant select, insert, update, delete on public.log_book_entries to authenticated, service_role;
grant select, insert, update, delete on public.job_expenses to authenticated, service_role;

-- RLS on log_book_entries: staff only (technicians cannot see office log book / expenses)
drop policy if exists log_book_entries_staff_select on public.log_book_entries;
create policy log_book_entries_staff_select on public.log_book_entries
  for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));

drop policy if exists log_book_entries_staff_insert on public.log_book_entries;
create policy log_book_entries_staff_insert on public.log_book_entries
  for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);

drop policy if exists log_book_entries_staff_update on public.log_book_entries;
create policy log_book_entries_staff_update on public.log_book_entries
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());

drop policy if exists log_book_entries_staff_delete on public.log_book_entries;
create policy log_book_entries_staff_delete on public.log_book_entries
  for delete to authenticated
  using (private.can_delete());

-- RLS on job_expenses: staff only (technicians cannot see office expenses)
drop policy if exists job_expenses_staff_select on public.job_expenses;
create policy job_expenses_staff_select on public.job_expenses
  for select to authenticated
  using (private.is_staff() and (deleted_at is null or private.include_deleted()));

drop policy if exists job_expenses_staff_insert on public.job_expenses;
create policy job_expenses_staff_insert on public.job_expenses
  for insert to authenticated
  with check ((private.has_role('management') or private.has_role('office')) and deleted_at is null);

drop policy if exists job_expenses_staff_update on public.job_expenses;
create policy job_expenses_staff_update on public.job_expenses
  for update to authenticated
  using (private.has_role('management') or private.has_role('office') or private.can_delete())
  with check (private.has_role('management') or private.has_role('office') or private.can_delete());

drop policy if exists job_expenses_staff_delete on public.job_expenses;
create policy job_expenses_staff_delete on public.job_expenses
  for delete to authenticated
  using (private.has_role('management') or private.has_role('office') or private.can_delete());

-- Soft delete & audit triggers for log_book_entries and job_expenses
drop trigger if exists soft_delete_log_book_entries on public.log_book_entries;
create trigger soft_delete_log_book_entries
  before insert or update on public.log_book_entries
  for each row execute function private.soft_delete();

drop trigger if exists soft_delete_job_expenses on public.job_expenses;
create trigger soft_delete_job_expenses
  before insert or update on public.job_expenses
  for each row execute function private.soft_delete();

drop trigger if exists audit_log_book_entries on public.log_book_entries;
create trigger audit_log_book_entries
  after insert or update or delete on public.log_book_entries
  for each row execute function private.audit_row();

drop trigger if exists audit_job_expenses on public.job_expenses;
create trigger audit_job_expenses
  after insert or update or delete on public.job_expenses
  for each row execute function private.audit_row();

-- Trigger on assignments to sync log_book_entries automatically:
-- Note: uses BEFORE DELETE for delete so assignment_id is still set when marking status = 'cancelled',
-- and AFTER INSERT OR UPDATE for upserting scheduled/completed entries.
create or replace function private.sync_log_book_from_assignment() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    update public.log_book_entries
    set status = 'cancelled',
        assignment_id = null,
        updated_at = now()
    where assignment_id = old.id;
    return old;
  end if;

  v_status := case when new.completed_at is not null then 'completed' else 'scheduled' end;

  insert into public.log_book_entries (
    assignment_id,
    job_id,
    person_id,
    work_date,
    end_date,
    status,
    notes,
    updated_at
  )
  values (
    new.id,
    new.job_id,
    new.person_id,
    new.work_date,
    new.end_date,
    v_status,
    new.notes,
    now()
  )
  on conflict (assignment_id) do update
  set job_id = excluded.job_id,
      person_id = excluded.person_id,
      work_date = excluded.work_date,
      end_date = excluded.end_date,
      status = case
        when excluded.status = 'completed' then 'completed'
        when public.log_book_entries.status = 'cancelled' then 'scheduled'
        else excluded.status
      end,
      notes = coalesce(excluded.notes, public.log_book_entries.notes),
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_log_book_from_assignment() from public, anon;
grant execute on function private.sync_log_book_from_assignment() to authenticated, service_role;

drop trigger if exists assignments_sync_log_book_upsert on public.assignments;
create trigger assignments_sync_log_book_upsert
  after insert or update on public.assignments
  for each row execute function private.sync_log_book_from_assignment();

drop trigger if exists assignments_sync_log_book_delete on public.assignments;
create trigger assignments_sync_log_book_delete
  before delete on public.assignments
  for each row execute function private.sync_log_book_from_assignment();

-- Backfill log_book_entries from existing assignments
insert into public.log_book_entries (
  assignment_id,
  job_id,
  person_id,
  work_date,
  end_date,
  status,
  notes,
  created_at,
  updated_at
)
select
  a.id,
  a.job_id,
  a.person_id,
  a.work_date,
  a.end_date,
  case when a.completed_at is not null then 'completed' else 'scheduled' end,
  a.notes,
  a.created_at,
  now()
from public.assignments a
on conflict (assignment_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Task A5: Employee register columns on public.people
-- ---------------------------------------------------------------------------

alter table public.people
  add column if not exists monthly_salary numeric(12,2) check (monthly_salary is null or monthly_salary >= 0),
  add column if not exists per_job_allowance numeric(12,2) check (per_job_allowance is null or per_job_allowance >= 0);

-- ---------------------------------------------------------------------------
-- 3. Task A6: Equipment on reports + expired calibration approval guard
-- ---------------------------------------------------------------------------

alter table public.reports
  add column if not exists calibration_override_note text,
  add column if not exists calibration_override_by uuid references public.people(id);

-- Revoke public/anon execute on check_equipment_conflict (security advisor fix)
revoke all on function public.check_equipment_conflict(uuid, date, date, uuid) from public, anon;
grant execute on function public.check_equipment_conflict(uuid, date, date, uuid) to authenticated, service_role;

-- Update private.check_report() to enforce expired-calibration block unless calibration_override_note is provided
create or replace function private.check_report() returns trigger
language plpgsql set search_path = public, private as $$
declare
  insp record;
  expired_eq record;
  approving boolean := new.approved_at is not null
    and (tg_op = 'INSERT' or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by);
begin
  if new.inspection_id is not null then
    select submitted_at, missing_fields into insp from public.inspections where id = new.inspection_id;
    if insp.submitted_at is null then
      raise exception 'Field data for this report has not been submitted';
    end if;
    if cardinality(insp.missing_fields) > 0 then
      raise exception 'Mandatory readings missing: %', array_to_string(insp.missing_fields, ', ');
    end if;
  end if;

  if new.status in ('approved', 'sent') and new.approved_at is null then
    raise exception 'Report % must be approved before it is %', new.report_no, new.status;
  end if;

  if new.approved_at is not null and not (person_has_role(new.approved_by, 'reviewer') or person_has_role(new.approved_by, 'management')) then
    raise exception 'Only a technical reviewer can approve a report';
  end if;

  -- A logged-in user can approve only as themselves.
  if approving and auth.uid() is not null and new.approved_by is distinct from my_person_id() then
    raise exception 'You can approve a report only as yourself';
  end if;

  -- Task A6: Check if any equipment booked for this job had expired calibration (calibration_due < work_date)
  if approving then
    select
      e.id,
      coalesce(nullif(concat_ws(' ', e.make, e.model), ''), e.serial_no, 'Instrument') as eq_label,
      e.serial_no,
      e.calibration_due,
      a.work_date
    into expired_eq
    from public.assignments a
    join public.assignment_equipment ae on ae.assignment_id = a.id
    join public.equipment e on e.id = ae.equipment_id
    where a.job_id = new.job_id
      and e.calibration_due is not null
      and e.calibration_due < a.work_date
    order by e.calibration_due asc
    limit 1;

    if expired_eq.id is not null then
      if new.calibration_override_note is null or btrim(new.calibration_override_note) = '' then
        raise exception 'Equipment % (due %) had expired calibration on work date %. Enter a calibration override note to approve this report.',
          expired_eq.eq_label, expired_eq.calibration_due, expired_eq.work_date;
      end if;
      if new.calibration_override_by is null then
        new.calibration_override_by := coalesce(new.approved_by, my_person_id());
      end if;
    end if;
  end if;

  -- An approved report is frozen; return it first to change its content.
  if tg_op = 'UPDATE' and old.approved_at is not null and new.approved_at is not null and auth.uid() is not null
     and (new.content, new.method, new.report_no, new.inspection_id) is distinct from (old.content, old.method, old.report_no, old.inspection_id) then
    raise exception 'An approved report cannot be edited; return it to the technician first';
  end if;

  -- Only a reviewer or management can withdraw an approval (return a report).
  if tg_op = 'UPDATE' and old.approved_at is not null and new.approved_at is null and auth.uid() is not null
     and not (has_role('reviewer') or has_role('management')) then
    raise exception 'Only a technical reviewer can return an approved report';
  end if;

  return new;
end;
$$;
