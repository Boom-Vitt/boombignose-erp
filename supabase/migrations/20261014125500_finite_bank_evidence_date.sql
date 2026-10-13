-- Reject nonfinite PostgreSQL date sentinels before financial writes.
create or replace function public.review_payment_claim_with_evidence(p_org_id uuid,p_claim_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_decision text,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.payment_claims; i public.invoices; cmd public.payment_command_results; req jsonb; paid numeric; receipt uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may verify payments'; end if;
  if p_key is null or p_decision is null or p_decision not in ('verified','rejected') or p_amount_satang is null
    or p_reference is null or length(btrim(p_reference)) not between 3 and 500 or p_paid_on is null or not isfinite(p_paid_on) or p_method is null
    or p_paid_on>(now() at time zone 'Asia/Bangkok')::date then raise exception 'Invalid verification evidence'; end if;
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
    if i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
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
    if original.verification_state<>'legacy_unverified' or i.status in ('draft','cancelled')
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
