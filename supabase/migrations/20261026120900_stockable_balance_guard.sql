begin;

create or replace function private.value_stock_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare  qty numeric:=0; avg_cost numeric:=0; signed_qty numeric; negative_ok boolean; before_value numeric; original public.stock_moves; prior numeric; return_value numeric;
begin
  perform private.lock_stock_balances(new.org_id,array[new.product_id],array[new.warehouse_id]);
  if not exists(select 1 from public.products where org_id=new.org_id and id=new.product_id and is_stockable) then raise exception 'Stockable workspace product required';end if;
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

commit;
