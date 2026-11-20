-- Migration: 20261120000000_leave_requests_and_job_notes.sql
-- Description: Leave requests table, job notes table, and attachments kind expansion (Round 3 Task R3-4)

-- 1. Add 'note' to technician_message_kind enum if not present
alter type public.technician_message_kind add value if not exists 'note';

-- 2. Allow 'site_file' in attachments table
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (
  kind in ('site_photo', 'defect_photo', 'drawing', 'purchase_order', 'supporting_document', 'other', 'site_file')
);

-- 3. Leave requests table (technicians apply via phone, office approves/rejects)
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.people(id),
  review_note text,
  created_at timestamptz not null default now(),
  constraint leave_requests_date_range_check check (end_date >= start_date)
);

create index if not exists leave_requests_person_idx on public.leave_requests(person_id);
create index if not exists leave_requests_status_idx on public.leave_requests(status);
create index if not exists leave_requests_dates_idx on public.leave_requests(start_date, end_date);

alter table public.leave_requests enable row level security;

-- Staff can view all leave requests; technicians can view their own
create policy "leave_requests_select" on public.leave_requests
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
        and p.id = leave_requests.person_id
    )
  );

-- Staff and technicians can insert leave requests
create policy "leave_requests_insert" on public.leave_requests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (
          p.roles && array['management', 'office']::public.app_role[]
          or p.id = leave_requests.person_id
        )
    )
  );

-- Office and management can update status, reviewed_at, reviewed_by, review_note
create policy "leave_requests_update" on public.leave_requests
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

-- 4. Job notes table (notes and comments per job visible between field & office)
create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  person_id uuid references public.people(id),
  author_name text,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists job_notes_job_idx on public.job_notes(job_id);
create index if not exists job_notes_assignment_idx on public.job_notes(assignment_id);

alter table public.job_notes enable row level security;

-- Staff can view all job notes; technicians can view notes for their assigned jobs
create policy "job_notes_select" on public.job_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (p.roles && array['management', 'office', 'reviewer']::public.app_role[])
    )
    or exists (
      select 1 from public.assignments a
      join public.people p on p.id = a.person_id
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and a.job_id = job_notes.job_id
    )
  );

-- Staff and technicians can insert notes on jobs
create policy "job_notes_insert" on public.job_notes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.people p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and (
          p.roles && array['management', 'office']::public.app_role[]
          or exists (
            select 1 from public.assignments a
            where a.person_id = p.id and a.job_id = job_notes.job_id
          )
        )
    )
  );
