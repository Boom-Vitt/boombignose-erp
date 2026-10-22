create type public.stock_move_kind as enum ('receipt','delivery','adjustment_in','adjustment_out','transfer_in','transfer_out');

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check(length(btrim(code)) between 1 and 40),
  name text not null check(length(btrim(name)) between 1 and 200),
  address text check(length(address)<=2000),
  is_default boolean not null default false,
  active boolean not null default true,
  unique(org_id,id), unique(org_id,code), check(not is_default or active)
);
create unique index warehouses_one_default on public.warehouses(org_id) where is_default;
alter table public.warehouses enable row level security;
alter table public.warehouses force row level security;
revoke all on public.warehouses from anon,authenticated;
grant select on public.warehouses to authenticated;
create policy tenant_read on public.warehouses for select to authenticated using(private.is_org_member(org_id));
create trigger guard_tenant_identity before update on public.warehouses for each row execute function private.guard_tenant_identity();

alter table public.products
  add column reorder_min numeric(12,3) not null default 0 check(reorder_min>=0 and reorder_min<>'NaN'::numeric),
  add column reorder_qty numeric(12,3) not null default 0 check(reorder_qty>=0 and reorder_qty<>'NaN'::numeric),
  add column default_vendor_id uuid,
  add constraint products_default_vendor_tenant_fkey foreign key(org_id,default_vendor_id) references public.vendors(org_id,id);
alter table public.org_settings add column allow_negative_stock boolean not null default false;

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  org_id uuid not null references public.organizations(id),
  product_id uuid not null,
  warehouse_id uuid not null,
  kind public.stock_move_kind not null,
  quantity numeric(12,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
  unit_cost_satang bigint not null check(unit_cost_satang between 0 and 9007199254740991),
  source_type text not null check(source_type in ('purchase_order','invoice','adjustment','transfer')),
  source_id uuid not null,
  note text check(length(note)<=2000),
  moved_at timestamptz not null default clock_timestamp() check(isfinite(moved_at)),
  created_by uuid references auth.users(id),
  balance_after numeric(15,3) not null,
  average_cost_after numeric(30,10) not null,
  foreign key(org_id,product_id) references public.products(org_id,id),
  foreign key(org_id,warehouse_id) references public.warehouses(org_id,id),
  check(abs(round(balance_after*average_cost_after))<=9007199254740991)
);
create index stock_moves_balance_idx on public.stock_moves(org_id,product_id,warehouse_id,sequence desc);
create index stock_moves_source_idx on public.stock_moves(org_id,source_type,source_id);
create index stock_moves_date_idx on public.stock_moves(org_id,moved_at desc,id);
alter table public.stock_moves enable row level security;
alter table public.stock_moves force row level security;
revoke all on public.stock_moves from anon,authenticated;
grant select on public.stock_moves to authenticated;
create policy tenant_read on public.stock_moves for select to authenticated using(private.is_org_member(org_id));

create table public.stock_counts (
  org_id uuid not null references public.organizations(id),
  key uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity numeric(12,3) not null check(quantity>=0 and quantity<>'NaN'::numeric),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  primary key(org_id,key),
  foreign key(org_id,product_id) references public.products(org_id,id),
  foreign key(org_id,warehouse_id) references public.warehouses(org_id,id)
);
alter table public.stock_counts enable row level security;
alter table public.stock_counts force row level security;
revoke all on public.stock_counts from anon,authenticated;
grant select on public.stock_counts to authenticated;
create policy tenant_read on public.stock_counts for select to authenticated using(private.is_org_member(org_id));

-- Posting order, not the editable business timestamp, determines perpetual weighted average cost.
create function private.value_stock_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare stockable boolean; qty numeric:=0; avg_cost numeric:=0; signed_qty numeric; negative_ok boolean;
begin
  select is_stockable into stockable from public.products where org_id=new.org_id and id=new.product_id for update;
  if not found or not stockable then raise exception 'Stockable workspace product required';end if;
  if not exists(select 1 from public.warehouses where org_id=new.org_id and id=new.warehouse_id and active for share) then raise exception 'Active workspace warehouse required';end if;
  select balance_after,average_cost_after into qty,avg_cost from public.stock_moves
    where org_id=new.org_id and product_id=new.product_id and warehouse_id=new.warehouse_id order by sequence desc limit 1;
  qty:=coalesce(qty,0);avg_cost:=coalesce(avg_cost,0);
  signed_qty:=case when new.kind in ('receipt','adjustment_in','transfer_in') then new.quantity else -new.quantity end;
  select allow_negative_stock into negative_ok from public.org_settings where org_id=new.org_id;
  if qty+signed_qty<0 and not coalesce(negative_ok,false) then raise exception 'Insufficient stock';end if;
  if new.kind='adjustment_in' and qty>0 then
    new.unit_cost_satang:=round(avg_cost);
  elsif signed_qty>0 then
    avg_cost:=case when qty<=0 then new.unit_cost_satang else (qty*avg_cost+signed_qty*new.unit_cost_satang)/(qty+signed_qty) end;
  else
    new.unit_cost_satang:=round(avg_cost);
  end if;
  new.balance_after:=qty+signed_qty;
  new.average_cost_after:=case when new.balance_after=0 then 0 else avg_cost end;
  new.created_by:=auth.uid();
  -- Identity defaults are evaluated before a wait; allocate order only after the product lock.
  new.sequence:=nextval(pg_get_serial_sequence('public.stock_moves','sequence'));
  return new;
end;
$$;
create trigger value_stock_move before insert on public.stock_moves for each row execute function private.value_stock_move();
create function private.retain_stock_move()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Stock ledger is append-only; post a correction';end;
$$;
create trigger retain_stock_move before update or delete on public.stock_moves for each row execute function private.retain_stock_move();

create function private.retain_stockable_product()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.is_stockable and not new.is_stockable and exists(select 1 from public.stock_moves where org_id=old.org_id and product_id=old.id) then
    raise exception 'Products with stock history must remain stockable';end if;
  return new;
end;
$$;
create trigger retain_stockable_product before update of is_stockable on public.products for each row execute function private.retain_stockable_product();

create view public.stock_on_hand with(security_invoker=true) as
  select distinct on(org_id,product_id,warehouse_id) org_id,product_id,warehouse_id,
    balance_after as quantity,round(average_cost_after)::bigint as average_cost_satang,
    round(balance_after*average_cost_after)::bigint as value_satang
  from public.stock_moves order by org_id,product_id,warehouse_id,sequence desc;
grant select on public.stock_on_hand to authenticated;
create view public.inventory_totals with(security_invoker=true) as
  select p.org_id,p.id as product_id,coalesce(sum(s.quantity),0) as quantity,
    coalesce(sum(s.value_satang),0) as value_satang
  from public.products p left join public.stock_on_hand s on s.org_id=p.org_id and s.product_id=p.id
  where p.is_stockable group by p.org_id,p.id;
grant select on public.inventory_totals to authenticated;

create function public.save_warehouse(p_org_id uuid,p_id uuid,p_code text,p_name text,p_address text,p_default boolean,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  perform 1 from public.organizations where id=p_org_id for no key update;
  if p_id is not null and not exists(select 1 from public.warehouses where org_id=p_org_id and id=p_id) then raise exception 'Warehouse unavailable';end if;
  if p_default then update public.warehouses set is_default=false where org_id=p_org_id and is_default;end if;
  if p_id is null then
    insert into public.warehouses(org_id,code,name,address,is_default,active) values(p_org_id,btrim(p_code),btrim(p_name),p_address,p_default,p_active) returning id into result;
  else
    update public.warehouses set code=btrim(p_code),name=btrim(p_name),address=p_address,is_default=p_default,active=p_active where org_id=p_org_id and id=p_id returning id into result;
  end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'warehouse',result,'saved','Saved warehouse '||p_name);
  return result;
end;
$$;
create function public.delete_warehouse(p_org_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  delete from public.warehouses where org_id=p_org_id and id=p_id;
  if not found then raise exception 'Warehouse unavailable';end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'warehouse',p_id,'deleted','Deleted unused warehouse');
end;
$$;

drop function public.receive_purchase_order(uuid,uuid,jsonb);
create function public.receive_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; line jsonb; item public.purchase_order_items; qty numeric; changed boolean:=false; warehouse uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status not in ('confirmed','received','billed') then raise exception 'Confirmed purchase order required';end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Receipt lines required';end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_lines)) then raise exception 'Duplicate receipt line';end if;
  warehouse:=p_warehouse_id;
  if warehouse is null then select id into warehouse from public.warehouses where org_id=p_org_id and is_default and active;end if;
  perform id from public.products where org_id=p_org_id and id in(select product_id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) order by id for update;
  for line in select value from jsonb_array_elements(p_lines) loop
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and id=(line->>'id')::uuid for update;
    if not found then raise exception 'Receipt line unavailable';end if;
    qty:=(line->>'received_quantity')::numeric;
    if qty is null or qty='NaN'::numeric or qty<item.received_quantity or qty>item.quantity or qty<>round(qty,3) then raise exception 'Invalid cumulative receipt quantity';end if;
    if qty>item.received_quantity and exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and is_stockable) then
      if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
      insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
        values(p_org_id,item.product_id,warehouse,'receipt',qty-item.received_quantity,item.unit_cost_satang,'purchase_order',po.id,po.number,0,0);
    end if;
    changed:=changed or qty<>item.received_quantity;
    update public.purchase_order_items set received_quantity=qty where org_id=p_org_id and id=item.id;
  end loop;
  if po.status<>'billed' and not exists(select 1 from public.purchase_order_items where purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='received' where org_id=p_org_id and id=po.id;end if;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'received','Recorded received quantities and stock',jsonb_build_object('lines',p_lines,'warehouseId',warehouse));end if;
end;
$$;

create function public.deliver_invoice(p_org_id uuid,p_invoice_id uuid,p_warehouse_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; item record; warehouse uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  select * into invoice from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found or invoice.status in ('draft','cancelled') or invoice.issued_snapshot_id is null then raise exception 'Issued invoice required';end if;
  if exists(select 1 from public.stock_moves where org_id=p_org_id and source_type='invoice' and source_id=invoice.id and kind='delivery') then return;end if;
  warehouse:=p_warehouse_id;
  if warehouse is null then select id into warehouse from public.warehouses where org_id=p_org_id and is_default and active;end if;
  if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
  perform p.id from public.products p where p.org_id=p_org_id and p.id in(select product_id from public.invoice_items where org_id=p_org_id and invoice_id=invoice.id) order by p.id for update;
  for item in select p.id,sum(i.quantity) as quantity from public.invoice_items i join public.products p on p.org_id=i.org_id and p.id=i.product_id
    where i.org_id=p_org_id and i.invoice_id=invoice.id and p.is_stockable group by p.id order by p.id loop
    insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
      values(p_org_id,item.id,warehouse,'delivery',item.quantity,0,'invoice',invoice.id,invoice.number,0,0);
  end loop;
  if not found then raise exception 'Invoice has no stockable lines';end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'invoice',invoice.id,'delivered','Delivered stockable invoice lines');
end;
$$;

create function public.adjust_stock(p_org_id uuid,p_product_id uuid,p_warehouse_id uuid,p_count numeric,p_reason text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare qty numeric; cost bigint; delta numeric; result uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  if p_key is null or p_count is null or p_count<0 or p_count='NaN'::numeric or p_count<>round(p_count,3) or p_count>999999999.999 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Valid count and reason required';end if;
  select cost_satang into cost from public.products where org_id=p_org_id and id=p_product_id and is_stockable for update;
  if not found then raise exception 'Stockable workspace product required';end if;
  if exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key) then
    if not exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key and product_id=p_product_id and warehouse_id=p_warehouse_id and quantity=p_count and reason=p_reason) then raise exception 'Adjustment key conflict';end if;
    select id into result from public.stock_moves where org_id=p_org_id and source_type='adjustment' and source_id=p_key;
    return result;
  end if;
  if not exists(select 1 from public.warehouses where org_id=p_org_id and id=p_warehouse_id and active) then raise exception 'Active workspace warehouse required';end if;
  insert into public.stock_counts(org_id,key,product_id,warehouse_id,quantity,reason) values(p_org_id,p_key,p_product_id,p_warehouse_id,p_count,p_reason);
  select quantity into qty from public.stock_on_hand where org_id=p_org_id and product_id=p_product_id and warehouse_id=p_warehouse_id;
  delta:=p_count-coalesce(qty,0);
  if delta=0 then return null;end if;
  insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
    values(p_org_id,p_product_id,p_warehouse_id,case when delta>0 then 'adjustment_in'::public.stock_move_kind else 'adjustment_out'::public.stock_move_kind end,abs(delta),cost,'adjustment',p_key,p_reason,0,0) returning id into result;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'product',p_product_id,'stock_adjusted','Inventory counted',jsonb_build_object('warehouseId',p_warehouse_id,'count',p_count,'reason',p_reason));
  return result;
end;
$$;

create function public.create_replenishment_rfq(p_org_id uuid,p_vendor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; item record; pos integer:=0;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  perform id from public.vendors where org_id=p_org_id and id=p_vendor_id and active for no key update;
  if not found then raise exception 'Active workspace vendor required';end if;
  if exists(select 1 from public.purchase_orders where org_id=p_org_id and vendor_id=p_vendor_id and status in ('draft','sent','confirmed') and notes='Inventory replenishment') then
    raise exception 'An open replenishment RFQ already exists for this vendor';end if;
  perform id from public.products where org_id=p_org_id and default_vendor_id=p_vendor_id order by id for update;
  for item in select p.* from public.products p join public.inventory_totals s on s.org_id=p.org_id and s.product_id=p.id
    where p.org_id=p_org_id and p.active and p.is_stockable and p.default_vendor_id=p_vendor_id and s.quantity<p.reorder_min and p.reorder_qty>0 order by p.id loop
    if result is null then result:=public.create_purchase_order(p_org_id,p_vendor_id,(now() at time zone 'Asia/Bangkok')::date,null,'Inventory replenishment');end if;
    insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,position)
      values(p_org_id,result,item.id,coalesce(item.description,item.name),item.reorder_qty,item.unit,item.cost_satang,pos);
    pos:=pos+1;
  end loop;
  if result is null then raise exception 'No products require replenishment';end if;
  return result;
end;
$$;

insert into public.warehouses(org_id,code,name,is_default) select id,'MAIN','Main warehouse',true from public.organizations;
create function private.create_default_warehouse()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.warehouses(org_id,code,name,is_default) values(new.id,'MAIN','Main warehouse',true);
  return new;
end;
$$;
create trigger create_default_warehouse after insert on public.organizations for each row execute function private.create_default_warehouse();

revoke all on function private.value_stock_move(),private.retain_stock_move(),private.retain_stockable_product(),private.create_default_warehouse() from public,anon,authenticated;
revoke all on function public.save_warehouse(uuid,uuid,text,text,text,boolean,boolean),public.delete_warehouse(uuid,uuid),public.receive_purchase_order(uuid,uuid,jsonb,uuid),public.deliver_invoice(uuid,uuid,uuid),public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid),public.create_replenishment_rfq(uuid,uuid) from public,anon;
grant execute on function public.save_warehouse(uuid,uuid,text,text,text,boolean,boolean),public.delete_warehouse(uuid,uuid),public.receive_purchase_order(uuid,uuid,jsonb,uuid),public.deliver_invoice(uuid,uuid,uuid),public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid),public.create_replenishment_rfq(uuid,uuid) to authenticated;
