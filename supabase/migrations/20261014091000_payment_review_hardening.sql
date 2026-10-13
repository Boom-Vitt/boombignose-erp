-- Forward fix after independent pilot review; do not rewrite the applied pilot.
create table public.portal_claim_requests (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key uuid not null,
  request jsonb not null,
  result uuid,
  created_at timestamptz not null default now(),
  primary key(org_id,key),
  foreign key(org_id,result) references public.payment_claims(org_id,id) on delete cascade
);
alter table public.portal_claim_requests enable row level security;
alter table public.portal_claim_requests force row level security;
revoke all on public.portal_claim_requests from authenticated,anon;

-- Caller-authored operational audits cannot impersonate trusted payment events.
drop policy audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check(private.is_org_member(org_id) and actor_id=(select auth.uid())
    and entity not in ('payment','payment_claim') and action not like 'payment_%');
drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated using(private.is_org_staff(org_id));

create or replace function public.submit_payment_claim(p_token text,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.clients; i public.invoices; existing public.payment_claims; paid bigint; result uuid; cmd public.portal_claim_requests; req jsonb;
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
  if i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=c.org_id and invoice_id=i.id and verification_state='verified';
  if p_amount_satang>i.amount_satang-paid then raise exception 'Claim exceeds open balance'; end if;
  -- Different retries while a report is pending resolve to that report only when identical.
  select * into existing from public.payment_claims where org_id=c.org_id and invoice_id=i.id and status='pending';
  if found then
    if existing.amount_satang<>p_amount_satang or existing.reference<>btrim(p_reference) then raise exception 'Pending claim already exists'; end if;
    update public.portal_claim_requests set result=existing.id where org_id=c.org_id and key=p_key;
    return existing.id;
  end if;
  insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key)
    values(c.org_id,c.id,i.id,p_amount_satang,btrim(p_reference),p_key) returning id into result;
  insert into public.audit_log(org_id,entity,entity_id,action,summary,meta)
    values(c.org_id,'payment_claim',result,'payment_claim_submitted','Customer reported payment; awaiting verification',jsonb_build_object('invoiceId',i.id));
  update public.portal_claim_requests set result=result where org_id=c.org_id and key=p_key;
  return result;
end;
$$;
