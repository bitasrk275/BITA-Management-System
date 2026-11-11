-- Supabase security advisor: public.check_equipment_conflict was SECURITY DEFINER and callable by any
-- signed-in user, so it bypassed row level security on assignments and jobs. The calendar only needs it
-- for office staff, who can read those tables anyway, so it now runs with the caller's own rights.

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
security invoker
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
