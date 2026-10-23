begin;

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
  perform private.lock_stock_balances(p_org_id,array(select i.product_id from public.purchase_order_items i join jsonb_array_elements(p_lines) l on i.id=(l->>'id')::uuid where i.org_id=p_org_id and i.purchase_order_id=po.id and (l->>'received_quantity')::numeric>i.received_quantity),array[warehouse]);
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

create or replace function public.deliver_invoice(p_org_id uuid,p_invoice_id uuid,p_warehouse_id uuid default null,p_lines jsonb default null,p_date date default (now() at time zone 'Asia/Bangkok')::date)
returns void language plpgsql security definer set search_path='' as $$
declare doc_id uuid; invoice public.invoices; item record; line jsonb; qty numeric; prior numeric; warehouse uuid; lines jsonb; changed boolean:=false;
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
  perform private.lock_stock_balances(p_org_id,array(select i.product_id from public.invoice_stock_lines i join jsonb_array_elements(lines) l on i.id=(l->>'id')::uuid where i.org_id=p_org_id and i.invoice_id=invoice.id and (l->>'delivered_quantity')::numeric>i.delivered_quantity),array[warehouse]);
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
    if doc_id is null then doc_id:=private.create_stock_document(p_org_id,'delivery',p_date,warehouse,invoice.id);end if;
    insert into public.stock_document_lines(org_id,document_id,product_id,source_line_id,description,unit,quantity)
      values(p_org_id,doc_id,item.product_id,item.id,item.description,item.unit,qty-prior);
    insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,document_id,note,balance_after,average_cost_after)
      values(p_org_id,item.product_id,warehouse,'delivery',qty-prior,0,'invoice',invoice.id,item.id,doc_id,invoice.number,0,0);
    insert into public.invoice_line_stock(org_id,line_id,invoice_id,delivered_quantity) values(p_org_id,item.id,invoice.id,qty)
      on conflict(org_id,line_id) do update set delivered_quantity=excluded.delivered_quantity;
    changed:=true;
  end loop;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'invoice',invoice.id,'delivered','Delivered stockable invoice quantities',jsonb_build_object('lines',lines,'warehouseId',warehouse));end if;
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
  perform private.lock_stock_balances(p_org_id,array(select i.product_id from public.purchase_order_items i join jsonb_array_elements(p_lines) l on i.id=(l->>'id')::uuid where i.org_id=p_org_id and i.purchase_order_id=po.id and (l->>'returned_quantity')::numeric>i.returned_quantity),array[warehouse]);
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

create or replace function public.return_invoice_delivery(p_org_id uuid,p_invoice_id uuid,p_move_id uuid,p_returned_quantity numeric)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; original public.stock_moves; prior numeric; delta numeric; remaining numeric; allocation numeric; item record;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
  select * into invoice from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found or invoice.issued_snapshot_id is null then raise exception 'Issued invoice required';end if;
  select * into original from public.stock_moves where org_id=p_org_id and id=p_move_id and source_type='invoice' and source_id=invoice.id and kind='delivery';
  if not found then raise exception 'Original delivery unavailable';end if;
  select coalesce(sum(quantity),0) into prior from public.stock_moves where org_id=p_org_id and return_of_move_id=original.id and kind::text='customer_return';
  if p_returned_quantity is null or p_returned_quantity='NaN'::numeric or p_returned_quantity<prior or p_returned_quantity>original.quantity or p_returned_quantity<>round(p_returned_quantity,3) then raise exception 'Invalid cumulative customer return quantity';end if;
  delta:=p_returned_quantity-prior;
  if delta=0 then return;end if;
  perform private.lock_stock_balances(p_org_id,array[original.product_id],array[original.warehouse_id]);
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

commit;
