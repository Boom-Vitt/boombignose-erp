begin;

alter table public.org_settings add column purchase_approval_threshold_satang bigint check(purchase_approval_threshold_satang between 0 and 9007199254740991);
alter table public.purchase_orders add column approved_by uuid references auth.users(id), add column approved_at timestamptz, add column approval_snapshot jsonb;

create function private.purchase_approval_content(p_org_id uuid,p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('vendor',o.vendor_id,'date',o.order_date,'expected',o.expected_date,'notes',o.notes,
  'lines',(select jsonb_agg(jsonb_build_array(i.id,i.product_id,i.description,i.quantity,i.unit,i.unit_cost_satang,i.position) order by i.id)
   from public.purchase_order_items i where i.org_id=o.org_id and i.purchase_order_id=o.id))
 from public.purchase_orders o where o.org_id=p_org_id and o.id=p_order_id;
$$;
revoke all on function private.purchase_approval_content(uuid,uuid) from public,anon,authenticated;

create function public.approve_purchase_order(p_org_id uuid,p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
 if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may approve purchases';end if;
 select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
 if not found or po.status not in ('draft','sent') then raise exception 'Draft or sent purchase order required';end if;
 if not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) then raise exception 'Add purchase lines first';end if;
 update public.purchase_orders set approved_by=auth.uid(),approved_at=now(),approval_snapshot=private.purchase_approval_content(p_org_id,po.id) where org_id=p_org_id and id=po.id;
 insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'purchase_order',po.id,'approved','Approved current purchase content');
end;
$$;
revoke all on function public.approve_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.approve_purchase_order(uuid,uuid) to authenticated;
create or replace function public.transition_purchase_order(p_org_id uuid,p_order_id uuid,p_status public.purchase_status)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; threshold bigint; total numeric;
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
  if p_status='confirmed' then
    select purchase_approval_threshold_satang into threshold from public.org_settings where org_id=p_org_id for share;
    select coalesce(sum(round(quantity*unit_cost_satang)),0) into total from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id;
    if threshold is not null and total>threshold and (po.approved_at is null or po.approval_snapshot is distinct from private.purchase_approval_content(p_org_id,po.id)) then
      raise exception 'Owner/admin approval required for current purchase content';
    end if;
  end if;
  update public.purchase_orders set status=p_status where org_id=p_org_id and id=po.id;
end;
$$;

commit;
