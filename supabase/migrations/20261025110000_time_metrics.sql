-- Time billing owns these functions only; invoice issue/line guards remain authoritative.
alter table public.time_entries
  add column invoice_id uuid,
  add column invoice_item_id uuid,
  add constraint time_entries_invoice_tenant_fkey foreign key(org_id,invoice_id) references public.invoices(org_id,id),
  add constraint time_entries_invoice_item_tenant_fkey foreign key(org_id,invoice_item_id) references public.invoice_items(org_id,id),
  add constraint time_entries_billing_pair check((invoice_id is null)=(invoice_item_id is null)),
  add constraint time_entries_rate_bounds check(rate_satang is null or rate_satang between 0 and 9007199254740991),
  add constraint time_entries_value_bounds check(rate_satang is null or div(minutes::numeric*rate_satang+30,60)<=9007199254740991);
create unique index time_entries_invoice_item_key on public.time_entries(invoice_item_id) where invoice_item_id is not null;
create index time_entries_unbilled_project_idx on public.time_entries(org_id,project_id) where billable;
alter table public.memberships add column cost_rate_satang bigint not null default 0
  check(cost_rate_satang between 0 and 9007199254740991);

create table public.time_billing_requests (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key uuid not null,
  project_id uuid not null,
  invoice_id uuid,
  primary key(org_id,key),
  foreign key(org_id,project_id) references public.projects(org_id,id),
  foreign key(org_id,invoice_id) references public.invoices(org_id,id)
);
alter table public.time_billing_requests enable row level security;
alter table public.time_billing_requests force row level security;
revoke all on public.time_billing_requests from public,anon,authenticated;
create policy time_billing_requests_read on public.time_billing_requests for select to authenticated using(private.is_org_staff(org_id));
grant select on public.time_billing_requests to authenticated;

create function private.guard_time_entry()
returns trigger language plpgsql set search_path='' as $$
declare linked public.invoices;
begin
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
create trigger guard_time_entry before insert or update or delete on public.time_entries for each row execute function private.guard_time_entry();
revoke all on function private.guard_time_entry() from public,anon,authenticated;

-- Read all workspace time; only authors or staff may change unbilled/cancelled time.
drop policy tenant_insert on public.time_entries;
drop policy tenant_update on public.time_entries;
drop policy tenant_delete on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated with check(
  private.is_org_member(org_id) and (user_id=auth.uid() or private.is_org_staff(org_id)) and invoice_id is null and invoice_item_id is null);
create policy time_update on public.time_entries for update to authenticated using(
  private.is_org_member(org_id) and (user_id=auth.uid() or private.is_org_staff(org_id)) and
  (invoice_id is null or exists(select 1 from public.invoices i where i.org_id=time_entries.org_id and i.id=time_entries.invoice_id and i.status='cancelled')))
with check(private.is_org_member(org_id) and (user_id=auth.uid() or private.is_org_staff(org_id)) and
  (invoice_id is null or exists(select 1 from public.invoices i where i.org_id=time_entries.org_id and i.id=time_entries.invoice_id and i.status='cancelled')));
create policy time_delete on public.time_entries for delete to authenticated using(
  private.is_org_member(org_id) and (user_id=auth.uid() or private.is_org_staff(org_id)) and
  (invoice_id is null or exists(select 1 from public.invoices i where i.org_id=time_entries.org_id and i.id=time_entries.invoice_id and i.status='cancelled')));

create function private.guard_member_cost_rate()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','service_role') and new.cost_rate_satang<>old.cost_rate_satang then
    raise exception 'Cost rates require the staff command';
  end if;
  return new;
end;
$$;
create trigger guard_member_cost_rate before update on public.memberships for each row execute function private.guard_member_cost_rate();
revoke all on function private.guard_member_cost_rate() from public,anon,authenticated;

create function public.set_member_cost_rate(p_org_id uuid,p_user_id uuid,p_rate_satang bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may set cost rates';end if;
  if p_rate_satang is null or p_rate_satang not between 0 and 9007199254740991 then raise exception 'Invalid cost rate';end if;
  update public.memberships set cost_rate_satang=p_rate_satang where org_id=p_org_id and user_id=p_user_id;
  if not found then raise exception 'Member unavailable';end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'membership',p_user_id,'cost_rate_changed','Updated member hourly cost rate',jsonb_build_object('rateSatang',p_rate_satang));
end;
$$;

-- Membership rows are normally self-only. Staff need the team for cost-rate management.
create policy memberships_time_cost_staff_read on public.memberships for select to authenticated using(private.is_org_staff(org_id));

create function private.time_member_cost_rate(p_org_id uuid,p_user_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select coalesce((select cost_rate_satang from public.memberships
    where org_id=p_org_id and user_id=p_user_id and private.is_org_member(p_org_id)),0);
$$;
revoke all on function private.time_member_cost_rate(uuid,uuid) from public,anon;
grant execute on function private.time_member_cost_rate(uuid,uuid) to authenticated;

create view public.project_labour_totals with (security_invoker=true) as
select t.org_id,t.project_id,sum(div(t.minutes::numeric*private.time_member_cost_rate(t.org_id,t.user_id)+30,60))::bigint as labour_cost_satang
from public.time_entries t
group by t.org_id,t.project_id;
revoke all on public.project_labour_totals from public,anon,authenticated;
grant select on public.project_labour_totals to authenticated;

create function public.bill_project_time(p_org_id uuid,p_project_id uuid,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare request public.time_billing_requests; project public.projects; entry public.time_entries;
  target uuid; line uuid; count_entries integer:=0; charge numeric; total numeric:=0; tax_rate integer:=0;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may bill time';end if;
  if p_key is null or p_project_id is null then raise exception 'Invalid time billing request';end if;
  insert into public.time_billing_requests(org_id,key,project_id) values(p_org_id,p_key,p_project_id) on conflict do nothing;
  select * into request from public.time_billing_requests where org_id=p_org_id and key=p_key for update;
  if request.project_id<>p_project_id then raise exception 'Idempotency conflict';end if;
  if request.invoice_id is not null then return request.invoice_id;end if;
  select * into project from public.projects where org_id=p_org_id and id=p_project_id for update;
  if not found or project.client_id is null then raise exception 'Project needs a client before billing';end if;
  select case when tax_status='registered' then vat_rate_bps else 0 end into tax_rate from public.org_settings where org_id=p_org_id;
  for entry in select t.* from public.time_entries t left join public.invoices i on i.org_id=t.org_id and i.id=t.invoice_id
    where t.org_id=p_org_id and t.project_id=p_project_id and t.billable and t.rate_satang is not null and t.minutes>0
      and (t.invoice_id is null or i.status='cancelled') order by t.id for update of t
  loop
    if target is null then
      target:=gen_random_uuid();
      insert into public.invoices(id,org_id,client_id,project_id,number,status,issue_date,amount_satang,notes)
        values(target,p_org_id,project.client_id,p_project_id,'DRAFT-TIME-'||target::text,'draft',(now() at time zone 'Asia/Bangkok')::date,0,'Time for '||project.name);
    end if;
    charge:=div(entry.minutes::numeric*entry.rate_satang+30,60);
    total:=total+charge;
    if total>9007199254740991 then raise exception 'Time invoice exceeds safe satang bounds';end if;
    -- One entry preserves exact minute valuation despite the 3-decimal invoice quantity.
    insert into public.invoice_items(org_id,invoice_id,description,quantity,unit,unit_price_satang,amount_satang,position,tax_rate_bps)
      values(p_org_id,target,entry.work_date::text||' · '||entry.minutes::text||' minutes × '||entry.rate_satang::text||' satang/hour'||
        case when coalesce(entry.notes,'')='' then '' else ' · '||entry.notes end,1,'entry',charge::bigint,charge::bigint,count_entries,coalesce(tax_rate,0))
      returning id into line;
    update public.time_entries set invoice_id=target,invoice_item_id=line where org_id=p_org_id and id=entry.id;
    count_entries:=count_entries+1;
  end loop;
  if target is null then raise exception 'No billable unbilled time';end if;
  update public.time_billing_requests set invoice_id=target where org_id=p_org_id and key=p_key;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'invoice',target,'time_billed','Created draft invoice from project time',
      jsonb_build_object('projectId',p_project_id,'entryCount',count_entries,'amountSatang',total));
  return target;
end;
$$;
revoke all on function public.bill_project_time(uuid,uuid,uuid),public.set_member_cost_rate(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.bill_project_time(uuid,uuid,uuid),public.set_member_cost_rate(uuid,uuid,bigint) to authenticated;
