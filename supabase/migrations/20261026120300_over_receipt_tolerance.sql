alter table public.org_settings add column over_receipt_tolerance_percent numeric(5,2) not null default 0 check(over_receipt_tolerance_percent between 0 and 100);
alter table public.purchase_order_items drop constraint purchase_order_items_check;
alter table public.purchase_order_items add constraint purchase_received_quantity_nonnegative check(received_quantity>=0 and received_quantity<>'NaN'::numeric),
 add constraint purchase_received_value_safe check(round(received_quantity*unit_cost_satang)<=9007199254740991);
create or replace function public.receive_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null,p_date date default (now() at time zone 'Asia/Bangkok')::date)
returns void language plpgsql security definer set search_path='' as $$
declare tolerance numeric; doc_id uuid; po public.purchase_orders; line jsonb; item public.purchase_order_items; qty numeric; changed boolean:=false; warehouse uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select coalesce(over_receipt_tolerance_percent,0) into tolerance from public.org_settings where org_id=p_org_id;
  tolerance:=coalesce(tolerance,0);
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
    if qty is null or qty='NaN'::numeric or qty<item.received_quantity or qty*100>item.quantity*(100+tolerance) or qty<>round(qty,3) then raise exception 'Invalid cumulative receipt quantity';end if;
    if qty>item.received_quantity then
      if doc_id is null then doc_id:=private.create_stock_document(p_org_id,'receipt',p_date,warehouse,po.id);end if;
      insert into public.stock_document_lines(org_id,document_id,product_id,source_line_id,description,unit,quantity)
        values(p_org_id,doc_id,item.product_id,item.id,item.description,item.unit,qty-item.received_quantity);
    end if;
    if qty>item.received_quantity and exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and is_stockable) then
      if warehouse is null then raise exception 'Choose or configure a default warehouse';end if;
      if not exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and unit=item.unit) then raise exception 'Product line unit must match product unit';end if;
      insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,document_id,note,balance_after,average_cost_after)
        values(p_org_id,item.product_id,warehouse,'receipt',qty-item.received_quantity,item.unit_cost_satang,'purchase_order',po.id,item.id,doc_id,po.number,0,0);
    end if;
    changed:=changed or qty<>item.received_quantity;
    update public.purchase_order_items set received_quantity=qty where org_id=p_org_id and id=item.id;
  end loop;
  if (select coalesce(sum(round(received_quantity*unit_cost_satang)),0) from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id)>9007199254740991 then raise exception 'Receipt total exceeds safe satang bounds';end if;
  if po.status<>'billed' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='received' where org_id=p_org_id and id=po.id;end if;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'received','Recorded received quantities and stock',jsonb_build_object('lines',p_lines,'warehouseId',warehouse));end if;
end;
$$;
create or replace view public.inventory_forecast with(security_invoker=true) as
select p.org_id,p.id as product_id,coalesce((select sum(greatest(i.quantity-i.received_quantity,0)) from public.purchase_order_items i join public.purchase_orders o on o.org_id=i.org_id and o.id=i.purchase_order_id
    where i.org_id=p.org_id and i.product_id=p.id and o.status::text in ('draft','sent','confirmed')),0) as on_order,
  coalesce((select sum(i.quantity-coalesce(s.delivered_quantity,0)) from public.invoice_items i join public.invoices v on v.org_id=i.org_id and v.id=i.invoice_id
    left join public.invoice_line_stock s on s.org_id=i.org_id and s.line_id=i.id
    where i.org_id=p.org_id and i.product_id=p.id and v.issued_snapshot_id is not null and v.status not in ('draft','cancelled')),0) as reserved_quantity
from public.products p where p.is_stockable;
