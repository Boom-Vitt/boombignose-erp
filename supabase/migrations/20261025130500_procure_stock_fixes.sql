do $$
begin
  lock table public.stock_moves in access exclusive mode;
  if exists(
    with amounts as (
      select id,org_id,kind,quantity,return_of_move_id,sequence,
        round(balance_after*average_cost_after) as value_after,
        lag(round(balance_after*average_cost_after),1,0::numeric) over(partition by org_id,product_id,warehouse_id order by sequence) as value_before
      from public.stock_moves
    ), returns as (
      select r.value_after-r.value_before as actual_value,r.quantity,d.quantity as delivered_quantity,d.value_before-d.value_after as delivery_value,
        sum(r.quantity) over(partition by r.org_id,r.return_of_move_id order by r.sequence rows unbounded preceding) as cumulative_quantity
      from amounts r join amounts d on d.org_id=r.org_id and d.id=r.return_of_move_id
      where r.kind::text='customer_return' and d.kind::text='delivery'
    )
    select 1 from returns where actual_value<>
      round(cumulative_quantity*delivery_value/delivered_quantity)-round((cumulative_quantity-quantity)*delivery_value/delivered_quantity)
  ) then
    raise exception 'Existing customer return values differ from source delivery allocations; reconcile stock before applying stock-value upgrade';
  end if;
end;
$$;

create function private.lock_product_line_unit(p_org_id uuid,p_product_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare product_unit text;
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace product unavailable';end if;
  select unit into product_unit from public.products where org_id=p_org_id and id=p_product_id for share;
  if not found then raise exception 'Workspace product unavailable';end if;
  return product_unit;
end;
$$;
revoke all on function private.lock_product_line_unit(uuid,uuid) from public,anon;
grant execute on function private.lock_product_line_unit(uuid,uuid) to authenticated;

create or replace function private.guard_product_line_unit()
returns trigger language plpgsql set search_path='' as $$
declare product_unit text;
begin
  if new.product_id is not null then
    if current_user='authenticated' then
      product_unit:=private.lock_product_line_unit(new.org_id,new.product_id);
    else
      select unit into product_unit from public.products where org_id=new.org_id and id=new.product_id for share;
      if not found then raise exception 'Workspace product unavailable';end if;
    end if;
    if new.unit is distinct from product_unit then raise exception 'Product line unit must match product unit';end if;
  end if;
  return new;
end;
$$;

alter table public.stock_moves add column stock_value_satang bigint check(stock_value_satang between 0 and 9007199254740991);
alter table public.stock_moves disable trigger retain_stock_move;
with values_after as (
  select id,round(balance_after*average_cost_after) as value_after,
    lag(round(balance_after*average_cost_after),1,0::numeric) over(partition by org_id,product_id,warehouse_id order by sequence) as value_before
  from public.stock_moves
)
update public.stock_moves m set stock_value_satang=abs(v.value_after-v.value_before)
from values_after v where m.id=v.id;

with returns as (
  select m.id,m.quantity,d.quantity as delivered_quantity,d.stock_value_satang,
    sum(m.quantity) over(partition by m.org_id,m.return_of_move_id order by m.sequence rows unbounded preceding) as cumulative_quantity
  from public.stock_moves m join public.stock_moves d on d.org_id=m.org_id and d.id=m.return_of_move_id
  where m.kind::text='customer_return' and d.kind::text='delivery'
)
update public.stock_moves m set stock_value_satang=
  round(r.cumulative_quantity*r.stock_value_satang/r.delivered_quantity)-round((r.cumulative_quantity-r.quantity)*r.stock_value_satang/r.delivered_quantity)
from returns r where m.id=r.id;
alter table public.stock_moves enable trigger retain_stock_move;
alter table public.stock_moves alter column stock_value_satang set not null;

create or replace view public.monthly_inventory_cogs with(security_invoker=true) as
select org_id,date_trunc('month',moved_at at time zone 'Asia/Bangkok')::date as month,
  sum(case when kind::text='delivery' then stock_value_satang else -stock_value_satang end) as amount_satang
from public.stock_moves where source_type='invoice' and kind::text in ('delivery','customer_return')
group by org_id,date_trunc('month',moved_at at time zone 'Asia/Bangkok')::date;

create or replace function private.value_stock_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare stockable boolean; qty numeric:=0; avg_cost numeric:=0; signed_qty numeric; negative_ok boolean; before_value numeric; original public.stock_moves; prior numeric; return_value numeric;
begin
  select is_stockable into stockable from public.products where org_id=new.org_id and id=new.product_id for update;
  if not found or not stockable then raise exception 'Stockable workspace product required';end if;
  if not exists(select 1 from public.warehouses where org_id=new.org_id and id=new.warehouse_id and active for share) then raise exception 'Active workspace warehouse required';end if;
  select balance_after,average_cost_after into qty,avg_cost from public.stock_moves
    where org_id=new.org_id and product_id=new.product_id and warehouse_id=new.warehouse_id order by sequence desc limit 1;
  qty:=coalesce(qty,0);avg_cost:=coalesce(avg_cost,0);
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
  new.created_by:=auth.uid();
  new.sequence:=nextval(pg_get_serial_sequence('public.stock_moves','sequence'));
  return new;
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
  perform id from public.products where org_id=p_org_id and id in(select product_id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) order by id for update;
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
      select coalesce(round(quantity*average_cost_after),0) into before_value from (
        select balance_after as quantity,average_cost_after from public.stock_moves where org_id=p_org_id and product_id=item.product_id and warehouse_id=warehouse order by sequence desc limit 1
      ) balance;
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
