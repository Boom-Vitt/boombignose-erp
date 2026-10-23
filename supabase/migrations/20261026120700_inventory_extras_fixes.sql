create or replace function private.lock_stock_balances(p_org_id uuid,p_products uuid[],p_warehouses uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare product uuid; warehouse uuid;
begin
  perform id from public.products where org_id=p_org_id and id=any(p_products) order by id for share;
  if not exists(select 1 from public.products where org_id=p_org_id and id=any(p_products) and is_stockable) then return;end if;
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
    if qty is null or qty='NaN'::numeric or qty<item.received_quantity or (qty>item.received_quantity and qty*100>item.quantity*(100+tolerance)) or qty<>round(qty,3) then raise exception 'Invalid cumulative receipt quantity';end if;
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

create or replace function public.adjust_stock(p_org_id uuid,p_product_id uuid,p_warehouse_id uuid,p_count numeric,p_reason text,p_key uuid,p_unit_cost_satang bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare qty numeric; delta numeric; result uuid; new_average numeric;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  if p_key is null or p_count is null or p_count<0 or p_count='NaN'::numeric or p_count<>round(p_count,3) or p_count>999999999.999 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Valid count and reason required';end if;
  if p_unit_cost_satang is not null and p_unit_cost_satang not between 0 and 9007199254740991 then raise exception 'Invalid unit cost';end if;
  perform id from public.products where org_id=p_org_id and id=p_product_id and is_stockable for no key update;
  if not found then raise exception 'Stockable workspace product required';end if;
  if exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key) then
    if not exists(select 1 from public.stock_counts where org_id=p_org_id and key=p_key and product_id=p_product_id and warehouse_id=p_warehouse_id and quantity=p_count and reason=p_reason and unit_cost_satang is not distinct from p_unit_cost_satang) then raise exception 'Adjustment key conflict';end if;
    select id into result from public.stock_moves where org_id=p_org_id and source_type='adjustment' and source_id=p_key;
    return result;
  end if;
  perform private.lock_stock_balances(p_org_id,array[p_product_id],array[p_warehouse_id]);
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
