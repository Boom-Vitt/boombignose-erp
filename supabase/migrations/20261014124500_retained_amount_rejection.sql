-- Reject immutable input before draft amount normalization can hide the attempt.
create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;q public.quotes;subtotal numeric;line_count integer;
begin
  if tg_op='UPDATE' and new.amount_satang<>old.amount_satang and (old.issued_snapshot_id is not null or (old.source_quote_id is not null and exists(select 1 from public.quotes where org_id=old.org_id and id=old.source_quote_id and status='converted'))) then raise exception 'Retained invoice amount cannot be overwritten';end if;
  if new.project_id is not null then
    select client_id into customer from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or customer is distinct from new.client_id then raise exception 'Invoice and project customer must match';end if;
  end if;
  select coalesce(sum(amount_satang),0),count(*) into subtotal,line_count from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
  if subtotal>9007199254740991 then raise exception 'Invoice exceeds safe satang bounds';end if;
  if line_count>0 then new.amount_satang:=greatest(0,subtotal-new.discount_satang)::bigint;end if;
  if new.source_quote_id is not null then
    select * into q from public.quotes where org_id=new.org_id and id=new.source_quote_id;
    if not found or new.client_id<>q.client_id or new.project_id is distinct from q.project_id then
      -- During conversion the quote is linked only after its complete invoice exists.
      if q.status<>'accepted' then raise exception 'Source invoice customer/project binding is frozen';end if;
    end if;
    if q.status='converted' and (new.discount_satang<>q.discount_satang or new.amount_satang<>q.total_satang or new.client_id<>q.client_id or new.project_id is distinct from q.project_id) then raise exception 'Converted invoice must preserve accepted source terms';end if;
  end if;
  if new.source_milestone_id is not null and not exists(select 1 from public.milestones where org_id=new.org_id and id=new.source_milestone_id and project_id=new.project_id and source_quote_id is not distinct from new.source_quote_id) then raise exception 'Source milestone must match invoice agreement and project';end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
end;
$$;
