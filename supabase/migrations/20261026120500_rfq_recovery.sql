begin;

create function public.reopen_purchase_rfq(p_org_id uuid,p_order_id uuid,p_delivery_key uuid,p_verified_not_delivered boolean)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
 if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
 select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
 if not found or po.status<>'sent' or po.rfq_delivery_key is distinct from p_delivery_key or p_delivery_key is null
  or po.rfq_delivered_at is not null or po.rfq_delivery_error is null then raise exception 'Failed RFQ delivery required';end if;
 if p_verified_not_delivered is distinct from true then raise exception 'Verify non-delivery before reopening this RFQ';end if;
 insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
 values(p_org_id,auth.uid(),'purchase_order',po.id,'rfq_reopened','Verified non-delivery and reopened RFQ',
 jsonb_build_object('deliveryKey',po.rfq_delivery_key,'error',po.rfq_delivery_error,'snapshot',po.rfq_snapshot));
 update public.purchase_orders set status='draft',rfq_snapshot=null,rfq_delivery_key=null,rfq_delivery_error=null,rfq_delivered_at=null,
 approved_by=null,approved_at=null,approval_snapshot=null where org_id=p_org_id and id=po.id;
end;
$$;
create function public.update_purchase_order(p_org_id uuid,p_order_id uuid,p_vendor_id uuid,p_order_date date,p_expected_date date,p_notes text)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
 if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
 select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
 if not found or po.status<>'draft' then raise exception 'Only draft purchase orders are editable';end if;
 if not exists(select 1 from public.vendors where org_id=p_org_id and id=p_vendor_id and active for share) then raise exception 'Active workspace vendor required';end if;
 update public.purchase_orders set vendor_id=p_vendor_id,order_date=p_order_date,expected_date=p_expected_date,notes=p_notes,
 approved_by=null,approved_at=null,approval_snapshot=null where org_id=p_org_id and id=po.id;
 insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'purchase_order',po.id,'updated','Updated draft RFQ details');
end;
$$;
revoke all on function public.reopen_purchase_rfq(uuid,uuid,uuid,boolean),public.update_purchase_order(uuid,uuid,uuid,date,date,text) from public,anon;
grant execute on function public.reopen_purchase_rfq(uuid,uuid,uuid,boolean),public.update_purchase_order(uuid,uuid,uuid,date,date,text) to authenticated;

commit;
