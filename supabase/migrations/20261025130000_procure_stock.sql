do $$
begin
  if exists(select 1 from (
    select org_id,product_id,unit from public.purchase_order_items
    union all select org_id,product_id,unit from public.quote_items
    union all select org_id,product_id,unit from public.invoice_items
  ) l join public.products p on p.org_id=l.org_id and p.id=l.product_id where l.unit is distinct from p.unit) then
    raise exception 'Existing product line units differ from the catalog; reconcile retained document units before applying procure-stock';
  end if;
end;
$$;

alter type public.purchase_status add value if not exists 'closed';
alter type public.stock_move_kind add value if not exists 'vendor_return';
alter type public.stock_move_kind add value if not exists 'customer_return';
alter type public.cost_category add value if not exists 'inventory';

alter table public.purchase_order_items
  add column returned_quantity numeric(12,3) not null default 0 check(returned_quantity>=0 and returned_quantity<=received_quantity),
  add constraint purchase_net_billed_quantity check(billed_quantity<=received_quantity-returned_quantity);
alter table public.stock_counts add column unit_cost_satang bigint check(unit_cost_satang between 0 and 9007199254740991);
alter table public.stock_moves
  add column source_line_id uuid,
  add column return_of_move_id uuid,
  add constraint stock_moves_org_id_id_key unique(org_id,id),
  add constraint stock_moves_return_tenant_fkey foreign key(org_id,return_of_move_id) references public.stock_moves(org_id,id);
create index stock_moves_return_idx on public.stock_moves(org_id,return_of_move_id) where return_of_move_id is not null;
alter table public.costs add column purchase_cost_kind text check(purchase_cost_kind in ('bill','credit','return_adjustment'));
update public.costs set purchase_cost_kind='bill' where purchase_order_id is not null;


alter table public.invoice_items add constraint invoice_items_stock_tenant_key unique(org_id,id);

create table public.invoice_line_stock (
  org_id uuid not null references public.organizations(id),
  line_id uuid not null,
  invoice_id uuid not null,
  delivered_quantity numeric(12,3) not null default 0 check(delivered_quantity>=0 and delivered_quantity<>'NaN'::numeric),
  returned_quantity numeric(12,3) not null default 0 check(returned_quantity>=0 and returned_quantity<=delivered_quantity),
  primary key(org_id,line_id),
  foreign key(org_id,line_id) references public.invoice_items(org_id,id),
  foreign key(org_id,invoice_id) references public.invoices(org_id,id)
);
alter table public.invoice_line_stock enable row level security;
alter table public.invoice_line_stock force row level security;
revoke all on public.invoice_line_stock from public,anon,authenticated;
grant select on public.invoice_line_stock to authenticated;
create policy tenant_read on public.invoice_line_stock for select to authenticated using(private.is_org_member(org_id));

insert into public.invoice_line_stock(org_id,line_id,invoice_id,delivered_quantity)
select i.org_id,i.id,i.invoice_id,i.quantity from public.invoice_items i
where exists(select 1 from public.stock_moves m where m.org_id=i.org_id and m.source_type='invoice' and m.source_id=i.invoice_id and m.product_id=i.product_id and m.kind::text='delivery');

create view public.invoice_stock_lines with(security_invoker=true) as
select i.*,coalesce(s.delivered_quantity,0) as delivered_quantity,coalesce(s.returned_quantity,0) as returned_quantity,p.is_stockable
from public.invoice_items i join public.products p on p.org_id=i.org_id and p.id=i.product_id
left join public.invoice_line_stock s on s.org_id=i.org_id and s.line_id=i.id;
grant select on public.invoice_stock_lines to authenticated;

create view public.monthly_inventory_cogs with(security_invoker=true) as
with returns as (
  select org_id,moved_at,quantity,unit_cost_satang,
    sum(quantity) over(partition by org_id,return_of_move_id order by sequence rows between unbounded preceding and current row) as cumulative_quantity
  from public.stock_moves where source_type='invoice' and kind::text='customer_return'
), amounts as (
  select org_id,moved_at,round(quantity*unit_cost_satang) as amount_satang
    from public.stock_moves where source_type='invoice' and kind::text='delivery'
  union all
  select org_id,moved_at,-(round(cumulative_quantity*unit_cost_satang)-round((cumulative_quantity-quantity)*unit_cost_satang))
    from returns
)
select org_id,date_trunc('month',moved_at at time zone 'Asia/Bangkok')::date as month,sum(amount_satang) as amount_satang
from amounts group by org_id,date_trunc('month',moved_at at time zone 'Asia/Bangkok')::date;
grant select on public.monthly_inventory_cogs to authenticated;

create function private.guard_product_line_unit()
returns trigger language plpgsql set search_path='' as $$
declare product_unit text;
begin
  if new.product_id is not null then
    select unit into product_unit from public.products where org_id=new.org_id and id=new.product_id for share;
    if found and new.unit is distinct from product_unit then raise exception 'Product line unit must match product unit';end if;
  end if;
  return new;
end;
$$;
create trigger a_product_line_unit before insert or update of product_id,unit on public.quote_items for each row execute function private.guard_product_line_unit();
create trigger a_product_line_unit before insert or update of product_id,unit on public.invoice_items for each row execute function private.guard_product_line_unit();

create function private.guard_referenced_product_unit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.unit is distinct from old.unit and (
    exists(select 1 from public.purchase_order_items where org_id=old.org_id and product_id=old.id) or
    exists(select 1 from public.quote_items where org_id=old.org_id and product_id=old.id) or
    exists(select 1 from public.invoice_items where org_id=old.org_id and product_id=old.id)) then
    raise exception 'Product unit is locked by document lines';
  end if;
  return new;
end;
$$;
create trigger z_referenced_product_unit before update of unit on public.products for each row execute function private.guard_referenced_product_unit();
revoke all on function private.guard_referenced_product_unit() from public,anon,authenticated;

create or replace function private.guard_purchase_line()
returns trigger language plpgsql set search_path='' as $$
declare po public.purchase_orders; target_org uuid; target_order uuid; total numeric;
begin
  target_org:=case when tg_op='DELETE' then old.org_id else new.org_id end;
  target_order:=case when tg_op='DELETE' then old.purchase_order_id else new.purchase_order_id end;
  if current_user='authenticated' then
    select * into po from private.lock_purchase_order_for_line(target_org,target_order);
  else
    select * into po from public.purchase_orders where org_id=target_org and id=target_order for no key update;
    if not found then
      if tg_op='DELETE' then return old;end if;
      raise exception 'Purchase order unavailable';
    end if;
  end if;
  if current_user='authenticated' then
    if po.status<>'draft' then raise exception 'Only draft purchase lines are editable';end if;
    if tg_op<>'DELETE' and (new.received_quantity<>0 or new.billed_quantity<>0 or new.returned_quantity<>0) then raise exception 'Use receipt and billing commands';end if;
    if tg_op='INSERT' and new.product_id is not null and not exists(select 1 from public.products where org_id=new.org_id and id=new.product_id and active) then raise exception 'Active workspace product required';end if;
  end if;
  if tg_op='DELETE' then return old;end if;
  if tg_op='INSERT' or new.product_id is distinct from old.product_id or new.unit is distinct from old.unit then
    perform id from public.products where org_id=new.org_id and id=new.product_id for share;
    if new.product_id is not null and not exists(select 1 from public.products where org_id=new.org_id and id=new.product_id and unit=new.unit) then
      raise exception 'Product line unit must match product unit';
    end if;
  end if;
  select coalesce(sum(round(quantity*unit_cost_satang)),0)+round(new.quantity*new.unit_cost_satang)
    into total from public.purchase_order_items where org_id=new.org_id and purchase_order_id=new.purchase_order_id and id<>new.id;
  if total>9007199254740991 then raise exception 'Purchase total exceeds safe satang bounds';end if;
  return new;
end;
$$;

create or replace function public.transition_purchase_order(p_org_id uuid,p_order_id uuid,p_status public.purchase_status)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found then raise exception 'Purchase order unavailable';end if;
  if po.status=p_status then return;end if;
  if not ((po.status='draft' and p_status='sent') or (po.status in ('draft','sent') and p_status='confirmed') or
    (po.status='confirmed' and p_status::text='closed' and exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity>0)) or
    (po.status in ('draft','sent','confirmed') and p_status='cancelled' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity>0))) then
    raise exception 'Invalid purchase transition';end if;
  if p_status in ('sent','confirmed') and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) then raise exception 'Add purchase lines first';end if;
  update public.purchase_orders set status=p_status where org_id=p_org_id and id=po.id;
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
  perform id from public.products where org_id=p_org_id and id in(select product_id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) order by id for update;
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

create or replace function public.bill_purchase_order(p_org_id uuid,p_order_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; vendor public.vendors; bucket record; result uuid; bill_no text; today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status::text not in ('confirmed','received','closed','billed') then raise exception 'Received purchase quantities required';end if;
  if not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity-returned_quantity>billed_quantity) then
    select id into result from public.costs where org_id=p_org_id and purchase_order_id=po.id and purchase_cost_kind='bill' order by created_at desc,id desc limit 1;
    if result is null then raise exception 'Receive quantities before creating a bill';end if;
    return result;
  end if;
  select * into vendor from public.vendors where org_id=p_org_id and id=po.vendor_id;
  for bucket in select case when p.is_stockable then 'inventory' else 'other' end as category,
      sum(round((i.received_quantity-i.returned_quantity)*i.unit_cost_satang)-round(i.billed_quantity*i.unit_cost_satang)) as amount
    from public.purchase_order_items i left join public.products p on p.org_id=i.org_id and p.id=i.product_id
    where i.org_id=p_org_id and i.purchase_order_id=po.id and i.received_quantity-i.returned_quantity>i.billed_quantity
    group by case when p.is_stockable then 'inventory' else 'other' end order by 1 loop
    if bucket.amount<0 or bucket.amount>9007199254740991 then raise exception 'Bill amount within safe satang bounds required';end if;
    select po.number||'-B'||(count(*)+1)::text into bill_no from public.costs where org_id=p_org_id and purchase_order_id=po.id;
    insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,vendor_id,purchase_order_id,bill_number,bill_date,due_date,notes,purchase_cost_kind)
      values(p_org_id,bucket.category::public.cost_category,bucket.amount,today,vendor.name,vendor.id,po.id,bill_no,today,today+vendor.payment_terms_days,'Vendor bill for '||po.number,'bill') returning id into result;
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
      values(p_org_id,auth.uid(),'purchase_order',po.id,'bill_created','Created vendor bill '||bill_no,jsonb_build_object('costId',result,'amount_satang',bucket.amount,'category',bucket.category));
  end loop;
  update public.purchase_order_items set billed_quantity=received_quantity-returned_quantity where org_id=p_org_id and purchase_order_id=po.id;
  if po.status::text<>'closed' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='billed' where org_id=p_org_id and id=po.id;
  end if;
  return result;
end;
$$;

create or replace function private.value_stock_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare stockable boolean; qty numeric:=0; avg_cost numeric:=0; signed_qty numeric; negative_ok boolean;
begin
  select is_stockable into stockable from public.products where org_id=new.org_id and id=new.product_id for update;
  if not found or not stockable then raise exception 'Stockable workspace product required';end if;
  if not exists(select 1 from public.warehouses where org_id=new.org_id and id=new.warehouse_id and active for share) then raise exception 'Active workspace warehouse required';end if;
  select balance_after,average_cost_after into qty,avg_cost from public.stock_moves
    where org_id=new.org_id and product_id=new.product_id and warehouse_id=new.warehouse_id order by sequence desc limit 1;
  qty:=coalesce(qty,0);avg_cost:=coalesce(avg_cost,0);
  signed_qty:=case when new.kind::text in ('receipt','adjustment_in','transfer_in','customer_return') then new.quantity else -new.quantity end;
  select allow_negative_stock into negative_ok from public.org_settings where org_id=new.org_id;
  if signed_qty<0 and qty+signed_qty<0 and not coalesce(negative_ok,false) then raise exception 'Insufficient stock';end if;
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
  new.sequence:=nextval(pg_get_serial_sequence('public.stock_moves','sequence'));
  return new;
end;
$$;

create function public.return_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null)
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
      adjustment:=adjustment+(round(qty*item.unit_cost_satang)-round(item.returned_quantity*item.unit_cost_satang))-(coalesce(before_value,0)-round(after_qty*after_average));
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

drop function public.deliver_invoice(uuid,uuid,uuid);
create function public.deliver_invoice(p_org_id uuid,p_invoice_id uuid,p_warehouse_id uuid default null,p_lines jsonb default null)
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
  perform p.id from public.products p where p.org_id=p_org_id and p.id in(select product_id from public.invoice_items where org_id=p_org_id and invoice_id=invoice.id) order by p.id for update;
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

create function public.return_invoice_delivery(p_org_id uuid,p_invoice_id uuid,p_move_id uuid,p_returned_quantity numeric)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; original public.stock_moves; prior numeric; delta numeric; remaining numeric; allocation numeric; item record;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  select * into invoice from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found or invoice.issued_snapshot_id is null then raise exception 'Issued invoice required';end if;
  select * into original from public.stock_moves where org_id=p_org_id and id=p_move_id and source_type='invoice' and source_id=invoice.id and kind='delivery';
  if not found then raise exception 'Original delivery unavailable';end if;
  perform id from public.products where org_id=p_org_id and id=original.product_id for update;
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

drop function public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid);
create function public.adjust_stock(p_org_id uuid,p_product_id uuid,p_warehouse_id uuid,p_count numeric,p_reason text,p_key uuid,p_unit_cost_satang bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare qty numeric; delta numeric; result uuid; new_average numeric;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  if p_key is null or p_count is null or p_count<0 or p_count='NaN'::numeric or p_count<>round(p_count,3) or p_count>999999999.999 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Valid count and reason required';end if;
  if p_unit_cost_satang is not null and p_unit_cost_satang not between 0 and 9007199254740991 then raise exception 'Invalid unit cost';end if;
  perform id from public.products where org_id=p_org_id and id=p_product_id and is_stockable for update;
  if not found then raise exception 'Stockable workspace product required';end if;
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

create or replace function public.save_warehouse(p_org_id uuid,p_id uuid,p_code text,p_name text,p_address text,p_default boolean,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  perform 1 from public.organizations where id=p_org_id for no key update;
  if p_id is not null then
    perform id from public.warehouses where org_id=p_org_id and id=p_id for update;
    if not found then raise exception 'Warehouse unavailable';end if;
    if not p_active and exists(select 1 from public.stock_on_hand where org_id=p_org_id and warehouse_id=p_id and quantity<>0) then raise exception 'Warehouse has a non-zero stock balance';end if;
  end if;
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

create view public.inventory_forecast with(security_invoker=true) as
select p.org_id,p.id as product_id,coalesce((select sum(i.quantity-i.received_quantity) from public.purchase_order_items i join public.purchase_orders o on o.org_id=i.org_id and o.id=i.purchase_order_id
    where i.org_id=p.org_id and i.product_id=p.id and o.status::text in ('draft','sent','confirmed')),0) as on_order,
  coalesce((select sum(i.quantity-coalesce(s.delivered_quantity,0)) from public.invoice_items i join public.invoices v on v.org_id=i.org_id and v.id=i.invoice_id
    left join public.invoice_line_stock s on s.org_id=i.org_id and s.line_id=i.id
    where i.org_id=p.org_id and i.product_id=p.id and v.issued_snapshot_id is not null and v.status not in ('draft','cancelled')),0) as reserved_quantity
from public.products p where p.is_stockable;
grant select on public.inventory_forecast to authenticated;

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
      'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('quantity',coalesce(t.quantity,0),'value_satang',coalesce(t.value_satang,0),'on_order',f.on_order,'reserved_quantity',f.reserved_quantity) order by p.name,p.id)
        from public.products p join public.inventory_forecast f on f.org_id=p.org_id and f.product_id=p.id left join totals t on t.product_id=p.id
        where p.org_id=p_org_id and p.is_stockable and (p_product_id is null or p.id=p_product_id)),'[]'::jsonb),
      'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.product_id,b.warehouse_id) from balances b),'[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.create_replenishment_rfq(p_org_id uuid,p_vendor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; item record; pos integer:=0;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  perform id from public.vendors where org_id=p_org_id and id=p_vendor_id and active for no key update;
  if not found then raise exception 'Active workspace vendor required';end if;
  perform id from public.products where org_id=p_org_id and default_vendor_id=p_vendor_id order by id for update;
  for item in select p.*,greatest(p.reorder_qty,p.reorder_min-s.quantity-f.on_order) as order_quantity
    from public.products p join public.inventory_totals s on s.org_id=p.org_id and s.product_id=p.id
    join public.inventory_forecast f on f.org_id=p.org_id and f.product_id=p.id
    where p.org_id=p_org_id and p.active and p.is_stockable and p.default_vendor_id=p_vendor_id and s.quantity+f.on_order<p.reorder_min and p.reorder_qty>0 order by p.id loop
    if result is null then result:=public.create_purchase_order(p_org_id,p_vendor_id,(now() at time zone 'Asia/Bangkok')::date,null,'Inventory replenishment');end if;
    insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,position)
      values(p_org_id,result,item.id,coalesce(item.description,item.name),item.order_quantity,item.unit,item.cost_satang,pos);
    pos:=pos+1;
  end loop;
  if result is null then raise exception 'No products require replenishment';end if;
  return result;
end;
$$;

revoke all on function private.guard_product_line_unit() from public,anon,authenticated;
revoke all on function public.deliver_invoice(uuid,uuid,uuid,jsonb),public.return_invoice_delivery(uuid,uuid,uuid,numeric),public.return_purchase_order(uuid,uuid,jsonb,uuid),public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,bigint) from public,anon;
grant execute on function public.deliver_invoice(uuid,uuid,uuid,jsonb),public.return_invoice_delivery(uuid,uuid,uuid,numeric),public.return_purchase_order(uuid,uuid,jsonb,uuid),public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,bigint) to authenticated;
