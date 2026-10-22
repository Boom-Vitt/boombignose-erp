alter table public.org_settings add column lock_date date check(lock_date is null or isfinite(lock_date));

create function private.assert_finance_date_open(p_org_id uuid,p_date date)
returns void language plpgsql security definer set search_path='' as $$
declare locked_through date;
begin
  if p_date is null or not isfinite(p_date) then raise exception 'Invalid finance date';end if;
  select lock_date into locked_through from public.org_settings where org_id=p_org_id for share;
  if p_date<=locked_through then raise exception 'Finance period is locked';end if;
end;
$$;
revoke all on function private.assert_finance_date_open(uuid,date) from public,anon,authenticated,service_role;

create function public.update_finance_lock_date(p_org_id uuid,p_lock_date date)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may change the finance lock date';end if;
  if p_lock_date is not null and not isfinite(p_lock_date) then raise exception 'Invalid finance lock date';end if;
  insert into public.org_settings(org_id,lock_date) values(p_org_id,p_lock_date)
    on conflict(org_id) do update set lock_date=excluded.lock_date;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'organization',p_org_id,'finance_lock_updated','Updated finance lock date',jsonb_build_object('lockDate',p_lock_date));
end;
$$;
revoke all on function public.update_finance_lock_date(uuid,date) from public,anon,service_role;
grant execute on function public.update_finance_lock_date(uuid,date) to authenticated;

create function private.guard_receipt_period()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.verification_state='verified' then
    if tg_op='DELETE' and not exists(select 1 from public.organizations where id=old.org_id) then return old;end if;
    perform private.assert_finance_date_open(old.org_id,(old.paid_at at time zone 'Asia/Bangkok')::date);
  end if;
  if tg_op='DELETE' then return old;end if;
  if new.verification_state='verified' then
    perform private.assert_finance_date_open(new.org_id,(new.paid_at at time zone 'Asia/Bangkok')::date);
  end if;
  return new;
end;
$$;
create trigger guard_receipt_period before insert or update or delete on public.payments for each row execute function private.guard_receipt_period();

-- Keep this guard separate from W4-c quote commands and their line guard.
create function private.guard_line_vat_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare registered boolean;
begin
  if new.tax_rate_bps>0 then
    select vat_registered into registered from public.org_settings where org_id=new.org_id for share;
    if not coalesce(registered,false) then raise exception 'VAT registration required for taxable lines';end if;
  end if;
  return new;
end;
$$;
create trigger a_guard_line_vat_registration before insert or update on public.quote_items for each row execute function private.guard_line_vat_registration();
create trigger a_guard_line_vat_registration before insert or update on public.invoice_items for each row execute function private.guard_line_vat_registration();

-- Retain custom references but release any unissued reference in the issued series.
update public.invoices i set number='DRAFT-'||i.id::text
  where i.issued_snapshot_id is null and i.status in ('draft','cancelled') and btrim(i.number) ~* '^INV-[0-9]{4}-[0-9]+$'
    and not exists(select 1 from public.payments p where p.org_id=i.org_id and p.invoice_id=i.id and p.verification_state='verified');

create or replace function private.guard_invoice_issue()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.issued_snapshot_id is not null and exists(select 1 from public.organizations where id=old.org_id) then raise exception 'Issued invoice must be retained';end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if current_user in ('authenticated','service_role') and (new.status<>'draft' or new.issued_snapshot_id is not null) then raise exception 'New invoice must be draft';end if;
    new.version:=1;
  else
    if old.issued_snapshot_id is null and old.status='cancelled' and new.status<>old.status then raise exception 'Cancelled draft is final';end if;
    if current_user in ('authenticated','service_role') and new.issued_snapshot_id is distinct from old.issued_snapshot_id then raise exception 'Invoice issuance requires the issue command';end if;
    if old.issued_snapshot_id is not null and new.status='cancelled' and old.status<>'cancelled' then raise exception 'Issued invoice cancellation requires linked correction';end if;
    if old.issued_snapshot_id is not null and new.status='draft' then raise exception 'Issued invoice cannot return to draft';end if;
    if old.issued_snapshot_id is not null and (new.client_id<>old.client_id or new.project_id is distinct from old.project_id or new.number<>old.number or new.amount_satang<>old.amount_satang or new.discount_satang<>old.discount_satang or new.issue_date<>old.issue_date or new.due_date is distinct from old.due_date or new.notes is distinct from old.notes) then raise exception 'Issued content is frozen; use linked correction';end if;
    new.version:=old.version+1;
  end if;
  if new.issued_snapshot_id is null then
    if new.status in ('sent','partially_paid','paid','overdue') then raise exception 'Payable state requires issue command';end if;
    if btrim(new.number) ~* '^INV-[0-9]{4}-[0-9]+$' then raise exception 'Invoice series numbers require issue command';end if;
    if new.number is null or btrim(new.number)='' then new.number:='DRAFT-'||new.id::text;end if;
  end if;
  if tg_op='UPDATE' and current_user in ('authenticated','service_role') and new.status<>old.status then raise exception 'Invoice status changes require a command';end if;
  return new;
end;
$$;

create function public.cancel_draft_invoice(p_org_id uuid,p_invoice_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare i public.invoices;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may cancel drafts';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found or i.issued_snapshot_id is not null or i.status not in ('draft','cancelled') then raise exception 'Unissued draft required';end if;
  if i.status='cancelled' then return;end if;
  update public.invoices set status='cancelled' where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
    values(p_org_id,auth.uid(),'invoice',i.id,'invoice_draft_cancelled','Cancelled unissued invoice draft');
end;
$$;
revoke all on function public.cancel_draft_invoice(uuid,uuid) from public,anon,service_role;
grant execute on function public.cancel_draft_invoice(uuid,uuid) to authenticated;

create or replace function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.invoice_issue_requests;target uuid;lines jsonb;subtotal numeric;totals jsonb;counter bigint;yr integer;num text;doc jsonb;today date:=(now() at time zone 'Asia/Bangkok')::date;
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
  insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'INV',yr,1)
    on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
  num:='INV-'||yr::text||'-'||case when length(counter::text)<6 then lpad(counter::text,6,'0') else counter::text end;
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

drop function public.review_payment_claim(uuid,uuid,bigint,text,uuid,text);
drop function public.reconcile_legacy_payment(uuid,uuid,bigint,text,uuid);
drop index public.payment_claims_one_pending;
create index payment_claims_pending_invoice on public.payment_claims(org_id,invoice_id) where status='pending';

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
  if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
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
  if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
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
    if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
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

create or replace function public.reconcile_legacy_payment_with_evidence(p_org_id uuid,p_legacy_payment_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare original public.payments; evidence public.payments; i public.invoices; cmd public.payment_command_results; req jsonb; paid numeric; target uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may reconcile legacy receipts'; end if;
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991 or p_reference is null or length(btrim(p_reference)) not between 3 and 500
    or p_paid_on is null or not isfinite(p_paid_on) or p_method is null or p_paid_on>(now() at time zone 'Asia/Bangkok')::date then raise exception 'Invalid reconciliation evidence'; end if;
  req:=jsonb_build_object('operation','legacy_reconcile','legacy',p_legacy_payment_id,'amount',p_amount_satang,'reference',btrim(p_reference),'paidOn',p_paid_on,'method',p_method);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  select * into original from public.payments where org_id=p_org_id and id=p_legacy_payment_id;
  if not found then raise exception 'Legacy receipt unavailable'; end if;
  select * into i from public.invoices where org_id=p_org_id and id=original.invoice_id for update;
  select * into original from public.payments where org_id=p_org_id and id=p_legacy_payment_id for update;
  if original.verification_state='legacy_reconciled' then
    select * into evidence from public.payments where org_id=p_org_id and id=original.reconciled_payment_id;
    if evidence.amount_satang<>p_amount_satang or evidence.verification_reference<>btrim(p_reference) or (evidence.paid_at at time zone 'Asia/Bangkok')::date<>p_paid_on or evidence.method<>p_method then raise exception 'Legacy receipt already reconciled differently'; end if;
    target:=evidence.id;
  else
    if original.verification_state<>'legacy_unverified' or i.issued_snapshot_id is null or i.status in ('draft','cancelled')
      or exists(select 1 from public.payment_claims where org_id=p_org_id and invoice_id=i.id and status='pending') then raise exception 'Legacy receipt not reconcilable; resolve pending claims first'; end if;
    select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=p_org_id and invoice_id=i.id and verification_state='verified';
    if p_amount_satang>i.amount_satang-paid then raise exception 'Reconciliation exceeds open balance'; end if;
    insert into public.payments(org_id,invoice_id,amount_satang,paid_at,method,verification_state,verified_by,verification_reference,command_key,notes)
      values(p_org_id,i.id,p_amount_satang,p_paid_on::timestamp at time zone 'Asia/Bangkok',p_method,'verified',actor,btrim(p_reference),p_key,'Reconciles legacy receipt '||original.id::text) returning id into target;
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org_id,target,i.id,p_amount_satang);
    update public.payments set verification_state='legacy_reconciled',reconciled_payment_id=target where org_id=p_org_id and id=original.id;
    update public.invoices set status=case when paid+p_amount_satang=amount_satang then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end where org_id=p_org_id and id=i.id;
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
      values(p_org_id,actor,'payment',target,'payment_legacy_reconciled','Retained legacy assertion and created independently verified receipt',jsonb_build_object('legacyId',original.id,'legacyAmountSatang',original.amount_satang,'invoiceId',i.id,'amountSatang',p_amount_satang,'reference',btrim(p_reference),'paidOn',p_paid_on,'method',p_method));
  end if;
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
