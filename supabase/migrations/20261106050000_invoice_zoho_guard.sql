-- Invoices are now made in the app (D-017). zoho_id is kept only for old mirrored rows.
-- A row with zoho_id skips the "issuing" checks, so logged-in users must not set or change it.
-- Server jobs (service role, no auth.uid()) may still write it.

create function private.guard_invoice_zoho_id() returns trigger
language plpgsql set search_path = public, private as $$
begin
  if auth.uid() is not null
     and new.zoho_id is distinct from (case when tg_op = 'UPDATE' then old.zoho_id end) then
    raise exception 'zoho_id can only be set by the server';
  end if;
  return new;
end;
$$;

create trigger invoices_guard_zoho_id
  before insert or update on public.invoices
  for each row execute function private.guard_invoice_zoho_id();

revoke all on function private.guard_invoice_zoho_id() from public, anon;
grant execute on function private.guard_invoice_zoho_id() to authenticated, service_role;
