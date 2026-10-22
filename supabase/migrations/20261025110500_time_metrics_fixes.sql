create table public.member_cost_rates (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  cost_rate_satang bigint not null default 0 check(cost_rate_satang between 0 and 9007199254740991),
  primary key(org_id,user_id),
  foreign key(org_id,user_id) references public.memberships(org_id,user_id) on delete cascade
);
alter table public.member_cost_rates enable row level security;
alter table public.member_cost_rates force row level security;
revoke all on public.member_cost_rates from public,anon,authenticated;
create policy member_cost_rates_staff_read on public.member_cost_rates for select to authenticated using(private.is_org_staff(org_id));
grant select on public.member_cost_rates to authenticated;

insert into public.member_cost_rates(org_id,user_id,cost_rate_satang)
  select org_id,user_id,cost_rate_satang from public.memberships;

create or replace function public.set_member_cost_rate(p_org_id uuid,p_user_id uuid,p_rate_satang bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may set cost rates';end if;
  if p_rate_satang is null or p_rate_satang not between 0 and 9007199254740991 then raise exception 'Invalid cost rate';end if;
  perform 1 from public.memberships where org_id=p_org_id and user_id=p_user_id for key share;
  if not found then raise exception 'Member unavailable';end if;
  insert into public.member_cost_rates(org_id,user_id,cost_rate_satang) values(p_org_id,p_user_id,p_rate_satang)
    on conflict(org_id,user_id) do update set cost_rate_satang=excluded.cost_rate_satang;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'membership',p_user_id,'cost_rate_changed','Updated member hourly cost rate',jsonb_build_object('rateSatang',p_rate_satang));
end;
$$;
revoke all on function public.set_member_cost_rate(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.set_member_cost_rate(uuid,uuid,bigint) to authenticated;

-- Members may see complete project costs, but cannot select any individual rate.
create function private.project_labour_totals(p_org_id uuid)
returns table(org_id uuid,project_id uuid,labour_cost_satang bigint)
language sql stable security definer set search_path='' as $$
  select t.org_id,t.project_id,sum(div(t.minutes::numeric*coalesce(r.cost_rate_satang,0)+30,60))::bigint
  from public.time_entries t
  left join public.member_cost_rates r on r.org_id=t.org_id and r.user_id=t.user_id
  where t.org_id=p_org_id and private.is_org_member(p_org_id)
  group by t.org_id,t.project_id;
$$;
revoke all on function private.project_labour_totals(uuid) from public,anon,authenticated;
grant execute on function private.project_labour_totals(uuid) to authenticated;

create or replace view public.project_labour_totals with (security_invoker=true) as
select totals.org_id,totals.project_id,totals.labour_cost_satang
from public.organizations o cross join lateral private.project_labour_totals(o.id) totals;
revoke all on public.project_labour_totals from public,anon,authenticated;
grant select on public.project_labour_totals to authenticated;

drop function private.time_member_cost_rate(uuid,uuid);
drop trigger guard_member_cost_rate on public.memberships;
drop function private.guard_member_cost_rate();
alter table public.memberships drop column cost_rate_satang;

create or replace function private.guard_time_entry()
returns trigger language plpgsql set search_path='' as $$
declare linked public.invoices;
begin
  -- Auth deletion must retain time, including frozen billed entries, without allowing reassignment.
  if tg_op='UPDATE' and current_user not in ('authenticated','service_role') and pg_trigger_depth()>1 then
    if old.user_id is not null and new.user_id is null
      and (to_jsonb(new)-'user_id'-'updated_at') is not distinct from (to_jsonb(old)-'user_id'-'updated_at')
      and not exists(select 1 from auth.users where id=old.user_id) then
      return new;
    end if;
  end if;
  if tg_op<>'INSERT' then
    if old.invoice_id is not null then
      select * into linked from public.invoices where org_id=old.org_id and id=old.invoice_id for share;
      if found and linked.status<>'cancelled' then raise exception 'Billed time is frozen until its invoice is cancelled';end if;
    end if;
    if tg_op='DELETE' then return old;end if;
    if new.user_id is distinct from old.user_id then raise exception 'Time author is immutable';end if;
  end if;
  if current_user in ('authenticated','service_role') then
    if (tg_op='INSERT' and (new.invoice_id is not null or new.invoice_item_id is not null))
      or (tg_op='UPDATE' and (new.invoice_id is distinct from old.invoice_id or new.invoice_item_id is distinct from old.invoice_item_id)) then
      raise exception 'Time billing links require the billing command';
    end if;
  end if;
  if new.task_id is not null and not exists(select 1 from public.project_tasks where org_id=new.org_id and id=new.task_id and project_id=new.project_id) then
    raise exception 'Task must belong to time entry project';
  end if;
  if new.invoice_id is not null and not exists(select 1 from public.invoice_items l join public.invoices i on i.org_id=l.org_id and i.id=l.invoice_id
    where l.org_id=new.org_id and l.id=new.invoice_item_id and i.id=new.invoice_id and i.project_id=new.project_id) then
    raise exception 'Time invoice and line must match project';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_time_entry() from public,anon,authenticated;
