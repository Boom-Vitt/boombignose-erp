alter table public.org_settings add column require_different_payment_reviewer boolean not null default false;
create function public.update_payment_review_policy(p_org_id uuid,p_required boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may change payment review policy';end if;
  if p_required is null then raise exception 'Explicit review policy required';end if;
  insert into public.org_settings(org_id,require_different_payment_reviewer) values(p_org_id,p_required)
    on conflict(org_id) do update set require_different_payment_reviewer=excluded.require_different_payment_reviewer;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'organization',p_org_id,'payment_review_policy_updated','Updated payment review separation',jsonb_build_object('required',p_required));
end;
$$;
revoke all on function public.update_payment_review_policy(uuid,boolean) from public,anon,service_role;
grant execute on function public.update_payment_review_policy(uuid,boolean) to authenticated;
create function private.guard_payment_reviewer() returns trigger language plpgsql security definer set search_path='' as $$
declare required boolean;
begin
  if new.status='verified' and old.status='pending' then
    select require_different_payment_reviewer into required from public.org_settings where org_id=new.org_id for share;
    if required and old.submitted_by=new.reviewed_by then raise exception 'A different staff member must verify this reported receipt';end if;
  end if;
  return new;
end;
$$;
create trigger guard_payment_reviewer before update on public.payment_claims for each row execute function private.guard_payment_reviewer();
