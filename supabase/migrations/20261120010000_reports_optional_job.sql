-- Round 3 (BITA review, 20 Nov): a report can be created on its own and linked to a job later.
-- Only relaxes NOT NULL on reports.job_id. Approval, sending and invoicing still require a job (checked in the app).
alter table public.reports alter column job_id drop not null;
