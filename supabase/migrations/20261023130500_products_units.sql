create or replace function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.invoice_issue_requests;target uuid;lines jsonb;subtotal numeric;counter bigint;yr integer;num text;doc jsonb;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue invoices';end if;
  if p_key is null or p_expected_version is null or p_expected_version<1 then raise exception 'Invalid issue command';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found then raise exception 'Invoice unavailable';end if;
  insert into public.invoice_issue_requests(org_id,key,invoice_id,source_version) values(p_org_id,p_key,i.id,p_expected_version) on conflict do nothing;
  select * into cmd from public.invoice_issue_requests where org_id=p_org_id and key=p_key for update;
  if cmd.invoice_id<>i.id or cmd.source_version<>p_expected_version then raise exception 'Idempotency conflict';end if;
  if cmd.snapshot_id is not null then return cmd.snapshot_id;end if;
  if i.issued_snapshot_id is not null then
    if (select source_version from public.invoice_snapshots where org_id=p_org_id and id=i.issued_snapshot_id)<>p_expected_version then raise exception 'Stale invoice version';end if;
    update public.invoice_issue_requests set snapshot_id=i.issued_snapshot_id where org_id=p_org_id and key=p_key;return i.issued_snapshot_id;
  end if;
  if i.status<>'draft' or i.version<>p_expected_version then raise exception 'Draft at expected version required';end if;
  select * into profile from public.org_settings where org_id=p_org_id for share;
  if not found or profile.legal_name is null or length(btrim(profile.legal_name)) not between 1 and 200 or profile.business_address is null or length(btrim(profile.business_address)) not between 1 and 1000
    or (profile.tax_status='registered' and profile.tax_id is null) then raise exception 'Complete seller profile required';end if;
  select * into buyer from public.clients where org_id=p_org_id and id=i.client_id for share;
  if not found or length(btrim(buyer.name))<1 then raise exception 'Buyer required';end if;
  select coalesce(sum(amount_satang),0),jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position) order by position,id) into subtotal,lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  if lines is null or subtotal>9007199254740991 or i.discount_satang>subtotal or subtotal-i.discount_satang<=0 or i.amount_satang<>subtotal-i.discount_satang then raise exception 'Valid complete priced lines required';end if;
  yr:=extract(year from i.issue_date);
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'INV',yr,1) on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='INV-'||yr::text||'-'||lpad(counter::text,6,'0');
    exit when not exists(select 1 from public.invoices where org_id=p_org_id and number=num and id<>i.id);
  end loop;
  doc:=jsonb_build_object('version',1,'kind','operational_invoice','seller',jsonb_build_object('legalName',profile.legal_name,'address',profile.business_address,'taxId',profile.tax_id,'taxStatus',profile.tax_status),
    'buyer',jsonb_build_object('id',buyer.id,'name',buyer.name,'address',buyer.billing_address,'taxId',buyer.tax_id),
    'document',jsonb_build_object('number',num,'issueDate',i.issue_date,'dueDate',i.due_date,'notes',i.notes,'subtotalSatang',subtotal,'discountSatang',i.discount_satang,'totalSatang',i.amount_satang),'lines',lines);
  insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by) values(p_org_id,i.id,i.version,num,doc,auth.uid()) returning id into target;
  update public.invoices set number=num,status='sent',issued_snapshot_id=target where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'invoice_issued','Issued frozen operational invoice',jsonb_build_object('snapshotId',target,'sourceVersion',i.version,'number',num));
  update public.invoice_issue_requests set snapshot_id=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.issue_invoice(uuid,uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.issue_invoice(uuid,uuid,integer,uuid) to authenticated;
