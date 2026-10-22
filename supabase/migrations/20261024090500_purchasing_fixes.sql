alter table public.purchase_orders
  add column rfq_snapshot jsonb,
  add column rfq_delivery_key uuid,
  add column rfq_delivered_at timestamptz,
  add column rfq_delivery_error text;

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
    if tg_op<>'DELETE' and (new.received_quantity<>0 or new.billed_quantity<>0) then raise exception 'Use receipt and billing commands';end if;
    if tg_op='INSERT' and new.product_id is not null and not exists(select 1 from public.products where org_id=new.org_id and id=new.product_id and active) then raise exception 'Active workspace product required';end if;
  end if;
  if tg_op='DELETE' then return old;end if;
  select coalesce(sum(round(quantity*unit_cost_satang)),0)+round(new.quantity*new.unit_cost_satang)
    into total from public.purchase_order_items where org_id=new.org_id and purchase_order_id=new.purchase_order_id and id<>new.id;
  if total>9007199254740991 then raise exception 'Purchase total exceeds safe satang bounds';end if;
  return new;
end;
$$;

create function public.claim_purchase_rfq(p_org_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; vendor public.vendors; lines jsonb; snapshot jsonb; delivery_key uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found then raise exception 'Purchase order unavailable';end if;
  if po.status<>'draft' then return null;end if;
  select * into vendor from public.vendors where org_id=p_org_id and id=po.vendor_id for share;
  if vendor.email is null or vendor.email like '.%' or strpos(vendor.email,'..')>0 or
    vendor.email !~ '^[A-Za-z0-9_''+.-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*[.])+[A-Za-z]{2,}$' then
    raise exception 'Valid vendor email required';
  end if;
  select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unit_cost_satang',unit_cost_satang) order by position,id)
    into lines from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id;
  if lines is null then raise exception 'Add purchase lines first';end if;
  snapshot:=jsonb_build_object('to',vendor.email,'number',po.number,'vendorName',vendor.name,'orderDate',po.order_date,
    'expectedDate',po.expected_date,'notes',po.notes,'lines',lines);
  delivery_key:=gen_random_uuid();
  update public.purchase_orders set status='sent',rfq_snapshot=snapshot,rfq_delivery_key=delivery_key
    where org_id=p_org_id and id=po.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'rfq_claimed','Claimed RFQ delivery',jsonb_build_object('deliveryKey',delivery_key));
  return jsonb_build_object('delivery_key',delivery_key,'snapshot',snapshot);
end;
$$;

create function public.finish_purchase_rfq(p_org_id uuid,p_order_id uuid,p_delivery_key uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or p_delivery_key is null or po.rfq_delivery_key is distinct from p_delivery_key then
    raise exception 'RFQ delivery unavailable';
  end if;
  if po.rfq_delivered_at is not null then return;end if;
  update public.purchase_orders set rfq_delivered_at=case when p_error is null then now() end,
    rfq_delivery_error=left(p_error,4000) where org_id=p_org_id and id=po.id;
end;
$$;

revoke all on function public.claim_purchase_rfq(uuid,uuid),public.finish_purchase_rfq(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.claim_purchase_rfq(uuid,uuid),public.finish_purchase_rfq(uuid,uuid,uuid,text) to authenticated;
