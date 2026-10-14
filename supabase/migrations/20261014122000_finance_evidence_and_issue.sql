-- Financial evidence is append-only; operational documents are not tax filings.
create or replace function public.finish_outbound_event(p_event_id uuid,p_lease_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.outbound_events;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service dispatcher required'; end if;
  if p_lease_token is null then return false; end if;
  select * into e from public.outbound_events where id=p_event_id for update;
  if not found or e.status='delivered' or e.lease_token is distinct from p_lease_token or e.lease_expires_at is null or e.lease_expires_at<=now() then return false; end if;
  update public.outbound_events set status=case when p_error is null then 'delivered'::public.outbound_status else 'failed'::public.outbound_status end,
    delivered_at=case when p_error is null then now() else null end,lease_token=null,lease_expires_at=null,
    last_error=case when p_error is null then null else left(p_error,1000) end,
    next_attempt_at=case when p_error is null then next_attempt_at else now()+make_interval(secs=>least(3600,30*power(2,least(e.attempts,7))::integer)) end where id=e.id;
  return true;
end;
$$;
alter table public.payment_claims add column source text not null default 'portal' check(source in ('portal','staff'));
alter table public.payment_claims add column submitted_by uuid references auth.users(id) on delete restrict;
alter table public.payments drop constraint payments_verification_state_check;
alter table public.payments add constraint payments_verification_state_check check(verification_state in ('legacy_unverified','legacy_reconciled','verified'));
alter table public.payments add column reconciled_payment_id uuid;
alter table public.payments add constraint payments_reconciled_tenant foreign key(org_id,reconciled_payment_id) references public.payments(org_id,id) on delete no action deferrable initially deferred;
alter table public.payments add constraint payment_reconciliation_link check((verification_state='legacy_reconciled')=(reconciled_payment_id is not null));
create or replace function public.submit_internal_payment_claim(p_org_id uuid,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices; cmd public.portal_claim_requests; req jsonb; c public.payment_claims; paid numeric; target uuid; actor uuid:=auth.uid();
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
  if i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=p_org_id and invoice_id=i.id and verification_state='verified';
  if p_amount_satang>i.amount_satang-paid then raise exception 'Report exceeds open balance'; end if;
  select * into c from public.payment_claims where org_id=p_org_id and invoice_id=i.id and status='pending';
  if found then
    if c.amount_satang<>p_amount_satang or c.reference<>btrim(p_reference) then raise exception 'Pending claim already exists'; end if;
    target:=c.id;
  else
    insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key,source,submitted_by)
      values(p_org_id,i.client_id,i.id,p_amount_satang,btrim(p_reference),p_key,'staff',actor) returning id into target;
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
      values(p_org_id,actor,'payment_claim',target,'payment_claim_submitted','Staff reported receipt; verification required',jsonb_build_object('invoiceId',i.id));
  end if;
  update public.portal_claim_requests set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.submit_internal_payment_claim(uuid,uuid,bigint,text,uuid) from public,anon,service_role;
grant execute on function public.submit_internal_payment_claim(uuid,uuid,bigint,text,uuid) to authenticated;

create or replace function public.review_payment_claim_with_evidence(p_org_id uuid,p_claim_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_decision text,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.payment_claims; i public.invoices; cmd public.payment_command_results; req jsonb; paid numeric; receipt uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may verify payments'; end if;
  if p_key is null or p_decision is null or p_decision not in ('verified','rejected') or p_amount_satang is null
    or p_reference is null or length(btrim(p_reference)) not between 3 and 500 or p_paid_on is null or p_method is null
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
revoke all on function public.review_payment_claim_with_evidence(uuid,uuid,bigint,text,uuid,text,date,public.payment_method) from public,anon,service_role;
grant execute on function public.review_payment_claim_with_evidence(uuid,uuid,bigint,text,uuid,text,date,public.payment_method) to authenticated;
create or replace function public.reconcile_legacy_payment_with_evidence(p_org_id uuid,p_legacy_payment_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare original public.payments; evidence public.payments; i public.invoices; cmd public.payment_command_results; req jsonb; paid numeric; target uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may reconcile legacy receipts'; end if;
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991 or p_reference is null or length(btrim(p_reference)) not between 3 and 500
    or p_paid_on is null or p_method is null or p_paid_on>(now() at time zone 'Asia/Bangkok')::date then raise exception 'Invalid reconciliation evidence'; end if;
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
revoke all on function public.reconcile_legacy_payment_with_evidence(uuid,uuid,bigint,text,uuid,date,public.payment_method) from public,anon,service_role;
grant execute on function public.reconcile_legacy_payment_with_evidence(uuid,uuid,bigint,text,uuid,date,public.payment_method) to authenticated;
create function public.reconcile_legacy_payment(p_org_id uuid,p_legacy_payment_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare original public.payments;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may reconcile legacy receipts'; end if;
  select * into original from public.payments where org_id=p_org_id and id=p_legacy_payment_id;
  if not found then raise exception 'Legacy receipt unavailable'; end if;
  return public.reconcile_legacy_payment_with_evidence(p_org_id,p_legacy_payment_id,p_amount_satang,p_reference,p_key,(original.paid_at at time zone 'Asia/Bangkok')::date,original.method);
end;
$$;
revoke all on function public.reconcile_legacy_payment(uuid,uuid,bigint,text,uuid) from public,anon,service_role;
grant execute on function public.reconcile_legacy_payment(uuid,uuid,bigint,text,uuid) to authenticated;

alter table public.org_settings add column legal_name text;
alter table public.org_settings add column business_address text;
alter table public.org_settings add column tax_id text check(tax_id is null or tax_id ~ '^[0-9]{13}$');
alter table public.org_settings add column tax_status text not null default 'unknown' check(tax_status in ('unknown','not_registered','registered'));
alter table public.clients add column billing_address text;
alter table public.clients add column tax_id text check(tax_id is null or tax_id ~ '^[0-9]{13}$');
create function public.update_business_profile(p_org_id uuid,p_legal_name text,p_business_address text,p_tax_id text,p_tax_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may edit business profile'; end if;
  if p_legal_name is null or length(btrim(p_legal_name)) not between 1 and 200 or p_business_address is null or length(btrim(p_business_address)) not between 1 and 1000
    or p_tax_status is null or p_tax_status not in ('unknown','not_registered','registered') or (nullif(btrim(p_tax_id),'') is not null and btrim(p_tax_id)!~'^[0-9]{13}$')
    or (p_tax_status='registered' and nullif(btrim(p_tax_id),'') is null) then raise exception 'Invalid business profile'; end if;
  insert into public.org_settings(org_id,legal_name,business_address,tax_id,tax_status) values(p_org_id,btrim(p_legal_name),btrim(p_business_address),nullif(btrim(p_tax_id),''),p_tax_status)
    on conflict(org_id) do update set legal_name=excluded.legal_name,business_address=excluded.business_address,tax_id=excluded.tax_id,tax_status=excluded.tax_status;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(p_org_id,auth.uid(),'business_profile',p_org_id,'business_profile_updated','Updated operational invoice seller profile');
end;
$$;
revoke all on function public.update_business_profile(uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.update_business_profile(uuid,text,text,text,text) to authenticated;
alter table public.invoices add column version integer not null default 1;
alter table public.invoices add column issued_snapshot_id uuid;
create table public.invoice_snapshots (
  id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,source_version integer not null,number text not null,snapshot jsonb not null,
  issued_by uuid not null references auth.users(id) on delete restrict,issued_at timestamptz not null default now(),
  unique(org_id,id),unique(org_id,invoice_id),unique(org_id,number),
  foreign key(org_id,invoice_id) references public.invoices(org_id,id) deferrable initially deferred
);
alter table public.invoices add constraint invoice_snapshot_tenant foreign key(org_id,issued_snapshot_id) references public.invoice_snapshots(org_id,id) deferrable initially deferred;
alter table public.invoice_snapshots enable row level security;
alter table public.invoice_snapshots force row level security;
create policy invoice_snapshot_read on public.invoice_snapshots for select to authenticated using(private.is_org_member(org_id));
revoke insert,update,delete on public.invoice_snapshots from authenticated,anon;
create table public.document_counters (org_id uuid not null references public.organizations(id) on delete cascade,kind text not null,year integer not null,value bigint not null,primary key(org_id,kind,year));
create table public.invoice_issue_requests (org_id uuid not null references public.organizations(id) on delete cascade,key uuid not null,invoice_id uuid not null,source_version integer not null,snapshot_id uuid,primary key(org_id,key),foreign key(org_id,invoice_id) references public.invoices(org_id,id) deferrable initially deferred,foreign key(org_id,snapshot_id) references public.invoice_snapshots(org_id,id) deferrable initially deferred);
alter table public.document_counters enable row level security;alter table public.document_counters force row level security;
alter table public.invoice_issue_requests enable row level security;alter table public.invoice_issue_requests force row level security;
revoke all on public.document_counters,public.invoice_issue_requests from authenticated,anon;
create or replace function private.guard_invoice_issue()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.issued_snapshot_id is not null and exists(select 1 from public.organizations where id=old.org_id) then raise exception 'Issued invoice must be retained'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if current_user='authenticated' and (new.status<>'draft' or new.issued_snapshot_id is not null) then raise exception 'New invoice must be draft'; end if;
    new.version:=1;
  else
    if current_user in ('authenticated','service_role') and (new.issued_snapshot_id is distinct from old.issued_snapshot_id or (old.status='draft' and new.status='sent')) then raise exception 'Invoice issuance requires the issue command'; end if;
    if old.issued_snapshot_id is not null and (new.client_id<>old.client_id or new.project_id is distinct from old.project_id or new.number<>old.number or new.amount_satang<>old.amount_satang or new.discount_satang<>old.discount_satang or new.issue_date<>old.issue_date or new.due_date is distinct from old.due_date or new.notes is distinct from old.notes) then raise exception 'Issued content is frozen; use linked correction'; end if;
    new.version:=old.version+1;
  end if;
  return new;
end;
$$;
create trigger guard_invoice_issue before insert or update or delete on public.invoices for each row execute function private.guard_invoice_issue();
-- Guard line mutations even though recompute triggers are SECURITY DEFINER.
create or replace function private.guard_invoice_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;amount numeric;parent public.invoices;
begin
  if tg_op='DELETE' then target:=old.invoice_id;tenant:=old.org_id;else target:=new.invoice_id;tenant:=new.org_id;end if;
  if tg_op='UPDATE' and (new.invoice_id<>old.invoice_id or new.org_id<>old.org_id) then raise exception 'Line reassignment forbidden'; end if;
  select * into parent from public.invoices where org_id=tenant and id=target for update;
  if not found then if tg_op='DELETE' then return old;end if;raise exception 'Invoice unavailable';end if;
  if parent.issued_snapshot_id is not null or exists(select 1 from public.payments where org_id=tenant and invoice_id=target and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=tenant and invoice_id=target and status='pending') then raise exception 'Issued or payment evidence locks invoice lines'; end if;
  if tg_op='DELETE' then return old;end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line amount'; end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount not between 0 and 9007199254740991 then raise exception 'Line exceeds safe satang bounds'; end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;
create function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
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
  select coalesce(sum(amount_satang),0),jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position) order by position,id) into subtotal,lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
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
