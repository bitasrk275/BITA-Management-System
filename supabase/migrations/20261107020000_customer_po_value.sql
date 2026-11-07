-- Phase 2 (P2): Customer PO value on jobs + non-negative check constraint.
-- Allows recording PO number, date, value, and file when a quotation is accepted or on the job page,
-- and warning when invoices against a PO exceed its value.

alter table public.jobs
  add column po_value numeric(14, 2) check (po_value is null or po_value >= 0);
