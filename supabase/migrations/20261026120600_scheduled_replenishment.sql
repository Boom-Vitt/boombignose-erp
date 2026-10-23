begin;

alter table public.org_settings add column scheduled_replenishment_enabled boolean not null default false;
create table public.product_vendor_lead_times (
 org_id uuid not null references public.organizations(id), product_id uuid not null, vendor_id uuid not null,
 lead_days integer not null check(lead_days between 0 and 3650), primary key(org_id,product_id,vendor_id),
 foreign key(org_id,product_id) references public.products(org_id,id), foreign key(org_id,vendor_id) references public.vendors(org_id,id)
);
alter table public.product_vendor_lead_times enable row level security;
alter table public.product_vendor_lead_times force row level security;
revoke all on public.product_vendor_lead_times from public,anon,authenticated;
grant select on public.product_vendor_lead_times to authenticated;
create policy tenant_read on public.product_vendor_lead_times for select to authenticated using(private.is_org_member(org_id));

create function public.save_reorder_rule(p_org_id uuid,p_product_id uuid,p_vendor_id uuid,p_min numeric,p_quantity numeric,p_lead_days integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
 if p_min is null or p_min='NaN'::numeric or p_min<0 or p_min<>round(p_min,3)
  or p_quantity is null or p_quantity='NaN'::numeric or p_quantity<=0 or p_quantity<>round(p_quantity,3)
  or p_lead_days is null or p_lead_days not between 0 and 3650 then raise exception 'Valid replenishment rule required';end if;
 if p_vendor_id is not null and not exists(select 1 from public.vendors where org_id=p_org_id and id=p_vendor_id and active for share) then raise exception 'Active workspace vendor required';end if;
 perform id from public.products where org_id=p_org_id and id=p_product_id and is_stockable for no key update;
 if not found then raise exception 'Stockable product unavailable';end if;
 update public.products set reorder_min=p_min,reorder_qty=p_quantity,default_vendor_id=p_vendor_id where org_id=p_org_id and id=p_product_id;
 if p_vendor_id is not null then
  insert into public.product_vendor_lead_times(org_id,product_id,vendor_id,lead_days) values(p_org_id,p_product_id,p_vendor_id,p_lead_days)
   on conflict(org_id,product_id,vendor_id) do update set lead_days=excluded.lead_days;
 end if;
 insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'product',p_product_id,'reorder_updated','Updated replenishment rule',jsonb_build_object('vendorId',p_vendor_id,'leadDays',p_lead_days));
end;
$$;
revoke all on function public.save_reorder_rule(uuid,uuid,uuid,numeric,numeric,integer) from public,anon;
grant execute on function public.save_reorder_rule(uuid,uuid,uuid,numeric,numeric,integer) to authenticated;

create function public.replenishment_plan(p_org_id uuid,p_date date default (now() at time zone 'Asia/Bangkok')::date)
returns table(product_id uuid,vendor_id uuid,product_name text,unit text,order_quantity numeric,unit_cost_satang bigint,lead_days integer,expected_date date)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_org_member(p_org_id) and coalesce(auth.role(),'')<>'service_role' then raise exception 'Workspace membership required';end if;
 if p_date is null or not isfinite(p_date) then raise exception 'Valid replenishment date required';end if;
 return query select p.id,p.default_vendor_id,p.name,p.unit,greatest(p.reorder_qty,p.reorder_min-s.quantity-f.on_order),p.cost_satang,
  coalesce(l.lead_days,0),p_date+coalesce(l.lead_days,0)
 from public.products p join public.inventory_totals s on s.org_id=p.org_id and s.product_id=p.id
 join public.inventory_forecast f on f.org_id=p.org_id and f.product_id=p.id
 join public.vendors v on v.org_id=p.org_id and v.id=p.default_vendor_id and v.active
 left join public.product_vendor_lead_times l on l.org_id=p.org_id and l.product_id=p.id and l.vendor_id=p.default_vendor_id
 where p.org_id=p_org_id and p.active and p.is_stockable and s.quantity+f.on_order<p.reorder_min and p.reorder_qty>0 order by p.default_vendor_id,p.id;
end;
$$;
revoke all on function public.replenishment_plan(uuid,date) from public,anon;
grant execute on function public.replenishment_plan(uuid,date) to authenticated,service_role;
create or replace function public.create_purchase_order(p_org_id uuid,p_vendor_id uuid,p_order_date date,p_expected_date date default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; counter bigint; num text; yr integer;
begin
  if not private.is_org_staff(p_org_id) and not (coalesce(auth.role(),'')='service_role' and exists(select 1 from public.org_settings where org_id=p_org_id and scheduled_replenishment_enabled)) then raise exception 'Only owners and admins may manage purchases';end if;
  if not exists(select 1 from public.vendors where org_id=p_org_id and id=p_vendor_id and active) then raise exception 'Active workspace vendor required';end if;
  yr:=extract(year from p_order_date);
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'PO',yr,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='PO-'||yr::text||'-'||lpad(counter::text,greatest(3,length(counter::text)),'0');
    exit when not exists(select 1 from public.purchase_orders where org_id=p_org_id and number=num);
  end loop;
  insert into public.purchase_orders(org_id,number,vendor_id,order_date,expected_date,notes,created_by)
    values(p_org_id,num,p_vendor_id,p_order_date,p_expected_date,p_notes,auth.uid()) returning id into result;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
    values(p_org_id,auth.uid(),'purchase_order',result,'created','Created purchase order '||num);
  return result;
end;
$$;
grant execute on function public.create_purchase_order(uuid,uuid,date,date,text) to service_role;
create or replace function public.inventory_snapshot(p_org_id uuid,p_warehouse_id uuid default null,p_product_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required';end if;
  return (
    with balances as materialized (
      select * from public.stock_on_hand where org_id=p_org_id
        and (p_warehouse_id is null or warehouse_id=p_warehouse_id)
        and (p_product_id is null or product_id=p_product_id)
    ), totals as (
      select product_id,sum(quantity) as quantity,sum(value_satang) as value_satang from balances group by product_id
    )
    select jsonb_build_object(
      'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('quantity',coalesce(t.quantity,0),'value_satang',coalesce(t.value_satang,0),'lead_days',coalesce((select lead_days from public.product_vendor_lead_times l where l.org_id=p.org_id and l.product_id=p.id and l.vendor_id=p.default_vendor_id),0),'on_order',f.on_order,'reserved_quantity',f.reserved_quantity) order by p.name,p.id)
        from public.products p join public.inventory_forecast f on f.org_id=p.org_id and f.product_id=p.id left join totals t on t.product_id=p.id
        where p.org_id=p_org_id and p.is_stockable and (p_product_id is null or p.id=p_product_id)),'[]'::jsonb),
      'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.product_id,b.warehouse_id) from balances b),'[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.create_replenishment_rfq(p_org_id uuid,p_vendor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; item record; pos integer:=0; expected date; today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
 if not private.is_org_staff(p_org_id) and not (coalesce(auth.role(),'')='service_role' and exists(select 1 from public.org_settings where org_id=p_org_id and scheduled_replenishment_enabled)) then raise exception 'Only owners and admins may manage inventory';end if;
 perform id from public.vendors where org_id=p_org_id and id=p_vendor_id and active for no key update;
 if not found then raise exception 'Active workspace vendor required';end if;
 perform id from public.products where org_id=p_org_id and default_vendor_id=p_vendor_id order by id for share;
 select max(expected_date) into expected from public.replenishment_plan(p_org_id,today) where vendor_id=p_vendor_id;
 for item in select r.*,p.description from public.replenishment_plan(p_org_id,today) r join public.products p on p.org_id=p_org_id and p.id=r.product_id where r.vendor_id=p_vendor_id order by r.product_id loop
  if result is null then result:=public.create_purchase_order(p_org_id,p_vendor_id,today,expected,'Inventory replenishment');end if;
  insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,position)
   values(p_org_id,result,item.product_id,coalesce(item.description,item.product_name),item.order_quantity,item.unit,item.unit_cost_satang,pos);
  pos:=pos+1;
 end loop;
 if result is null then raise exception 'No products require replenishment';end if;
 return result;
end;
$$;
grant execute on function public.create_replenishment_rfq(uuid,uuid) to service_role;

commit;
