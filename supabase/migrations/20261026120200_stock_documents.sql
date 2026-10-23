create table public.stock_documents (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 kind text not null check(kind in ('receipt','delivery')), number text not null, document_date date not null check(isfinite(document_date)),
 warehouse_id uuid, purchase_order_id uuid, invoice_id uuid, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 unique(org_id,id), unique(org_id,number),
 check((kind='receipt' and purchase_order_id is not null and invoice_id is null) or (kind='delivery' and invoice_id is not null and purchase_order_id is null)),
 foreign key(org_id,warehouse_id) references public.warehouses(org_id,id),
 foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id),
 foreign key(org_id,invoice_id) references public.invoices(org_id,id)
);
create table public.stock_document_lines (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id), document_id uuid not null,
 product_id uuid, source_line_id uuid not null, description text not null, unit text not null,
 quantity numeric(12,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
 foreign key(org_id,document_id) references public.stock_documents(org_id,id),
 foreign key(org_id,product_id) references public.products(org_id,id)
);
create index stock_documents_po_idx on public.stock_documents(org_id,purchase_order_id);
create index stock_documents_invoice_idx on public.stock_documents(org_id,invoice_id);
create index stock_document_lines_parent_idx on public.stock_document_lines(org_id,document_id);
do $$ declare t text; begin
 foreach t in array array['stock_documents','stock_document_lines'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_org_member(org_id))',t);
 end loop;
end $$;
alter table public.stock_moves add column document_id uuid,
 add constraint stock_moves_document_tenant_fkey foreign key(org_id,document_id) references public.stock_documents(org_id,id);

create function private.create_stock_document(p_org_id uuid,p_kind text,p_date date,p_warehouse_id uuid,p_parent_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare counter bigint; prefix text; result uuid;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'Valid stock document date required';end if;
 prefix:=case when p_kind='receipt' then 'GRN' when p_kind='delivery' then 'DO' end;
 if prefix is null then raise exception 'Invalid stock document kind';end if;
 insert into public.document_counters(org_id,kind,year,value) values(p_org_id,prefix,extract(year from p_date)::int,1)
 on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
 insert into public.stock_documents(org_id,kind,number,document_date,warehouse_id,purchase_order_id,invoice_id,created_by)
 values(p_org_id,p_kind,prefix||'-'||extract(year from p_date)::text||'-'||lpad(counter::text,greatest(6,length(counter::text)),'0'),p_date,p_warehouse_id,
 case when p_kind='receipt' then p_parent_id end,case when p_kind='delivery' then p_parent_id end,auth.uid()) returning id into result;
 return result;
end;
$$;
revoke all on function private.create_stock_document(uuid,text,date,uuid,uuid) from public,anon,authenticated;

drop function public.receive_purchase_order(uuid,uuid,jsonb,uuid);
create or replace function public.receive_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb,p_warehouse_id uuid default null,p_date date default (now() at time zone 'Asia/Bangkok')::date)
returns void language plpgsql security definer set search_path='' as $$
declare doc_id uuid; po public.purchase_orders; line jsonb; item public.purchase_order_items; qty numeric; changed boolean:=false; warehouse uuid;
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
  if po.status<>'billed' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='received' where org_id=p_org_id and id=po.id;end if;
  if changed then insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'received','Recorded received quantities and stock',jsonb_build_object('lines',p_lines,'warehouseId',warehouse));end if;
end;
$$;
revoke all on function public.receive_purchase_order(uuid,uuid,jsonb,uuid,date) from public,anon;
grant execute on function public.receive_purchase_order(uuid,uuid,jsonb,uuid,date) to authenticated;

drop function public.deliver_invoice(uuid,uuid,uuid,jsonb);
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
revoke all on function public.deliver_invoice(uuid,uuid,uuid,jsonb,date) from public,anon;
grant execute on function public.deliver_invoice(uuid,uuid,uuid,jsonb,date) to authenticated;
