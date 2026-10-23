begin;

create table public.scheduled_replenishment_runs (
 org_id uuid not null references public.organizations(id), run_date date not null, vendor_id uuid not null,
 purchase_order_id uuid not null, created_at timestamptz not null default now(),
 primary key(org_id,run_date,vendor_id),
 foreign key(org_id,vendor_id) references public.vendors(org_id,id),
 foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id)
);
alter table public.scheduled_replenishment_runs enable row level security;
alter table public.scheduled_replenishment_runs force row level security;
revoke all on public.scheduled_replenishment_runs from public,anon,authenticated,service_role;
grant select on public.scheduled_replenishment_runs to authenticated,service_role;
create policy tenant_read on public.scheduled_replenishment_runs for select to authenticated using(private.is_org_member(org_id));

create or replace function public.create_replenishment_rfq(p_org_id uuid,p_vendor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; item record; pos integer:=0; expected date; today date:=(now() at time zone 'Asia/Bangkok')::date;
 scheduled boolean:=coalesce(auth.role(),'')='service_role';
begin
 if not private.is_org_staff(p_org_id) and not (scheduled and exists(select 1 from public.org_settings where org_id=p_org_id and scheduled_replenishment_enabled)) then raise exception 'Only owners and admins may manage inventory';end if;
 perform id from public.vendors where org_id=p_org_id and id=p_vendor_id for no key update;
 if not found then raise exception 'Active workspace vendor required';end if;
 if scheduled then
  select purchase_order_id into result from public.scheduled_replenishment_runs where org_id=p_org_id and run_date=today and vendor_id=p_vendor_id;
  if found then return result;end if;
 end if;
 if not exists(select 1 from public.vendors where org_id=p_org_id and id=p_vendor_id and active) then raise exception 'Active workspace vendor required';end if;
 perform id from public.products where org_id=p_org_id and default_vendor_id=p_vendor_id order by id for share;
 select max(expected_date) into expected from public.replenishment_plan(p_org_id,today) where vendor_id=p_vendor_id;
 for item in select r.*,p.description from public.replenishment_plan(p_org_id,today) r join public.products p on p.org_id=p_org_id and p.id=r.product_id where r.vendor_id=p_vendor_id order by r.product_id loop
  if result is null then result:=public.create_purchase_order(p_org_id,p_vendor_id,today,expected,'Inventory replenishment');end if;
  insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,position)
   values(p_org_id,result,item.product_id,coalesce(item.description,item.product_name),item.order_quantity,item.unit,item.unit_cost_satang,pos);
  pos:=pos+1;
 end loop;
 if result is null then raise exception 'No products require replenishment';end if;
 if scheduled then
  insert into public.scheduled_replenishment_runs(org_id,run_date,vendor_id,purchase_order_id) values(p_org_id,today,p_vendor_id,result);
 end if;
 return result;
end;
$$;

commit;
