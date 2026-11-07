-- Migration: 20261107060000_calendar_and_leave.sql
-- Description: Leave days, multi-day assignment date ranges, and equipment booking conflict detection (Phase 2 Task A3)

-- 1. Leave days table
create table if not exists public.leave_days (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  leave_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint leave_days_person_date_uniq unique (person_id, leave_date)
);

create index if not exists leave_days_person_date_idx on public.leave_days(person_id, leave_date);
create index if not exists leave_days_date_idx on public.leave_days(leave_date);

alter table public.leave_days enable row level security;

-- Staff can view all leave days; technicians can view their own
create policy "leave_days_staff_select" on public.leave_days
  for select to authenticated
  using (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office', 'reviewer']::public.app_role[])
    )
    or exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and p.id = leave_days.person_id
    )
  );

-- Office and management can insert leave days
create policy "leave_days_staff_insert" on public.leave_days
  for insert to authenticated
  with check (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office']::public.app_role[])
    )
  );

-- Office and management can update leave days
create policy "leave_days_staff_update" on public.leave_days
  for update to authenticated
  using (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office']::public.app_role[])
    )
  )
  with check (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office']::public.app_role[])
    )
  );

-- Office and management can delete leave days
create policy "leave_days_staff_delete" on public.leave_days
  for delete to authenticated
  using (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office']::public.app_role[])
    )
  );

-- 2. Multi-day assignments (end_date)
alter table public.assignments
  add column if not exists end_date date;

comment on column public.assignments.end_date is 'Optional end date for multi-day jobs; defaults to work_date if null';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assignments_end_date_check'
  ) then
    alter table public.assignments
      add constraint assignments_end_date_check
      check (end_date is null or end_date >= work_date);
  end if;
end $$;

create index if not exists assignments_work_date_end_date_idx on public.assignments(work_date, end_date);

-- 3. Equipment conflict detection function
create or replace function public.check_equipment_conflict(
  p_equipment_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_assignment_id uuid default null
)
returns table (
  conflict_assignment_id uuid,
  conflict_job_id uuid,
  conflict_job_no text,
  conflict_start_date date,
  conflict_end_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id as conflict_assignment_id,
    j.id as conflict_job_id,
    j.job_no as conflict_job_no,
    a.work_date as conflict_start_date,
    coalesce(a.end_date, a.work_date) as conflict_end_date
  from public.assignment_equipment ae
  join public.assignments a on a.id = ae.assignment_id
  join public.jobs j on j.id = a.job_id
  where ae.equipment_id = p_equipment_id
    and (p_exclude_assignment_id is null or a.id <> p_exclude_assignment_id)
    and j.status not in ('closed')
    and greatest(a.work_date, p_start_date) <= least(coalesce(a.end_date, a.work_date), p_end_date)
  limit 1;
$$;
