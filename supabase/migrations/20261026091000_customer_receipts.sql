alter table public.payments drop constraint reversal_is_negative;
alter table public.payments add constraint reversal_is_verified check(reversal_of is null or verification_state='verified');
alter table public.payments alter column invoice_id drop not null;
alter table public.payments add column client_id uuid;
update public.payments p set client_id=i.client_id from public.invoices i where i.org_id=p.org_id and i.id=p.invoice_id;
alter table public.payments alter column client_id set not null;
alter table public.payments add constraint payment_customer_tenant foreign key(org_id,client_id) references public.clients(org_id,id) on delete restrict;
alter table public.payments add column refund_of uuid;
alter table public.payments add constraint payment_refund_tenant foreign key(org_id,refund_of) references public.payments(org_id,id) deferrable initially deferred;
alter table public.payment_allocations drop constraint payment_allocations_org_id_payment_id_key;
alter table public.payment_claims alter column invoice_id drop not null;
alter table public.credit_note_lines alter column invoice_item_id drop not null;
alter table public.payment_claims add column requested_allocations jsonb not null default '[]' check(jsonb_typeof(requested_allocations)='array');
create index payment_allocations_invoice on public.payment_allocations(org_id,invoice_id);
create index payment_allocations_payment on public.payment_allocations(org_id,payment_id);
create index payments_customer on public.payments(org_id,client_id);
create index payment_claims_customer on public.payment_claims(org_id,client_id) where status='pending';

-- Preserve verified historical cash that predates the allocation ledger.
insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang)
  select p.org_id,p.id,p.invoice_id,p.amount_satang from public.payments p where p.verification_state='verified' and p.invoice_id is not null
  and not exists(select 1 from public.payment_allocations a where a.org_id=p.org_id and a.payment_id=p.id);

create function private.bind_payment_customer() returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;
begin
  if new.invoice_id is not null then
    select client_id into customer from public.invoices where org_id=new.org_id and id=new.invoice_id;
    if new.client_id is null then new.client_id:=customer;end if;
    if customer is distinct from new.client_id then raise exception 'Receipt and invoice customer must match';end if;
  end if;
  if new.reversal_of is not null and not exists(select 1 from public.payments p where p.org_id=new.org_id and p.id=new.reversal_of and p.client_id=new.client_id) then raise exception 'Reversal customer mismatch';end if;
  return new;
end;
$$;
create trigger a_bind_payment_customer before insert on public.payments for each row execute function private.bind_payment_customer();

create function private.lock_finance_customer(p_org uuid,p_invoice uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.clients where org_id=p_org and id=(select client_id from public.invoices where org_id=p_org and id=p_invoice) for update;
end;
$$;
revoke all on function private.lock_finance_customer(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.invoice_settled_satang(p_org uuid,p_invoice uuid) returns bigint language sql stable security definer set search_path='' as $$
  select (coalesce((select sum(a.amount_satang) from public.payment_allocations a join public.payments p on p.org_id=a.org_id and p.id=a.payment_id where a.org_id=p_org and a.invoice_id=p_invoice and p.verification_state='verified'),0)
    +coalesce((select sum(amount_satang) from public.credit_notes where org_id=p_org and invoice_id=p_invoice),0))::bigint;
$$;
create function private.invoice_pending_satang(p_org uuid,p_invoice uuid,p_exclude uuid default null) returns bigint language sql stable security definer set search_path='' as $$
  select coalesce(sum(case when invoice_id=p_invoice then amount_satang else
    coalesce((select sum((e->>'amount_satang')::bigint) from jsonb_array_elements(requested_allocations) e where (e->>'invoice_id')::uuid=p_invoice),0) end),0)::bigint
  from public.payment_claims where org_id=p_org and status='pending' and id is distinct from p_exclude;
$$;
revoke all on function private.invoice_pending_satang(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.receipt_available_satang(p_org uuid,p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
  select (p.amount_satang-coalesce((select sum(amount_satang) from public.payment_allocations where org_id=p_org and payment_id=p.id),0)
    +coalesce((select sum(amount_satang) from public.payments where org_id=p_org and refund_of=p.id and verification_state='verified'),0))::bigint
  from public.payments p where p.org_id=p_org and p.id=p_payment and p.amount_satang>0 and p.reversal_of is null and p.verification_state='verified'
    and not exists(select 1 from public.payments r where r.org_id=p.org_id and r.reversal_of=p.id);
$$;
revoke all on function private.receipt_available_satang(uuid,uuid) from public,anon,authenticated,service_role;

create function private.validate_allocations(p_allocations jsonb) returns bigint language plpgsql immutable set search_path='' as $$
declare total numeric;
begin
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array' then raise exception 'Invalid allocations';end if;
  if exists(select 1 from jsonb_array_elements(p_allocations) e where jsonb_typeof(e)<>'object' or e->>'invoice_id' is null or e->>'amount_satang' is null
    or (e->>'amount_satang')::numeric<>trunc((e->>'amount_satang')::numeric) or (e->>'amount_satang')::numeric not between 1 and 9007199254740991) then raise exception 'Invalid allocations';end if;
  if exists(select 1 from jsonb_array_elements(p_allocations) e group by (e->>'invoice_id')::uuid having count(*)>1) then raise exception 'Duplicate allocation invoice';end if;
  select coalesce(sum((e->>'amount_satang')::numeric),0) into total from jsonb_array_elements(p_allocations) e;
  if total>9007199254740991 then raise exception 'Unsafe allocation total';end if;
  return total::bigint;
end;
$$;
revoke all on function private.validate_allocations(jsonb) from public,anon,authenticated,service_role;

create function private.allocate_receipt(p_org uuid,p_payment uuid,p_allocations jsonb,p_exclude_claim uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare receipt public.payments;i public.invoices;e record;total bigint;
begin
  total:=private.validate_allocations(p_allocations);
  select * into receipt from public.payments where org_id=p_org and id=p_payment;
  if total>coalesce(private.receipt_available_satang(p_org,p_payment),-1) then raise exception 'Allocation exceeds available receipt';end if;
  perform private.assert_finance_date_open(p_org,(now() at time zone 'Asia/Bangkok')::date);
  for e in select (value->>'invoice_id')::uuid invoice_id,(value->>'amount_satang')::bigint amount from jsonb_array_elements(p_allocations) order by 1 loop
    select * into i from public.invoices where org_id=p_org and id=e.invoice_id for update;
    if not found or i.client_id<>receipt.client_id or i.issued_snapshot_id is null or i.status in ('draft','cancelled') then raise exception 'Issued invoice for receipt customer required';end if;
    if e.amount>i.amount_satang-private.invoice_settled_satang(p_org,i.id)-private.invoice_pending_satang(p_org,i.id,p_exclude_claim) then raise exception 'Allocation exceeds unreserved invoice balance';end if;
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org,p_payment,i.id,e.amount);
    perform private.refresh_invoice_status(p_org,i.id);
  end loop;
end;
$$;
revoke all on function private.allocate_receipt(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function private.release_credited_allocations(p_org uuid,p_invoice uuid) returns void language plpgsql security definer set search_path='' as $$
declare excess bigint;allocation record;release bigint;
begin
  select greatest(private.invoice_settled_satang(p_org,p_invoice)-amount_satang,0) into excess from public.invoices where org_id=p_org and id=p_invoice;
  if excess=0 then return;end if;
  for allocation in select a.payment_id,sum(a.amount_satang)::bigint amount from public.payment_allocations a join public.payments p on p.org_id=a.org_id and p.id=a.payment_id
    where a.org_id=p_org and a.invoice_id=p_invoice and p.amount_satang>0 and p.reversal_of is null and p.verification_state='verified'
      and not exists(select 1 from public.payments r where r.org_id=p.org_id and r.reversal_of=p.id) group by a.payment_id having sum(a.amount_satang)>0 order by a.payment_id
  loop
    release:=least(excess,allocation.amount);
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org,allocation.payment_id,p_invoice,-release);
    excess:=excess-release;
    exit when excess=0;
  end loop;
end;
$$;
revoke all on function private.release_credited_allocations(uuid,uuid) from public,anon,authenticated,service_role;

create function public.submit_customer_payment_claim(p_org_id uuid,p_client_id uuid,p_amount_satang bigint,p_allocations jsonb,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;e record;total bigint;req jsonb;cmd public.portal_claim_requests;target uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may report receipts';end if;
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991 or p_reference is null or length(btrim(p_reference)) not between 1 and 500 then raise exception 'Invalid receipt report';end if;
  perform 1 from public.clients where org_id=p_org_id and id=p_client_id for update;
  if not found then raise exception 'Customer unavailable';end if;
  total:=private.validate_allocations(p_allocations);
  if total>p_amount_satang then raise exception 'Allocations exceed reported receipt';end if;
  req:=jsonb_build_object('operation','customer_receipt','client',p_client_id,'amount',p_amount_satang,'allocations',p_allocations,'reference',btrim(p_reference));
  insert into public.portal_claim_requests(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.portal_claim_requests where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  for e in select (value->>'invoice_id')::uuid invoice_id,(value->>'amount_satang')::bigint amount from jsonb_array_elements(p_allocations) order by 1 loop
    select * into i from public.invoices where org_id=p_org_id and id=e.invoice_id for update;
    if not found or i.client_id<>p_client_id or i.issued_snapshot_id is null or i.status in ('draft','cancelled') then raise exception 'Issued invoice for customer required';end if;
    if e.amount>i.amount_satang-private.invoice_settled_satang(p_org_id,i.id)-private.invoice_pending_satang(p_org_id,i.id) then raise exception 'Report exceeds unclaimed open balance';end if;
  end loop;
  insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key,source,submitted_by,requested_allocations)
    values(p_org_id,p_client_id,null,p_amount_satang,btrim(p_reference),p_key,'staff',auth.uid(),p_allocations) returning id into target;
  update public.portal_claim_requests set result=target where org_id=p_org_id and key=p_key;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'payment_claim',target,'payment_claim_submitted','Reported customer receipt for allocation',jsonb_build_object('clientId',p_client_id,'amountSatang',p_amount_satang,'allocations',p_allocations));
  return target;
end;
$$;
revoke all on function public.submit_customer_payment_claim(uuid,uuid,bigint,jsonb,text,uuid) from public,anon,service_role;
grant execute on function public.submit_customer_payment_claim(uuid,uuid,bigint,jsonb,text,uuid) to authenticated;

create function private.review_customer_claim(p_org uuid,p_claim uuid,p_amount bigint,p_reference text,p_key uuid,p_decision text,p_paid_on date,p_method public.payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.payment_claims;target uuid;
begin
  select * into c from public.payment_claims where org_id=p_org and id=p_claim for update;
  if c.status<>'pending' then raise exception 'Claim unavailable for review';end if;
  if p_decision='verified' then
    if p_amount<private.validate_allocations(c.requested_allocations) or p_amount not between 1 and c.amount_satang then raise exception 'Verified amount does not cover allocations or exceeds claim';end if;
    perform private.assert_finance_date_open(p_org,p_paid_on);
    insert into public.payments(org_id,client_id,amount_satang,paid_at,method,notes,verification_state,verified_by,verification_reference,command_key)
      values(p_org,c.client_id,p_amount,p_paid_on::timestamp at time zone 'Asia/Bangkok',p_method,'Verified customer receipt','verified',auth.uid(),btrim(p_reference),p_key) returning id into target;
    perform private.allocate_receipt(p_org,target,c.requested_allocations,c.id);
  else
    if p_amount<>0 then raise exception 'Rejected claim has no settlement';end if;
    target:=c.id;
  end if;
  update public.payment_claims set status=p_decision,reviewed_by=auth.uid(),review_reference=btrim(p_reference),reviewed_at=now(),payment_id=case when p_decision='verified' then target else null end where org_id=p_org and id=c.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org,auth.uid(),'payment',target,case when p_decision='verified' then 'payment_verified' else 'payment_claim_rejected' end,'Reviewed customer receipt',jsonb_build_object('claimId',c.id,'clientId',c.client_id,'amountSatang',p_amount,'reference',p_reference,'paidOn',p_paid_on,'method',p_method));
  update public.payment_command_results set result=target where org_id=p_org and key=p_key;
  return target;
end;
$$;
revoke all on function private.review_customer_claim(uuid,uuid,bigint,text,uuid,text,date,public.payment_method) from public,anon,authenticated,service_role;

create function public.apply_customer_credit(p_org_id uuid,p_client_id uuid,p_allocations jsonb,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare req jsonb;cmd public.payment_command_results;e record;receipt record;remaining bigint;available bigint;part bigint;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may allocate customer credit';end if;
  if p_key is null or private.validate_allocations(p_allocations)<=0 then raise exception 'Allocations required';end if;
  perform 1 from public.clients where org_id=p_org_id and id=p_client_id for update;
  if not found then raise exception 'Customer unavailable';end if;
  req:=jsonb_build_object('operation','apply_credit','client',p_client_id,'allocations',p_allocations);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  for e in select (value->>'invoice_id')::uuid invoice_id,(value->>'amount_satang')::bigint amount from jsonb_array_elements(p_allocations) order by 1 loop
    remaining:=e.amount;
    for receipt in select id from public.payments where org_id=p_org_id and client_id=p_client_id and amount_satang>0 and reversal_of is null and verification_state='verified' order by paid_at,id loop
      available:=coalesce(private.receipt_available_satang(p_org_id,receipt.id),0);
      part:=least(remaining,available);
      if part>0 then perform private.allocate_receipt(p_org_id,receipt.id,jsonb_build_array(jsonb_build_object('invoice_id',e.invoice_id,'amount_satang',part)));remaining:=remaining-part;end if;
      exit when remaining=0;
    end loop;
    if remaining>0 then raise exception 'Insufficient customer credit';end if;
  end loop;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'client',p_client_id,'customer_credit_applied','Applied existing cash without receiving it again',jsonb_build_object('allocations',p_allocations));
  update public.payment_command_results set result=p_client_id where org_id=p_org_id and key=p_key;
  return p_client_id;
end;
$$;
revoke all on function public.apply_customer_credit(uuid,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.apply_customer_credit(uuid,uuid,jsonb,uuid) to authenticated;

create function public.refund_customer_credit(p_org_id uuid,p_payment_id uuid,p_amount_satang bigint,p_reference text,p_paid_on date,p_method public.payment_method,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare receipt public.payments;req jsonb;cmd public.payment_command_results;target uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may refund customer credit';end if;
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991 or p_reference is null or length(btrim(p_reference)) not between 3 and 500 or p_paid_on is null or not isfinite(p_paid_on) or p_paid_on>(now() at time zone 'Asia/Bangkok')::date or p_method is null then raise exception 'Invalid refund evidence';end if;
  select * into receipt from public.payments where org_id=p_org_id and id=p_payment_id;
  if not found then raise exception 'Receipt unavailable';end if;
  perform 1 from public.clients where org_id=p_org_id and id=receipt.client_id for update;
  req:=jsonb_build_object('operation','refund_credit','payment',p_payment_id,'amount',p_amount_satang,'reference',btrim(p_reference),'date',p_paid_on,'method',p_method);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if p_amount_satang>coalesce(private.receipt_available_satang(p_org_id,p_payment_id),0) then raise exception 'Refund exceeds available customer credit';end if;
  if p_paid_on<(receipt.paid_at at time zone 'Asia/Bangkok')::date then raise exception 'Refund predates receipt';end if;
  perform private.assert_finance_date_open(p_org_id,p_paid_on);
  insert into public.payments(org_id,client_id,amount_satang,paid_at,method,notes,verification_state,verified_by,verification_reference,command_key,refund_of)
    values(p_org_id,receipt.client_id,-p_amount_satang,p_paid_on::timestamp at time zone 'Asia/Bangkok',p_method,'Customer credit refund','verified',auth.uid(),btrim(p_reference),p_key,receipt.id) returning id into target;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'payment',target,'customer_credit_refunded','Refunded unallocated customer cash',jsonb_build_object('sourcePaymentId',receipt.id,'clientId',receipt.client_id,'amountSatang',p_amount_satang,'reference',p_reference,'paidOn',p_paid_on));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.refund_customer_credit(uuid,uuid,bigint,text,date,public.payment_method,uuid) from public,anon,service_role;
grant execute on function public.refund_customer_credit(uuid,uuid,bigint,text,date,public.payment_method,uuid) to authenticated;

create or replace view public.invoice_balances with (security_invoker=true) as
select i.org_id,i.id invoice_id,i.client_id,i.status,i.amount_satang,paid.satang::bigint paid_satang,
  greatest(i.amount_satang-paid.satang-credit.satang,0)::bigint outstanding_satang,
  credit.satang::bigint credited_satang,(i.amount_satang-credit.satang)::bigint collectible_satang
from public.invoices i
cross join lateral(select coalesce(sum(a.amount_satang),0) satang from public.payment_allocations a join public.payments p on p.org_id=a.org_id and p.id=a.payment_id where a.org_id=i.org_id and a.invoice_id=i.id and p.verification_state='verified') paid
cross join lateral(select coalesce(sum(amount_satang),0) satang from public.credit_notes where org_id=i.org_id and invoice_id=i.id) credit;

create or replace view public.client_balances with (security_invoker=true) as
select c.org_id,c.id client_id,coalesce(i.invoiced,0)::bigint invoiced_satang,coalesce(i.paid,0)::bigint paid_satang,coalesce(i.outstanding,0)::bigint outstanding_satang,
  (coalesce(cash.amount,0)-coalesce(i.paid,0))::bigint credit_satang
from public.clients c
left join lateral(select sum(collectible_satang) invoiced,sum(paid_satang) paid,sum(outstanding_satang) outstanding from public.invoice_balances where org_id=c.org_id and client_id=c.id and status not in ('draft','cancelled')) i on true
left join lateral(select sum(amount_satang) amount from public.payments where org_id=c.org_id and client_id=c.id and verification_state='verified') cash on true;

create view public.customer_receipt_balances with (security_invoker=true) as
select p.org_id,p.id payment_id,p.client_id,p.amount_satang,p.paid_at,
  (p.amount_satang-coalesce(a.amount,0)+coalesce(refunds.amount,0))::bigint available_satang
from public.payments p
left join lateral(select sum(amount_satang) amount from public.payment_allocations where org_id=p.org_id and payment_id=p.id) a on true
left join lateral(select sum(amount_satang) amount from public.payments where org_id=p.org_id and refund_of=p.id and verification_state='verified') refunds on true
where p.verification_state='verified' and p.amount_satang>0 and p.reversal_of is null and not exists(select 1 from public.payments r where r.org_id=p.org_id and r.reversal_of=p.id);
grant select on public.customer_receipt_balances to authenticated;
create or replace function public.issue_credit_note(p_org_id uuid,p_invoice_id uuid,p_lines jsonb,p_reason text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;l public.invoice_items;line_input jsonb;raw numeric;used numeric;qty numeric;chosen jsonb:='[]';lines jsonb:='[]';
  legacy boolean;limit_raw numeric;
  cmd public.payment_command_results;req jsonb;target uuid;totals jsonb;original jsonb;counter bigint;num text;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue credit notes';end if;
  if p_key is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000
    or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invalid credit note';end if;
  perform private.lock_finance_customer(p_org_id,p_invoice_id);
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found then raise exception 'Invoice unavailable';end if;
  req:=jsonb_build_object('operation','credit_note','invoice',i.id,'lines',p_lines,'reason',btrim(p_reason));
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if i.issued_snapshot_id is null or i.status in ('draft','cancelled') then raise exception 'Issued invoice required';end if;
  perform private.assert_finance_date_open(p_org_id,today);
  if private.invoice_pending_satang(p_org_id,i.id)>0 then raise exception 'Resolve pending payment claims before crediting';end if;
  select snapshot->>'kind'='legacy_operational_invoice' into legacy from public.invoice_snapshots where org_id=p_org_id and id=i.issued_snapshot_id;
  if exists(select 1 from jsonb_array_elements(p_lines) e group by e->>'invoice_item_id' having count(*)>1) then raise exception 'Duplicate credit line';end if;
  for line_input in select value from jsonb_array_elements(p_lines) loop
    if legacy and not (line_input ? 'invoice_item_id') and not exists(select 1 from public.invoice_items where org_id=p_org_id and invoice_id=i.id) then
      if jsonb_array_length(p_lines)<>1 or not (line_input ? 'amount_satang') or line_input ? 'quantity' then raise exception 'Legacy amount correction required';end if;
      raw:=(line_input->>'amount_satang')::numeric;
      select coalesce(sum(c.raw_satang),0) into used from public.credit_note_lines c join public.credit_notes n on n.org_id=c.org_id and n.id=c.credit_note_id where n.org_id=p_org_id and n.invoice_id=i.id;
      if raw is null or raw<>trunc(raw) or raw<=0 or raw>i.amount_satang-used then raise exception 'Credit exceeds remaining line amount';end if;
      chosen:=chosen||jsonb_build_array(jsonb_build_object('invoice_item_id',null,'raw_satang',raw));
      continue;
    end if;
    select * into l from public.invoice_items where org_id=p_org_id and invoice_id=i.id and id=(line_input->>'invoice_item_id')::uuid;
    if not found or (line_input ? 'quantity')=(line_input ? 'amount_satang') then raise exception 'Specify source line and either quantity or amount';end if;
    if line_input ? 'quantity' then
      qty:=(line_input->>'quantity')::numeric;
      if qty is null or qty<=0 or qty<>round(qty,3) or qty>l.quantity then raise exception 'Invalid credit quantity';end if;
      raw:=round(qty*l.unit_price_satang);
    else raw:=(line_input->>'amount_satang')::numeric;qty:=1;end if;
    select coalesce(sum(raw_satang),0) into used from public.credit_note_lines where org_id=p_org_id and invoice_item_id=l.id;
    if raw is null or raw<>trunc(raw) or raw<=0 or raw>l.amount_satang-used then raise exception 'Credit exceeds remaining line amount';end if;
    chosen:=chosen||jsonb_build_array(jsonb_build_object('invoice_item_id',l.id,'raw_satang',raw));
    lines:=lines||jsonb_build_array(jsonb_build_object('description',l.description,'quantity',qty,'unit',l.unit,'unitPriceSatang',case when line_input ? 'quantity' then l.unit_price_satang else raw end,'amountSatang',raw,'taxRateBps',l.tax_rate_bps));
  end loop;
  totals:=private.credit_note_totals(p_org_id,i.id,chosen);
  if legacy then
    lines:=jsonb_build_array(jsonb_build_object('description','Historical invoice amount correction','quantity',1,'unit',null,'unitPriceSatang',totals->'amountDueSatang','amountSatang',totals->'amountDueSatang','taxRateBps',0));
  end if;
  if (totals->>'amountDueSatang')::numeric<0 or (totals->>'amountDueSatang')::numeric>i.amount_satang-coalesce((select sum(amount_satang) from public.credit_notes where org_id=p_org_id and invoice_id=i.id),0) then raise exception 'Credit exceeds original invoice';end if;
  select snapshot into original from public.invoice_snapshots where org_id=p_org_id and id=i.issued_snapshot_id;
  insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'CN',extract(year from today)::integer,1)
    on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
  num:='CN-'||extract(year from today)::text||'-'||lpad(counter::text,greatest(6,length(counter::text)),'0');
  insert into public.credit_notes(org_id,invoice_id,number,issue_date,reason,amount_satang,snapshot,issued_by)
    values(p_org_id,i.id,num,today,btrim(p_reason),(totals->>'amountDueSatang')::bigint,
      jsonb_build_object('version',1,'kind','credit_note','seller',original->'seller','buyer',original->'buyer','originalNumber',i.number,'originalInvoiceId',i.id,
      'document',totals||jsonb_build_object('number',num,'issueDate',today,'reason',btrim(p_reason),'pricesIncludeVat',i.prices_include_vat,'whtRateBps',i.wht_rate_bps),'lines',lines),auth.uid()) returning id into target;
  insert into public.credit_note_lines(org_id,credit_note_id,invoice_item_id,raw_satang)
    select p_org_id,target,(e->>'invoice_item_id')::uuid,(e->>'raw_satang')::bigint from jsonb_array_elements(chosen) e;
  perform private.release_credited_allocations(p_org_id,i.id);
  perform private.refresh_invoice_status(p_org_id,i.id);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'credit_note_issued','Issued linked credit note',jsonb_build_object('creditNoteId',target,'number',num,'reason',btrim(p_reason),'amountSatang',totals->'amountDueSatang'));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create or replace function public.submit_payment_claim(p_token text,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.clients; i public.invoices; existing public.payment_claims; paid numeric;pending numeric; v_result uuid; cmd public.portal_claim_requests; req jsonb;
begin
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991
    or p_reference is null or length(btrim(p_reference)) not between 1 and 500 then raise exception 'Invalid claim'; end if;
  select * into c from public.clients where portal_token=p_token and portal_enabled for update;
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
  paid:=private.invoice_settled_satang(c.org_id,i.id);
  pending:=private.invoice_pending_satang(c.org_id,i.id);
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
  perform private.lock_finance_customer(p_org_id,p_invoice_id);
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found then raise exception 'Invoice unavailable'; end if;
  req:=jsonb_build_object('source','staff','invoice',i.id,'client',i.client_id,'amount',p_amount_satang,'reference',btrim(p_reference));
  insert into public.portal_claim_requests(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.portal_claim_requests where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid','paid') then raise exception 'Invoice is not payable'; end if;
  paid:=private.invoice_settled_satang(p_org_id,i.id);
  pending:=private.invoice_pending_satang(p_org_id,i.id);
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
  perform 1 from public.clients where org_id=p_org_id and id=(select client_id from public.payment_claims where org_id=p_org_id and id=p_claim_id) for update;
  req:=jsonb_build_object('operation','review_with_evidence','claim',p_claim_id,'amount',p_amount_satang,'reference',btrim(p_reference),'decision',p_decision,'paidOn',p_paid_on,'method',p_method);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id;
  if not found then raise exception 'Claim unavailable'; end if;
  if c.invoice_id is null then return private.review_customer_claim(p_org_id,c.id,p_amount_satang,p_reference,p_key,p_decision,p_paid_on,p_method);end if;
  select * into i from public.invoices where org_id=p_org_id and id=c.invoice_id for update;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id for update;
  if c.client_id<>i.client_id or c.status<>'pending' then raise exception 'Claim unavailable for review'; end if;
  if p_decision='rejected' then
    if p_amount_satang<>0 then raise exception 'Rejected claim has no settlement'; end if;
    receipt:=c.id;
  else
    if i.issued_snapshot_id is null or i.status not in ('sent','overdue','partially_paid','paid') then raise exception 'Invoice is not payable'; end if;
    paid:=private.invoice_settled_satang(p_org_id,i.id);
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
  perform private.lock_finance_customer(p_org_id,original.invoice_id);
  select * into i from public.invoices where org_id=p_org_id and id=original.invoice_id for update;
  select * into original from public.payments where org_id=p_org_id and id=p_legacy_payment_id for update;
  if original.verification_state='legacy_reconciled' then
    select * into evidence from public.payments where org_id=p_org_id and id=original.reconciled_payment_id;
    if evidence.amount_satang<>p_amount_satang or evidence.verification_reference<>btrim(p_reference) or (evidence.paid_at at time zone 'Asia/Bangkok')::date<>p_paid_on or evidence.method<>p_method then raise exception 'Legacy receipt already reconciled differently'; end if;
    target:=evidence.id;
  else
    if original.verification_state<>'legacy_unverified' or i.issued_snapshot_id is null or i.status in ('draft','cancelled')
      or private.invoice_pending_satang(p_org_id,i.id)>0 then raise exception 'Legacy receipt not reconcilable; resolve pending claims first'; end if;
    paid:=private.invoice_settled_satang(p_org_id,i.id);
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

create or replace function public.reverse_payment(p_org_id uuid,p_payment_id uuid,p_reason text,p_reversed_on date,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare original public.payments;target uuid;cmd public.payment_command_results;req jsonb;allocation record;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may reverse receipts';end if;
  if p_key is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or p_reversed_on is null or not isfinite(p_reversed_on) or p_reversed_on>(now() at time zone 'Asia/Bangkok')::date then raise exception 'Invalid reversal evidence';end if;
  select * into original from public.payments where org_id=p_org_id and id=p_payment_id;
  if not found then raise exception 'Receipt unavailable';end if;
  perform 1 from public.clients where org_id=p_org_id and id=original.client_id for update;
  req:=jsonb_build_object('operation','reverse_payment','payment',p_payment_id,'reason',btrim(p_reason),'date',p_reversed_on);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if original.verification_state<>'verified' or original.reversal_of is not null or exists(select 1 from public.payments where org_id=p_org_id and reversal_of=original.id) then raise exception 'Unreversed verified receipt required';end if;
  if original.amount_satang>0 and coalesce((select sum(amount_satang) from public.payments where org_id=p_org_id and refund_of=original.id),0)<0 then raise exception 'Reverse customer refunds before reversing their source receipt';end if;
  if p_reversed_on<(original.paid_at at time zone 'Asia/Bangkok')::date then raise exception 'Reversal predates receipt';end if;
  perform private.assert_finance_date_open(p_org_id,p_reversed_on);
  perform 1 from public.invoices where org_id=p_org_id and id in(select invoice_id from public.payment_allocations where org_id=p_org_id and payment_id=original.id) order by id for update;
  insert into public.payments(org_id,client_id,invoice_id,amount_satang,paid_at,method,notes,verification_state,verified_by,verification_reference,command_key,reversal_of,refund_of)
    values(p_org_id,original.client_id,original.invoice_id,-original.amount_satang,p_reversed_on::timestamp at time zone 'Asia/Bangkok',original.method,btrim(p_reason),'verified',auth.uid(),left(btrim(p_reason),500),p_key,original.id,original.refund_of) returning id into target;
  for allocation in select invoice_id,sum(amount_satang)::bigint amount from public.payment_allocations where org_id=p_org_id and payment_id=original.id group by invoice_id having sum(amount_satang)<>0 order by invoice_id loop
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org_id,target,allocation.invoice_id,-allocation.amount);
    perform private.refresh_invoice_status(p_org_id,allocation.invoice_id);
  end loop;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'payment',target,'payment_reversed','Posted offsetting verified cash',jsonb_build_object('originalPaymentId',original.id,'clientId',original.client_id,'reason',btrim(p_reason),'reversedOn',p_reversed_on,'amountSatang',-original.amount_satang));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create view public.invoice_receipts with (security_invoker=true) as
select a.org_id,a.invoice_id,p.id,p.client_id,p.paid_at,p.method,p.notes,p.verification_state,p.verification_reference,p.reconciled_payment_id,p.reversal_of,
  sum(a.amount_satang)::bigint amount_satang,p.amount_satang receipt_amount_satang
from public.payment_allocations a join public.payments p on p.org_id=a.org_id and p.id=a.payment_id
group by a.org_id,a.invoice_id,p.id;
grant select on public.invoice_receipts to authenticated;

-- Historical adoption preserves unverified tax metadata; correct its retained collectible amount without certifying that tax.
create or replace function private.credit_note_totals(p_org uuid,p_invoice uuid,p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;g record;old_raw numeric;new_raw numeric;net numeric;old_net numeric;new_net numeric;
  old_vat numeric;new_vat numeric;old_base numeric:=0;new_base numeric:=0;vat numeric:=0;wht numeric;parts jsonb:='[]';total numeric;
begin
  select * into i from public.invoices where org_id=p_org and id=p_invoice;
  if exists(select 1 from public.invoice_snapshots where org_id=p_org and id=i.issued_snapshot_id and snapshot->>'kind'='legacy_operational_invoice') then
    select coalesce(nullif(sum(amount_satang),0),i.amount_satang) into net from public.invoice_items where org_id=p_org and invoice_id=p_invoice;
    select coalesce(sum(c.raw_satang),0) into old_raw from public.credit_note_lines c join public.credit_notes n on n.org_id=c.org_id and n.id=c.credit_note_id where n.org_id=p_org and n.invoice_id=p_invoice;
    select old_raw+coalesce(sum((e->>'raw_satang')::numeric),0) into new_raw from jsonb_array_elements(p_lines) e;
    if net<=0 then raise exception 'Positive historical amount required';end if;
    total:=div(2*i.amount_satang::numeric*(net-old_raw)+net,2*net)-div(2*i.amount_satang::numeric*(net-new_raw)+net,2*net);
    return jsonb_build_object('baseSatang',total,'vatSatang',0,'totalSatang',total,'whtSatang',0,'amountDueSatang',total,'vatByRate',jsonb_build_array(jsonb_build_object('rateBps',0,'baseSatang',total,'vatSatang',0)));
  end if;
  for g in select l.tax_rate_bps rate,sum(l.amount_satang)::numeric raw,
    (b->>'baseSatang')::numeric base,(b->>'vatSatang')::numeric tax
    from public.invoice_items l join lateral jsonb_array_elements(i.tax_breakdown) b on (b->>'rateBps')::integer=l.tax_rate_bps
    where l.org_id=p_org and l.invoice_id=p_invoice group by l.tax_rate_bps,b
  loop
    select coalesce(sum(c.raw_satang),0) into old_raw from public.credit_note_lines c join public.invoice_items l on l.id=c.invoice_item_id
      where c.org_id=p_org and l.invoice_id=p_invoice and l.tax_rate_bps=g.rate;
    select old_raw+coalesce(sum((e->>'raw_satang')::numeric),0) into new_raw from jsonb_array_elements(p_lines) e
      join public.invoice_items l on l.id=(e->>'invoice_item_id')::uuid where l.org_id=p_org and l.invoice_id=p_invoice and l.tax_rate_bps=g.rate;
    net:=g.base+case when i.prices_include_vat then g.tax else 0 end;
    old_net:=case when g.raw=0 then 0 else div(2*net*(g.raw-old_raw)+g.raw,2*g.raw) end;
    new_net:=case when g.raw=0 then 0 else div(2*net*(g.raw-new_raw)+g.raw,2*g.raw) end;
    old_vat:=case when old_raw=0 then g.tax else div(2*old_net*g.rate+case when i.prices_include_vat then 10000+g.rate else 10000 end,2*case when i.prices_include_vat then 10000+g.rate else 10000 end) end;
    new_vat:=case when new_raw=0 then g.tax else div(2*new_net*g.rate+case when i.prices_include_vat then 10000+g.rate else 10000 end,2*case when i.prices_include_vat then 10000+g.rate else 10000 end) end;
    old_base:=old_base+old_net-case when i.prices_include_vat then old_vat else 0 end;
    new_base:=new_base+new_net-case when i.prices_include_vat then new_vat else 0 end;
    vat:=vat+old_vat-new_vat;
    parts:=parts||jsonb_build_array(jsonb_build_object('rateBps',g.rate,'baseSatang',old_net-new_net-case when i.prices_include_vat then old_vat-new_vat else 0 end,'vatSatang',old_vat-new_vat));
  end loop;
  wht:=div(2*old_base*i.wht_rate_bps+10000,20000)-div(2*new_base*i.wht_rate_bps+10000,20000);
  total:=old_base-new_base+vat;
  return jsonb_build_object('baseSatang',old_base-new_base,'vatSatang',vat,'totalSatang',total,'whtSatang',wht,'amountDueSatang',total-wht,'vatByRate',parts);
end;
$$;
