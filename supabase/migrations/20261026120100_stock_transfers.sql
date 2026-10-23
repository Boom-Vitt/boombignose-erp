create table public.stock_transfers (
 org_id uuid not null references public.organizations(id), key uuid not null, product_id uuid not null,
 from_warehouse_id uuid not null, to_warehouse_id uuid not null, quantity numeric(12,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 primary key(org_id,key), check(from_warehouse_id<>to_warehouse_id),
 foreign key(org_id,product_id) references public.products(org_id,id),
 foreign key(org_id,from_warehouse_id) references public.warehouses(org_id,id),
 foreign key(org_id,to_warehouse_id) references public.warehouses(org_id,id)
);
alter table public.stock_transfers enable row level security;
alter table public.stock_transfers force row level security;
revoke all on public.stock_transfers from public,anon,authenticated;
grant select on public.stock_transfers to authenticated;
create policy tenant_read on public.stock_transfers for select to authenticated using(private.is_org_member(org_id));
create unique index stock_transfer_one_leg on public.stock_moves(org_id,source_id,kind) where source_type='transfer';
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
  if new.kind::text='transfer_in' then
    select * into original from public.stock_moves where org_id=new.org_id and source_type='transfer' and source_id=new.source_id
      and kind='transfer_out' and product_id=new.product_id and quantity=new.quantity and warehouse_id<>new.warehouse_id;
    if not found then raise exception 'Matching outgoing transfer required';end if;
    new.stock_value_satang:=original.stock_value_satang;
    new.unit_cost_satang:=original.unit_cost_satang;
    return_value:=before_value+new.stock_value_satang;
    if qty+new.quantity=0 then
      if return_value<>0 then raise exception 'Transfer value incompatible with stock balance';end if;
      avg_cost:=0;
    else
      avg_cost:=return_value/(qty+new.quantity);
      if avg_cost<0 then raise exception 'Transfer value incompatible with stock balance';end if;
    end if;
  elsif new.kind::text='customer_return' then
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
  if new.kind::text not in ('customer_return','transfer_in') then
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

create function public.transfer_stock(p_org_id uuid,p_product_id uuid,p_from_warehouse_id uuid,p_to_warehouse_id uuid,p_quantity numeric,p_reason text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.stock_transfers;
begin
 if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage inventory';end if;
 if p_key is null or p_product_id is null or p_from_warehouse_id is null or p_to_warehouse_id is null or p_from_warehouse_id=p_to_warehouse_id
   or p_quantity is null or p_quantity='NaN'::numeric or p_quantity<=0 or p_quantity<>round(p_quantity,3)
   or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Valid transfer details required';end if;
 insert into public.stock_transfers(org_id,key,product_id,from_warehouse_id,to_warehouse_id,quantity,reason,created_by)
  values(p_org_id,p_key,p_product_id,p_from_warehouse_id,p_to_warehouse_id,p_quantity,p_reason,auth.uid()) on conflict do nothing;
 select * into saved from public.stock_transfers where org_id=p_org_id and key=p_key for update;
 if saved.product_id<>p_product_id or saved.from_warehouse_id<>p_from_warehouse_id or saved.to_warehouse_id<>p_to_warehouse_id
   or saved.quantity<>p_quantity or saved.reason<>p_reason then raise exception 'Transfer key conflict';end if;
 if exists(select 1 from public.stock_moves where org_id=p_org_id and source_type='transfer' and source_id=p_key) then return p_key;end if;
 perform private.lock_stock_balances(p_org_id,array[p_product_id],array[p_from_warehouse_id,p_to_warehouse_id]);
 if not exists(select 1 from public.stock_balances where org_id=p_org_id and product_id=p_product_id and warehouse_id=p_from_warehouse_id and quantity>=p_quantity) then raise exception 'Insufficient stock for transfer';end if;
 insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
 values(p_org_id,p_product_id,p_from_warehouse_id,'transfer_out',p_quantity,0,'transfer',p_key,p_reason,0,0);
 insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
 values(p_org_id,p_product_id,p_to_warehouse_id,'transfer_in',p_quantity,0,'transfer',p_key,p_reason,0,0);
 insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
 values(p_org_id,auth.uid(),'product',p_product_id,'stock_transferred','Transferred stock between warehouses',jsonb_build_object('transferKey',p_key,'from',p_from_warehouse_id,'to',p_to_warehouse_id,'quantity',p_quantity));
 return p_key;
end;
$$;
revoke all on function public.transfer_stock(uuid,uuid,uuid,uuid,numeric,text,uuid) from public,anon;
grant execute on function public.transfer_stock(uuid,uuid,uuid,uuid,numeric,text,uuid) to authenticated;
