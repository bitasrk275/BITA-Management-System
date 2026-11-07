-- 20261107000000_report_edits_and_photos.sql
-- Phase 2 / A1: Technician edits after submit + office chooses photos

-- 1. attachments: include_in_report flag (office ticks which attachments go into the report)
alter table public.attachments
  add column if not exists include_in_report boolean not null default true;

create index if not exists attachments_report_include_idx
  on public.attachments (report_id, include_in_report);

-- 2. inspection_edits: records changes made by technicians to submitted reports before approval
create table if not exists public.inspection_edits (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  inspection_id uuid references public.inspections (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  edited_by uuid not null references public.people (id),
  edited_at timestamptz not null default now(),
  old_readings jsonb not null default '{}'::jsonb,
  new_readings jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  old_observations text,
  new_observations text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.people (id)
);

create index if not exists inspection_edits_job_idx
  on public.inspection_edits (job_id);

create index if not exists inspection_edits_inspection_idx
  on public.inspection_edits (inspection_id);

create index if not exists inspection_edits_edited_at_idx
  on public.inspection_edits (edited_at desc);

-- Enable RLS
alter table public.inspection_edits enable row level security;

-- Authenticated staff (management, office, reviewer) can read inspection edits
create policy staff_read_inspection_edits on public.inspection_edits
  for select to authenticated
  using (
    exists (
      select 1 from public.people p
      where p.id = auth.uid()
        and p.active = true
        and (
          'management' = any(p.roles) or
          'office' = any(p.roles) or
          'reviewer' = any(p.roles)
        )
    )
  );

-- Authenticated staff can update inspection edits (e.g. mark reviewed)
create policy staff_update_inspection_edits on public.inspection_edits
  for update to authenticated
  using (
    exists (
      select 1 from public.people p
      where p.id = auth.uid()
        and p.active = true
        and (
          'management' = any(p.roles) or
          'office' = any(p.roles)
        )
    )
  );

-- Authenticated technicians can read their own assignment edits
create policy technician_read_inspection_edits on public.inspection_edits
  for select to authenticated
  using (
    exists (
      select 1 from public.assignments a
      where a.id = inspection_edits.assignment_id
        and a.person_id = auth.uid()
    )
  );
