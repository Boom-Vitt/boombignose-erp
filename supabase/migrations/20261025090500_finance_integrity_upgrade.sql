-- Upgrade retained documents without reissuing or repricing historical records.
create function private.reconcile_document_counters()
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.document_counters(org_id,kind,year,value)
    select org_id,parts[1],parts[2]::integer,max(parts[3]::numeric)::bigint
    from (
      select org_id,regexp_match(number,'^(INV)-([0-9]{4})-([0-9]+)$') parts from public.invoices
      union all select org_id,regexp_match(number,'^(INV)-([0-9]{4})-([0-9]+)$') from public.invoice_snapshots
      union all select org_id,regexp_match(number,'^(PO)-([0-9]{4})-([0-9]+)$') from public.purchase_orders
      union all select org_id,regexp_match(number,'^(EXP)-([0-9]{4})-([0-9]+)$') from public.expense_claims
    ) historical where parts is not null group by org_id,parts[1],parts[2]
    on conflict(org_id,kind,year) do update set value=greatest(document_counters.value,excluded.value);
exception when numeric_value_out_of_range then raise exception 'Historical document number exceeds counter capacity';
end;
$$;
revoke all on function private.reconcile_document_counters() from public,anon,authenticated,service_role;
select private.reconcile_document_counters();

create function private.allocate_invoice_number(p_org_id uuid,p_year integer)
returns text language plpgsql security definer set search_path='' as $$
declare counter bigint;num text;
begin
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'INV',p_year,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='INV-'||p_year::text||'-'||case when length(counter::text)<6 then lpad(counter::text,6,'0') else counter::text end;
    exit when not exists(select 1 from public.invoices where org_id=p_org_id and number=num)
      and not exists(select 1 from public.invoice_snapshots where org_id=p_org_id and number=num);
  end loop;
  return num;
exception when numeric_value_out_of_range then raise exception 'Invoice number counter exhausted';
end;
$$;
revoke all on function private.allocate_invoice_number(uuid,integer) from public,anon,authenticated,service_role;

create or replace function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.invoice_issue_requests;target uuid;lines jsonb;subtotal numeric;totals jsonb;yr integer;num text;doc jsonb;today date:=(now() at time zone 'Asia/Bangkok')::date;
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
    or (profile.vat_registered and profile.tax_id is null) then raise exception 'Complete seller profile required';end if;
  perform private.assert_finance_date_open(p_org_id,today);
  if not profile.vat_registered and exists(select 1 from public.invoice_items where org_id=p_org_id and invoice_id=i.id and tax_rate_bps>0) then raise exception 'VAT registration required for taxable lines';end if;
  select * into buyer from public.clients where org_id=p_org_id and id=i.client_id for share;
  if not found or length(btrim(buyer.name))<1 then raise exception 'Buyer required';end if;
  select coalesce(sum(amount_satang),0),jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position,'taxRateBps',tax_rate_bps) order by position,id) into subtotal,lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  select private.document_tax_totals(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),i.discount_satang,i.prices_include_vat,i.wht_rate_bps) into totals from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  if lines is null or subtotal>9007199254740991 or i.discount_satang>subtotal or i.amount_satang<=0 or i.amount_satang<>(totals->>'amountDueSatang')::bigint then raise exception 'Valid complete priced lines required';end if;
  i.issue_date:=today;
  yr:=extract(year from today);
  num:=private.allocate_invoice_number(p_org_id,yr);
  doc:=jsonb_build_object('version',1,'kind','operational_invoice','seller',jsonb_build_object('legalName',profile.legal_name,'address',profile.business_address,'taxId',profile.tax_id,'taxStatus',profile.tax_status,'vatRegistered',profile.vat_registered,'branchLabel',profile.branch_label),
    'buyer',jsonb_build_object('id',buyer.id,'name',buyer.name,'address',buyer.billing_address,'taxId',buyer.tax_id,'branchLabel',buyer.branch_label),
    'document',jsonb_build_object('number',num,'issueDate',i.issue_date,'dueDate',i.due_date,'notes',i.notes,'subtotalSatang',subtotal,'discountSatang',i.discount_satang,'totalSatang',i.total_satang,'vatSatang',i.vat_satang,'whtSatang',i.wht_satang,'whtRateBps',i.wht_rate_bps,'amountDueSatang',i.amount_satang,'pricesIncludeVat',i.prices_include_vat,'vatByRate',i.tax_breakdown),'lines',lines);
  insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by) values(p_org_id,i.id,i.version,num,doc,auth.uid()) returning id into target;
  update public.invoices set number=num,issue_date=today,status='sent',issued_snapshot_id=target where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'invoice_issued','Issued frozen operational invoice',jsonb_build_object('snapshotId',target,'sourceVersion',i.version,'number',num));
  update public.invoice_issue_requests set snapshot_id=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create function public.adopt_legacy_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.payment_command_results;req jsonb;target uuid;lines jsonb;doc jsonb;seller_name text;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may adopt legacy invoices';end if;
  if p_key is null or p_expected_version is null or p_expected_version<1 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Invalid legacy adoption command';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found then raise exception 'Invoice unavailable';end if;
  req:=jsonb_build_object('operation','legacy_invoice_adoption','invoice',i.id,'version',p_expected_version,'reason',btrim(p_reason));
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if i.issued_snapshot_id is not null or i.status not in ('sent','overdue','partially_paid','paid') or i.version<>p_expected_version then raise exception 'Legacy payable invoice at expected version required';end if;
  select * into profile from public.org_settings where org_id=p_org_id for share;
  select coalesce(nullif(btrim(profile.legal_name),''),name) into seller_name from public.organizations where id=p_org_id for share;
  select * into buyer from public.clients where org_id=p_org_id and id=i.client_id for share;
  if not found then raise exception 'Buyer required';end if;
  select coalesce(jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position,'taxRateBps',tax_rate_bps) order by position,id),'[]') into lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  doc:=jsonb_build_object('version',1,'kind','legacy_operational_invoice',
    'legacy',jsonb_build_object('reason',btrim(p_reason),'adoptedAt',now(),'profilesCapturedAt',now(),'originalInvoice',to_jsonb(i)-array['version','updated_at','issued_snapshot_id']),
    'seller',jsonb_build_object('legalName',seller_name,'address',coalesce(profile.business_address,''),'taxId',profile.tax_id,'taxStatus','unknown','vatRegistered',false,'branchLabel',profile.branch_label),
    'buyer',jsonb_build_object('id',buyer.id,'name',buyer.name,'address',buyer.billing_address,'taxId',buyer.tax_id,'branchLabel',buyer.branch_label),
    'document',jsonb_build_object('number',i.number,'issueDate',i.issue_date,'dueDate',i.due_date,'notes',i.notes,'subtotalSatang',i.subtotal_satang,'discountSatang',i.discount_satang,'totalSatang',i.total_satang,'vatSatang',i.vat_satang,'whtSatang',i.wht_satang,'whtRateBps',i.wht_rate_bps,'amountDueSatang',i.amount_satang,'pricesIncludeVat',i.prices_include_vat,'vatByRate',i.tax_breakdown),'lines',lines);
  insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by) values(p_org_id,i.id,i.version,i.number,doc,auth.uid()) returning id into target;
  update public.invoices set issued_snapshot_id=target where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'invoice',i.id,'invoice_legacy_adopted','Adopted historical invoice without reissuing or changing receipt evidence',jsonb_build_object('snapshotId',target,'sourceVersion',i.version,'number',i.number,'reason',btrim(p_reason),'profilesCapturedAt',now()));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.adopt_legacy_invoice(uuid,uuid,integer,uuid,text) from public,anon,service_role;
grant execute on function public.adopt_legacy_invoice(uuid,uuid,integer,uuid,text) to authenticated;

create or replace function private.guard_invoice_settlement()
returns trigger language plpgsql set search_path = '' as $$
declare paid bigint;
begin
  if tg_op='UPDATE' and new.org_id<>old.org_id then raise exception 'Tenant reassignment forbidden'; end if;
  -- Linking an audited historical snapshot preserves its original state, even if cash disagrees.
  if tg_op='UPDATE' and old.issued_snapshot_id is null and new.issued_snapshot_id is not null
    and to_jsonb(new)-array['version','updated_at','issued_snapshot_id']=to_jsonb(old)-array['version','updated_at','issued_snapshot_id']
    and exists(select 1 from public.invoice_snapshots s where s.org_id=old.org_id and s.invoice_id=old.id and s.id=new.issued_snapshot_id
      and s.source_version=old.version and s.snapshot->>'kind'='legacy_operational_invoice'
      and s.snapshot->'legacy'->'originalInvoice'=to_jsonb(old)-array['version','updated_at','issued_snapshot_id']) then return new;end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments
    where org_id=new.org_id and invoice_id=new.id and verification_state='verified';
  if tg_op='UPDATE' and new.client_id<>old.client_id and exists(select 1 from public.payment_claims where org_id=old.org_id and invoice_id=old.id and status='pending') then
    raise exception 'Pending claim prevents customer reassignment'; end if;
  if paid>0 and paid=new.amount_satang and new.status<>'paid' then raise exception 'Settled invoice must remain paid'; end if;
  if new.status='paid' and (new.amount_satang=0 or paid<>new.amount_satang) then
    raise exception 'Paid state requires verified settlement';
  end if;
  if new.status='partially_paid' and (paid<=0 or paid>=new.amount_satang) then
    raise exception 'Partial state requires verified settlement';
  end if;
  if paid>0 and (new.status in ('draft','cancelled','sent') or
    (tg_op='UPDATE' and (new.amount_satang<>old.amount_satang or new.client_id<>old.client_id
      or new.project_id is distinct from old.project_id or new.number<>old.number))) then
    raise exception 'Verified invoices require an explicit correction';
  end if;
  return new;
end;
$$;

create or replace function public.submit_payment_claim(p_token text,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.clients; i public.invoices; existing public.payment_claims; paid numeric;pending numeric; v_result uuid; cmd public.portal_claim_requests; req jsonb;
begin
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991
    or p_reference is null or length(btrim(p_reference)) not between 1 and 500 then raise exception 'Invalid claim'; end if;
  select * into c from public.clients where portal_token=p_token and portal_enabled for share;
  if not found then raise exception 'Portal unavailable'; end if;
  select * into i from public.invoices where id=p_invoice_id and org_id=c.org_id and client_id=c.id for update;
  if not found then raise exception 'Invoice unavailable'; end if;
  req:=jsonb_build_object('invoice',i.id,'client',c.id,'amount',p_amount_satang,'reference',btrim(p_reference));
  insert into public.portal_claim_requests(org_id,key,request) values(c.org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.portal_claim_requests where org_id=c.org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;

  select * into existing from public.payment_claims where org_id=c.org_id and idempotency_key=p_key;
  if found then
    if existing.invoice_id<>i.id or existing.amount_satang<>p_amount_satang or existing.reference<>btrim(p_reference) then
      raise exception 'Idempotency conflict'; end if;
    update public.portal_claim_requests set result=existing.id where org_id=c.org_id and key=p_key;
    return existing.id;
  end if;
  if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid','paid') then raise exception 'Invoice is not payable'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=c.org_id and invoice_id=i.id and verification_state='verified';
  select coalesce(sum(amount_satang),0) into pending from public.payment_claims where org_id=c.org_id and invoice_id=i.id and status='pending';
  if p_amount_satang+pending>i.amount_satang-paid then raise exception 'Claim exceeds unclaimed open balance';end if;
  insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key)
    values(c.org_id,c.id,i.id,p_amount_satang,btrim(p_reference),p_key) returning id into v_result;
  insert into public.audit_log(org_id,entity,entity_id,action,summary,meta)
    values(c.org_id,'payment_claim',v_result,'payment_claim_submitted','Customer reported payment; awaiting verification',jsonb_build_object('invoiceId',i.id));
  update public.portal_claim_requests set result=v_result where org_id=c.org_id and key=p_key;
  return v_result;
end;
$$;

create or replace function public.submit_internal_payment_claim(p_org_id uuid,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices; cmd public.portal_claim_requests; req jsonb; paid numeric;pending numeric; target uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may report internal payments'; end if;
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991 or p_reference is null or length(btrim(p_reference)) not between 1 and 500 then raise exception 'Invalid payment report'; end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found then raise exception 'Invoice unavailable'; end if;
  req:=jsonb_build_object('source','staff','invoice',i.id,'client',i.client_id,'amount',p_amount_satang,'reference',btrim(p_reference));
  insert into public.portal_claim_requests(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.portal_claim_requests where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid','paid') then raise exception 'Invoice is not payable'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=p_org_id and invoice_id=i.id and verification_state='verified';
  select coalesce(sum(amount_satang),0) into pending from public.payment_claims where org_id=p_org_id and invoice_id=i.id and status='pending';
  if p_amount_satang+pending>i.amount_satang-paid then raise exception 'Report exceeds unclaimed open balance';end if;
  insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key,source,submitted_by)
    values(p_org_id,i.client_id,i.id,p_amount_satang,btrim(p_reference),p_key,'staff',actor) returning id into target;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,actor,'payment_claim',target,'payment_claim_submitted','Staff reported receipt; verification required',jsonb_build_object('invoiceId',i.id));
  update public.portal_claim_requests set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create or replace function public.review_payment_claim_with_evidence(p_org_id uuid,p_claim_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_decision text,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.payment_claims; i public.invoices; cmd public.payment_command_results; req jsonb; paid numeric; receipt uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may verify payments'; end if;
  if p_key is null or p_decision is null or p_decision not in ('verified','rejected') or p_amount_satang is null
    or p_reference is null or length(btrim(p_reference)) not between 3 and 500 then raise exception 'Invalid verification evidence'; end if;
  if p_decision='verified' and (p_paid_on is null or not isfinite(p_paid_on) or p_method is null
    or p_paid_on>(now() at time zone 'Asia/Bangkok')::date) then raise exception 'Invalid verification evidence';end if;
  req:=jsonb_build_object('operation','review_with_evidence','claim',p_claim_id,'amount',p_amount_satang,'reference',btrim(p_reference),'decision',p_decision,'paidOn',p_paid_on,'method',p_method);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id;
  if not found then raise exception 'Claim unavailable'; end if;
  select * into i from public.invoices where org_id=p_org_id and id=c.invoice_id for update;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id for update;
  if c.client_id<>i.client_id or c.status<>'pending' then raise exception 'Claim unavailable for review'; end if;
  if p_decision='rejected' then
    if p_amount_satang<>0 then raise exception 'Rejected claim has no settlement'; end if;
    receipt:=c.id;
  else
    if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid','paid') then raise exception 'Invoice is not payable'; end if;
    select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=p_org_id and invoice_id=i.id and verification_state='verified';
    if p_amount_satang not between 1 and 9007199254740991 or p_amount_satang>i.amount_satang-paid or p_amount_satang>c.amount_satang then raise exception 'Verified amount exceeds claim or open balance'; end if;
    insert into public.payments(org_id,invoice_id,amount_satang,paid_at,method,verification_state,verified_by,verification_reference,command_key,notes)
      values(p_org_id,i.id,p_amount_satang,p_paid_on::timestamp at time zone 'Asia/Bangkok',p_method,'verified',actor,btrim(p_reference),p_key,'Verified reported receipt') returning id into receipt;
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org_id,receipt,i.id,p_amount_satang);
    update public.invoices set status=case when paid+p_amount_satang=amount_satang then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end where org_id=p_org_id and id=i.id;
  end if;
  update public.payment_claims set status=p_decision,reviewed_by=actor,review_reference=btrim(p_reference),reviewed_at=now(),payment_id=case when p_decision='verified' then receipt else null end where org_id=p_org_id and id=c.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,actor,'payment',receipt,case when p_decision='verified' then 'payment_verified' else 'payment_claim_rejected' end,'Reviewed receipt with explicit bank date and method',jsonb_build_object('invoiceId',i.id,'claimId',c.id,'amountSatang',p_amount_satang,'reference',btrim(p_reference),'paidOn',p_paid_on,'method',p_method));
  update public.payment_command_results set result=receipt where org_id=p_org_id and key=p_key;
  return receipt;
end;
$$;

