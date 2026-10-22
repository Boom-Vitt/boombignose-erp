create or replace function private.retain_stockable_product()
returns trigger language plpgsql set search_path='' as $$
begin
  if (old.unit is distinct from new.unit or (old.is_stockable and not new.is_stockable))
    and exists(select 1 from public.stock_moves where org_id=old.org_id and product_id=old.id) then
    if old.unit is distinct from new.unit then raise exception 'Stock unit is locked by stock history';end if;
    raise exception 'Products with stock history must remain stockable';
  end if;
  return new;
end;
$$;
drop trigger retain_stockable_product on public.products;
create trigger retain_stockable_product before update of is_stockable,unit on public.products for each row execute function private.retain_stockable_product();

-- A single JSON result avoids API row caps and offset shifts between balance reads.
create function public.inventory_snapshot(p_org_id uuid,p_warehouse_id uuid default null,p_product_id uuid default null)
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
      'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('quantity',coalesce(t.quantity,0),'value_satang',coalesce(t.value_satang,0)) order by p.name,p.id)
        from public.products p left join totals t on t.product_id=p.id
        where p.org_id=p_org_id and p.is_stockable and (p_product_id is null or p.id=p_product_id)),'[]'::jsonb),
      'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.product_id,b.warehouse_id) from balances b),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.inventory_snapshot(uuid,uuid,uuid) from public,anon;
grant execute on function public.inventory_snapshot(uuid,uuid,uuid) to authenticated;

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
  signed_qty:=case when new.kind in ('receipt','adjustment_in','transfer_in') then new.quantity else -new.quantity end;
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
  -- Identity defaults are evaluated before a wait; allocate order only after the product lock.
  new.sequence:=nextval(pg_get_serial_sequence('public.stock_moves','sequence'));
  return new;
end;
$$;
