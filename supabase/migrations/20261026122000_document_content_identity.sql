begin;

create function private.touch_document_section_parent()
returns trigger language plpgsql security definer set search_path='' as $$
declare section public.document_sections;
begin
  if tg_op='UPDATE' and (new.kind,new.description,new.lines_before,new.position) is not distinct from
    (old.kind,old.description,old.lines_before,old.position) then return null;end if;
  if tg_op='DELETE' then section:=old;else section:=new;end if;
  if section.quote_id is not null then
    update public.quotes set updated_at=now() where org_id=section.org_id and id=section.quote_id;
  elsif section.invoice_id is not null then
    update public.invoices set updated_at=now() where org_id=section.org_id and id=section.invoice_id;
  else
    update public.purchase_orders set updated_at=now() where org_id=section.org_id and id=section.purchase_order_id;
  end if;
  return null;
end;
$$;
revoke all on function private.touch_document_section_parent() from public,anon,authenticated;
create trigger touch_document_section_parent after insert or update or delete on public.document_sections
  for each row execute function private.touch_document_section_parent();

create function private.purchase_section_content(p_org_id uuid,p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'description',s.description,
    'lines_before',s.lines_before,'position',s.position) order by s.lines_before,s.position,s.id),'[]'::jsonb)
  from public.document_sections s where s.org_id=p_org_id and s.purchase_order_id=p_order_id;
$$;
revoke all on function private.purchase_section_content(uuid,uuid) from public,anon,authenticated;

create or replace function private.purchase_approval_content(p_org_id uuid,p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('vendor',o.vendor_id,'date',o.order_date,'expected',o.expected_date,'notes',o.notes,
    'lines',(select jsonb_agg(jsonb_build_array(i.id,i.product_id,i.description,i.quantity,i.unit,i.unit_cost_satang,i.position) order by i.id)
      from public.purchase_order_items i where i.org_id=o.org_id and i.purchase_order_id=o.id))
    || case when s.content='[]'::jsonb then '{}'::jsonb else jsonb_build_object('sections',s.content) end
  from public.purchase_orders o cross join (select private.purchase_section_content(p_org_id,p_order_id) content) s
  where o.org_id=p_org_id and o.id=p_order_id;
$$;

create or replace function public.claim_purchase_rfq(p_org_id uuid,p_order_id uuid)
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
    'expectedDate',po.expected_date,'notes',po.notes,'lines',lines,'sections',private.purchase_section_content(p_org_id,po.id));
  delivery_key:=gen_random_uuid();
  update public.purchase_orders set status='sent',rfq_snapshot=snapshot,rfq_delivery_key=delivery_key
    where org_id=p_org_id and id=po.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'rfq_claimed','Claimed RFQ delivery',jsonb_build_object('deliveryKey',delivery_key));
  return jsonb_build_object('delivery_key',delivery_key,'snapshot',snapshot);
end;
$$;

commit;
