-- Forward retention guard: issued documents are corrected, never overwritten.
create or replace function private.guard_invoice_issue()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.issued_snapshot_id is not null and exists(select 1 from public.organizations where id=old.org_id) then raise exception 'Issued invoice must be retained'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if current_user='authenticated' and (new.status<>'draft' or new.issued_snapshot_id is not null) then raise exception 'New invoice must be draft'; end if;
    new.version:=1;
  else
    if old.issued_snapshot_id is not null and new.status='cancelled' and old.status<>'cancelled' then raise exception 'Issued invoice cancellation requires linked correction';end if;
    if current_user in ('authenticated','service_role') and (new.issued_snapshot_id is distinct from old.issued_snapshot_id or (old.status='draft' and new.status='sent')) then raise exception 'Invoice issuance requires the issue command'; end if;
    if old.issued_snapshot_id is not null and (new.client_id<>old.client_id or new.project_id is distinct from old.project_id or new.number<>old.number or new.amount_satang<>old.amount_satang or new.discount_satang<>old.discount_satang or new.issue_date<>old.issue_date or new.due_date is distinct from old.due_date or new.notes is distinct from old.notes) then raise exception 'Issued content is frozen; use linked correction'; end if;
    new.version:=old.version+1;
  end if;
  return new;
end;
$$;

create function private.guard_snapshot_retention() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.organizations where id=old.org_id) then return old;end if;
  raise exception 'Issued snapshot is immutable';
end;
$$;
create trigger guard_snapshot_retention before update or delete on public.invoice_snapshots for each row execute function private.guard_snapshot_retention();
