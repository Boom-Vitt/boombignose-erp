begin;

lock table public.stock_moves in exclusive mode;
create table public.stock_balances (
  org_id uuid not null references public.organizations(id),
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity numeric(15,3) not null default 0,
  average_cost numeric(30,10) not null default 0 check(average_cost>=0),
  primary key(org_id,product_id,warehouse_id),
  foreign key(org_id,product_id) references public.products(org_id,id),
  foreign key(org_id,warehouse_id) references public.warehouses(org_id,id),
  check(abs(round(quantity*average_cost))<=9007199254740991)
);
alter table public.stock_balances enable row level security;
alter table public.stock_balances force row level security;
revoke all on public.stock_balances from public,anon,authenticated;
grant select on public.stock_balances to authenticated;
create policy tenant_read on public.stock_balances for select to authenticated using(private.is_org_member(org_id));
insert into public.stock_balances(org_id,product_id,warehouse_id,quantity,average_cost)
select distinct on(org_id,product_id,warehouse_id) org_id,product_id,warehouse_id,balance_after,average_cost_after
from public.stock_moves order by org_id,product_id,warehouse_id,sequence desc;

create function private.lock_stock_balances(p_org_id uuid,p_products uuid[],p_warehouses uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare product uuid; warehouse uuid;
begin
  perform id from public.products where org_id=p_org_id and id=any(p_products) order by id for share;
  for warehouse in select distinct unnest(p_warehouses) order by 1 loop
    if not exists(select 1 from public.warehouses where org_id=p_org_id and id=warehouse and active for share) then raise exception 'Active workspace warehouse required';end if;
  end loop;
  for product in select distinct unnest(p_products) order by 1 loop
    if product is null then continue;end if;
    if not exists(select 1 from public.products where org_id=p_org_id and id=product and is_stockable) then continue;end if;
    for warehouse in select distinct unnest(p_warehouses) order by 1 loop
      insert into public.stock_balances(org_id,product_id,warehouse_id) values(p_org_id,product,warehouse) on conflict do nothing;
      perform 1 from public.stock_balances where org_id=p_org_id and product_id=product and warehouse_id=warehouse for update;
    end loop;
  end loop;
end;
$$;
revoke all on function private.lock_stock_balances(uuid,uuid[],uuid[]) from public,anon,authenticated;

create or replace view public.stock_on_hand with(security_invoker=true) as
select org_id,product_id,warehouse_id,quantity,round(average_cost)::bigint as average_cost_satang,
 round(quantity*average_cost)::bigint as value_satang from public.stock_balances;

create or replace function private.value_stock_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare  qty numeric:=0; avg_cost numeric:=0; signed_qty numeric; negative_ok boolean; before_value numeric; original public.stock_moves; prior numeric; return_value numeric;
begin
  perform private.lock_stock_balances(new.org_id,array[new.product_id],array[new.warehouse_id]);
  select quantity,average_cost into qty,avg_cost from public.stock_balances
    where org_id=new.org_id and product_id=new.product_id and warehouse_id=new.warehouse_id;
  if not found then raise exception 'Stockable workspace product required';end if;
  before_value:=round(qty*avg_cost);
  signed_qty:=case when new.kind::text in ('receipt','adjustment_in','transfer_in','customer_return') then new.quantity else -new.quantity end;
  select allow_negative_stock into negative_ok from public.org_settings where org_id=new.org_id;
  if signed_qty<0 and qty+signed_qty<0 and not coalesce(negative_ok,false) then raise exception 'Insufficient stock';end if;
  if new.kind::text='customer_return' then
    select * into original from public.stock_moves where org_id=new.org_id and id=new.return_of_move_id and kind='delivery'
      and product_id=new.product_id and warehouse_id=new.warehouse_id;
    if not found then raise exception 'Original delivery unavailable';end if;
    select coalesce(sum(quantity),0) into prior from public.stock_moves where org_id=new.org_id and return_of_move_id=original.id and kind::text='customer_return';
    if prior+new.quantity>original.quantity then raise exception 'Invalid cumulative customer return quantity';end if;
    new.stock_value_satang:=round((prior+new.quantity)*original.stock_value_satang/original.quantity)-round(prior*original.stock_value_satang/original.quantity);
    new.unit_cost_satang:=original.unit_cost_satang;
    return_value:=before_value+new.stock_value_satang;
    if qty+new.quantity=0 then
      if return_value<>0 then raise exception 'Return value incompatible with stock balance';end if;
      avg_cost:=0;
    else
      avg_cost:=return_value/(qty+new.quantity);
      if avg_cost<0 then raise exception 'Return value incompatible with stock balance';end if;
    end if;
  elsif new.kind='adjustment_in' and qty>0 then
    new.unit_cost_satang:=round(avg_cost);
  elsif signed_qty>0 then
    avg_cost:=case when qty<=0 then new.unit_cost_satang else (qty*avg_cost+signed_qty*new.unit_cost_satang)/(qty+signed_qty) end;
  else
    new.unit_cost_satang:=round(avg_cost);
  end if;
  new.balance_after:=qty+signed_qty;
  new.average_cost_after:=case when new.balance_after=0 then 0 else avg_cost end;
  if new.kind::text<>'customer_return' then
    new.stock_value_satang:=abs(before_value-round(new.balance_after*new.average_cost_after));
  elsif round(new.balance_after*new.average_cost_after)<>return_value then
    raise exception 'Return value exceeds stock precision';
  end if;
  update public.stock_balances set quantity=new.balance_after,average_cost=new.average_cost_after
    where org_id=new.org_id and product_id=new.product_id and warehouse_id=new.warehouse_id;
  new.created_by:=auth.uid();
  new.sequence:=nextval(pg_get_serial_sequence('public.stock_moves','sequence'));
  return new;
end;
$$;

create or replace function public.receive_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null)
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
  perform private.lock_stock_balances(p_org_id,array(select product_id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id),array[warehouse]);
  for line in select value from jsonb_array_elements(p_lines) loop
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and id=(line->>'id')::uuid for update;
    if not found then raise exception 'Receipt line unavailable';end if;
    if (line->>'previous_received_quantity')::numeric is distinct from item.received_quantity then raise exception 'Receipt changed, reload';end if;
    qty:=(line->>'received_quantity')::numeric;
    if qty is null or qty='NaN'::numeric or qty<item.received_quantity or qty>item.quantity or qty<>round(qty,3) then raise exception 'Invalid cumulative receipt quantity';end if;
    if qty>item.received_quantity and exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and is_stockable) then
      if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
      if not exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and unit=item.unit) then raise exception 'Product line unit must match product unit';end if;
      insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,note,balance_after,average_cost_after)
        values(p_org_id,item.product_id,warehouse,'receipt',qty-item.received_quantity,item.unit_cost_satang,'purchase_order',po.id,item.id,po.number,0,0);
    end if;
    changed:=changed or qty<>item.received_quantity;
    update public.purchase_order_items set received_quantity=qty where org_id=p_org_id and id=item.id;
  end loop;
  if po.status<>'billed' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='received' where org_id=p_org_id and id=po.id;end if;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'received','Recorded received quantities and stock',jsonb_build_object('lines',p_lines,'warehouseId',warehouse));end if;
end;
$$;

create or replace function public.deliver_invoice(p_org_id uuid,p_invoice_id uuid,p_warehouse_id uuid default null,p_lines jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; item record; line jsonb; qty numeric; prior numeric; warehouse uuid; lines jsonb; changed boolean:=false;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  select * into invoice from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found or invoice.status in ('draft','cancelled') or invoice.issued_snapshot_id is null then raise exception 'Issued invoice required';end if;
  if p_lines is null then
    select jsonb_agg(jsonb_build_object('id',id,'delivered_quantity',quantity,'previous_delivered_quantity',delivered_quantity) order by id) into lines
      from public.invoice_stock_lines where org_id=p_org_id and invoice_id=invoice.id and is_stockable;
  else lines:=p_lines;end if;
  if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)=0 then raise exception 'Invoice has no stockable lines';end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(lines)) then raise exception 'Duplicate delivery line';end if;
  warehouse:=p_warehouse_id;
  if warehouse is null then select id into warehouse from public.warehouses where org_id=p_org_id and is_default and active;end if;
  perform private.lock_stock_balances(p_org_id,array(select product_id from public.invoice_items where org_id=p_org_id and invoice_id=invoice.id),array[warehouse]);
  for line in select value from jsonb_array_elements(lines) loop
    select * into item from public.invoice_stock_lines where org_id=p_org_id and invoice_id=invoice.id and id=(line->>'id')::uuid and is_stockable;
    if not found then raise exception 'Stockable delivery line unavailable';end if;
    prior:=item.delivered_quantity;
    if (line->>'previous_delivered_quantity')::numeric is distinct from prior then raise exception 'Delivery changed, reload';end if;
    qty:=(line->>'delivered_quantity')::numeric;
    if qty is null or qty='NaN'::numeric or qty<prior or qty>item.quantity or qty<>round(qty,3) then raise exception 'Invalid cumulative delivery quantity';end if;
    if qty=prior then continue;end if;
    if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
    if not exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and unit=item.unit) then raise exception 'Product line unit must match product unit';end if;
    insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,note,balance_after,average_cost_after)
      values(p_org_id,item.product_id,warehouse,'delivery',qty-prior,0,'invoice',invoice.id,item.id,invoice.number,0,0);
    insert into public.invoice_line_stock(org_id,line_id,invoice_id,delivered_quantity) values(p_org_id,item.id,invoice.id,qty)
      on conflict(org_id,line_id) do update set delivered_quantity=excluded.delivered_quantity;
    changed:=true;
  end loop;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'invoice',invoice.id,'delivered','Delivered stockable invoice quantities',jsonb_build_object('lines',lines,'warehouseId',warehouse));end if;
end;
$$;

create or replace function public.return_invoice_delivery(p_org_id uuid,p_invoice_id uuid,p_move_id uuid,p_returned_quantity numeric)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; original public.stock_moves; prior numeric; delta numeric; remaining numeric; allocation numeric; item record;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  select * into invoice from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found or invoice.issued_snapshot_id is null then raise exception 'Issued invoice required';end if;
  select * into original from public.stock_moves where org_id=p_org_id and id=p_move_id and source_type='invoice' and source_id=invoice.id and kind='delivery';
  if not found then raise exception 'Original delivery unavailable';end if;
  perform private.lock_stock_balances(p_org_id,array[original.product_id],array[original.warehouse_id]);
  select coalesce(sum(quantity),0) into prior from public.stock_moves where org_id=p_org_id and return_of_move_id=original.id and kind::text='customer_return';
  if p_returned_quantity is null or p_returned_quantity='NaN'::numeric or p_returned_quantity<prior or p_returned_quantity>original.quantity or p_returned_quantity<>round(p_returned_quantity,3) then raise exception 'Invalid cumulative customer return quantity';end if;
  delta:=p_returned_quantity-prior;
  if delta=0 then return;end if;
  remaining:=delta;
  for item in select s.* from public.invoice_line_stock s join public.invoice_items i on i.org_id=s.org_id and i.id=s.line_id
    where s.org_id=p_org_id and s.invoice_id=invoice.id and i.product_id=original.product_id
      and (original.source_line_id is null or s.line_id=original.source_line_id)
    order by s.line_id for update of s loop
    allocation:=least(remaining,item.delivered_quantity-item.returned_quantity);
    update public.invoice_line_stock set returned_quantity=returned_quantity+allocation where org_id=p_org_id and line_id=item.line_id;
    remaining:=remaining-allocation;
    exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'Return exceeds delivered line quantities';end if;
  insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,return_of_move_id,note,balance_after,average_cost_after)
    values(p_org_id,original.product_id,original.warehouse_id,'customer_return',delta,original.unit_cost_satang,'invoice',invoice.id,original.source_line_id,original.id,invoice.number,0,0);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'invoice',invoice.id,'stock_returned','Returned delivered stock',jsonb_build_object('deliveryId',original.id,'returnedQuantity',p_returned_quantity));
end;
$$;

create or replace function public.adjust_stock(p_org_id uuid,p_product_id uuid,p_warehouse_id uuid,p_count numeric,p_reason text,p_key uuid,p_unit_cost_satang bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare qty numeric; delta numeric; result uuid; new_average numeric;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  if p_key is null or p_count is null or p_count<0 or p_count='NaN'::numeric or p_count<>round(p_count,3) or p_count>999999999.999 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Valid count and reason required';end if;
  if p_unit_cost_satang is not null and p_unit_cost_satang not between 0 and 9007199254740991 then raise exception 'Invalid unit cost';end if;
  perform id from public.products where org_id=p_org_id and id=p_product_id and is_stockable for no key update;
  if not found then raise exception 'Stockable workspace product required';end if;
  perform private.lock_stock_balances(p_org_id,array[p_product_id],array[p_warehouse_id]);
  if exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key) then
    if not exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key and product_id=p_product_id and warehouse_id=p_warehouse_id and quantity=p_count and reason=p_reason and unit_cost_satang is not distinct from p_unit_cost_satang) then raise exception 'Adjustment key conflict';end if;
    select id into result from public.stock_moves where org_id=p_org_id and source_type='adjustment' and source_id=p_key;
    return result;
  end if;
  if not exists(select 1 from public.warehouses where org_id=p_org_id and id=p_warehouse_id and active) then raise exception 'Active workspace warehouse required';end if;
  select quantity into qty from public.stock_on_hand where org_id=p_org_id and product_id=p_product_id and warehouse_id=p_warehouse_id;
  qty:=coalesce(qty,0);delta:=p_count-qty;
  if qty<=0 and delta>0 and p_unit_cost_satang is null then raise exception 'Unit cost required when raising stock from zero or below';end if;
  insert into public.stock_counts(org_id,key,product_id,warehouse_id,quantity,reason,unit_cost_satang) values(p_org_id,p_key,p_product_id,p_warehouse_id,p_count,p_reason,p_unit_cost_satang);
  if delta=0 then return null;end if;
  insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
    values(p_org_id,p_product_id,p_warehouse_id,case when delta>0 then 'adjustment_in'::public.stock_move_kind else 'adjustment_out'::public.stock_move_kind end,abs(delta),coalesce(p_unit_cost_satang,0),'adjustment',p_key,p_reason,0,0) returning id,average_cost_after into result,new_average;
  update public.products set cost_satang=round(new_average) where org_id=p_org_id and id=p_product_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'product',p_product_id,'stock_adjusted','Inventory counted',jsonb_build_object('warehouseId',p_warehouse_id,'count',p_count,'reason',p_reason,'unitCostSatang',p_unit_cost_satang));
  return result;
end;
$$;

create or replace function public.return_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; item public.purchase_order_items; line jsonb; qty numeric; delta numeric; credit_qty numeric; new_billed numeric; credits jsonb:='{}'; category text; amount numeric; warehouse uuid; vendor public.vendors; bill_no text; cost_id uuid; today date:=(now() at time zone 'Asia/Bangkok')::date; changed boolean:=false; before_value numeric; after_qty numeric; after_average numeric; adjustment numeric:=0;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status::text not in ('confirmed','received','closed','billed') then raise exception 'Received purchase quantities required';end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Return lines required';end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_lines)) then raise exception 'Duplicate return line';end if;
  warehouse:=p_warehouse_id;
  if warehouse is null then select id into warehouse from public.warehouses where org_id=p_org_id and is_default and active;end if;
  perform private.lock_stock_balances(p_org_id,array(select product_id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id),array[warehouse]);
  for line in select value from jsonb_array_elements(p_lines) loop
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and id=(line->>'id')::uuid for update;
    if not found then raise exception 'Return line unavailable';end if;
    qty:=(line->>'returned_quantity')::numeric;
    if qty is null or qty='NaN'::numeric or qty<item.returned_quantity or qty>item.received_quantity or qty<>round(qty,3) then raise exception 'Invalid cumulative vendor return quantity';end if;
    delta:=qty-item.returned_quantity;
    if delta=0 then continue;end if;
    category:='other';
    if exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and is_stockable) then
      category:='inventory';
      if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
      if delta>coalesce((select sum(case when kind::text='receipt' then quantity else -quantity end) from public.stock_moves
        where org_id=p_org_id and source_type='purchase_order' and source_id=po.id and product_id=item.product_id and warehouse_id=warehouse
        and (source_line_id=item.id or source_line_id is null) and kind::text in ('receipt','vendor_return')),0) then raise exception 'Return exceeds receipts in this warehouse';end if;
      if delta>coalesce((select sum(case when kind::text='receipt' then quantity else -quantity end) from public.stock_moves
        where org_id=p_org_id and source_type='purchase_order' and source_id=po.id and product_id=item.product_id and warehouse_id=warehouse
        and kind::text in ('receipt','vendor_return')),0) then raise exception 'Return exceeds receipts in this warehouse';end if;
      select round(quantity*average_cost) into before_value from public.stock_balances where org_id=p_org_id and product_id=item.product_id and warehouse_id=warehouse;
      insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,note,balance_after,average_cost_after)
        values(p_org_id,item.product_id,warehouse,'vendor_return',delta,0,'purchase_order',po.id,item.id,po.number,0,0) returning balance_after,average_cost_after into after_qty,after_average;
      adjustment:=adjustment+(round((item.received_quantity-item.returned_quantity)*item.unit_cost_satang)-round((item.received_quantity-qty)*item.unit_cost_satang))-(coalesce(before_value,0)-round(after_qty*after_average));
    end if;
    new_billed:=least(item.billed_quantity,item.received_quantity-qty);
    credit_qty:=item.billed_quantity-new_billed;
    if credit_qty>0 then
      amount:=round(item.billed_quantity*item.unit_cost_satang)-round(new_billed*item.unit_cost_satang);
      credits:=jsonb_set(credits,array[category],to_jsonb(coalesce((credits->>category)::numeric,0)+amount));
    end if;
    update public.purchase_order_items set returned_quantity=qty,billed_quantity=new_billed where org_id=p_org_id and id=item.id;
    changed:=true;
  end loop;
  select * into vendor from public.vendors where org_id=p_org_id and id=po.vendor_id;
  for category,amount in select key,value::numeric from jsonb_each_text(credits) order by key loop
    if amount<0 or amount>9007199254740991 then raise exception 'Credit amount within safe satang bounds required';end if;
    select po.number||'-C'||(count(*)+1)::text into bill_no from public.costs where org_id=p_org_id and purchase_order_id=po.id;
    insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,vendor_id,purchase_order_id,bill_number,bill_date,due_date,purchase_cost_kind,notes)
      values(p_org_id,category::public.cost_category,-amount,today,vendor.name,vendor.id,po.id,bill_no,today,today,'credit','Vendor return credit for '||po.number) returning id into cost_id;
  end loop;
  if abs(adjustment)>9007199254740991 then raise exception 'Adjustment amount within safe satang bounds required';end if;
  if adjustment<>0 then
    select po.number||'-A'||(count(*)+1)::text into bill_no from public.costs where org_id=p_org_id and purchase_order_id=po.id;
    insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,purchase_order_id,bill_number,bill_date,purchase_cost_kind,notes)
      values(p_org_id,'inventory',adjustment,today,vendor.name,po.id,bill_no,today,'return_adjustment','Stock return valuation adjustment for '||po.number);
  end if;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'returned','Returned purchase quantities',jsonb_build_object('lines',p_lines,'warehouseId',warehouse,'credits',credits,'inventoryAdjustmentSatang',adjustment));end if;
end;
$$;


create function public.stock_moves_page(p_org_id uuid,p_before bigint default null,p_kinds text[] default null,
 p_warehouse_id uuid default null,p_product_id uuid default null,p_source_id uuid default null,
 p_actor_id uuid default null,p_start timestamptz default null,p_end timestamptz default null,p_query text default null)
returns setof public.stock_moves language sql stable security invoker set search_path='' as $$
 select m.* from public.stock_moves m
 join public.products p on p.org_id=m.org_id and p.id=m.product_id
 join public.warehouses w on w.org_id=m.org_id and w.id=m.warehouse_id
 where m.org_id=p_org_id and (p_before is null or m.sequence<p_before)
 and (p_kinds is null or m.kind::text=any(p_kinds))
 and (p_warehouse_id is null or m.warehouse_id=p_warehouse_id)
 and (p_product_id is null or m.product_id=p_product_id)
 and (p_source_id is null or m.source_id=p_source_id)
 and (p_actor_id is null or m.created_by=p_actor_id)
 and (p_start is null or m.moved_at>=p_start) and (p_end is null or m.moved_at<p_end)
 and (p_query is null or strpos(lower(p.name||' '||w.code||' '||coalesce(m.note,'')),lower(p_query))>0)
 order by m.sequence desc limit 101;
$$;
revoke all on function public.stock_moves_page(uuid,bigint,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.stock_moves_page(uuid,bigint,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,text) to authenticated;

commit;
