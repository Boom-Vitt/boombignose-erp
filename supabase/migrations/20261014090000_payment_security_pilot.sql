-- Local pilot migration; production application requires reviewed reconciliation.
-- Old receipts are retained, not certified. Portal-created legacy receipts must
-- be reconciled against actual bank evidence before the workspace is released.
create or replace function private.is_org_staff(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where org_id=target_org
    and user_id=(select auth.uid()) and role in ('owner','admin'));
$$;
revoke all on function private.is_org_staff(uuid) from public, anon;
grant execute on function private.is_org_staff(uuid) to authenticated;

alter table clients add constraint clients_org_id_id_key unique(org_id,id);
alter table invoices add constraint invoices_org_id_id_key unique(org_id,id);
alter table payments add constraint payments_org_id_id_key unique(org_id,id);
-- Fail on existing cross-tenant links; never delete or repair customer data here.
alter table invoices drop constraint invoices_client_id_fkey;
alter table invoices add constraint invoices_client_tenant_fkey foreign key(org_id,client_id)
  references clients(org_id,id) on delete restrict;
alter table payments drop constraint payments_invoice_id_fkey;
alter table payments add constraint payments_invoice_tenant_fkey foreign key(org_id,invoice_id)
  references invoices(org_id,id) on delete restrict;

alter table payments add column verification_state text not null default 'legacy_unverified'
  check (verification_state in ('legacy_unverified','verified'));
alter table payments add column verified_by uuid references auth.users(id) on delete restrict;
alter table payments add column verification_reference text;
alter table payments add column command_key uuid;
alter table payments add constraint verified_payment_evidence check(verification_state <> 'verified'
  or (verified_by is not null and length(btrim(verification_reference)) between 3 and 500 and command_key is not null));
alter table payments add constraint payments_safe_amount check(amount_satang between 1 and 9007199254740991) not valid;
alter table invoices add constraint invoices_safe_amount check(amount_satang between 0 and 9007199254740991) not valid;
create unique index payments_command_key on payments(org_id,command_key) where command_key is not null;

create table payment_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,
  invoice_id uuid not null,
  amount_satang bigint not null check(amount_satang between 1 and 9007199254740991),
  reference text not null check(length(btrim(reference)) between 1 and 500),
  status text not null default 'pending' check(status in ('pending','verified','rejected')),
  idempotency_key uuid not null,
  reviewed_by uuid references auth.users(id) on delete restrict,
  review_reference text,
  reviewed_at timestamptz,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id), unique(org_id,idempotency_key),
  foreign key(org_id,client_id) references clients(org_id,id) on delete restrict,
  foreign key(org_id,invoice_id) references invoices(org_id,id) on delete restrict,
  foreign key(org_id,payment_id) references payments(org_id,id) on delete restrict,
  check((status='pending' and reviewed_at is null and payment_id is null)
    or (status='rejected' and reviewed_by is not null and reviewed_at is not null and payment_id is null)
    or (status='verified' and reviewed_by is not null and reviewed_at is not null and payment_id is not null))
);
create unique index payment_claims_one_pending on payment_claims(org_id,invoice_id) where status='pending';
create trigger set_updated_at before update on payment_claims for each row execute function public.set_updated_at();
create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_satang bigint not null check(amount_satang between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  unique(org_id,payment_id),
  foreign key(org_id,payment_id) references payments(org_id,id) on delete restrict,
  foreign key(org_id,invoice_id) references invoices(org_id,id) on delete restrict
);
create table payment_command_results (
  org_id uuid not null references organizations(id) on delete cascade,
  key uuid not null,
  request jsonb not null,
  result uuid,
  created_at timestamptz not null default now(),
  primary key(org_id,key)
);
alter table payment_claims enable row level security;
alter table payment_claims force row level security;
alter table payment_allocations enable row level security;
alter table payment_allocations force row level security;
alter table payment_command_results enable row level security;
alter table payment_command_results force row level security;
create policy claims_read on payment_claims for select to authenticated using(private.is_org_member(org_id));
create policy allocations_read on payment_allocations for select to authenticated using(private.is_org_member(org_id));
drop policy payments_rw on payments;
create policy payments_read on payments for select to authenticated using(private.is_org_member(org_id));
-- Settlements and evidence are writable only inside the authorized command.
revoke insert,update,delete on payments,payment_claims,payment_allocations,payment_command_results from authenticated,anon;

create or replace function private.guard_invoice_settlement()
returns trigger language plpgsql set search_path = '' as $$
declare paid bigint;
begin
  if tg_op='UPDATE' and new.org_id<>old.org_id then raise exception 'Tenant reassignment forbidden'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments
    where org_id=new.org_id and invoice_id=new.id and verification_state='verified';
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
create trigger guard_invoice_settlement before insert or update on invoices
  for each row execute function private.guard_invoice_settlement();

create or replace function public.submit_payment_claim(p_token text,p_invoice_id uuid,p_amount_satang bigint,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.clients; i public.invoices; existing public.payment_claims; paid bigint; result uuid;
begin
  if p_key is null or p_amount_satang is null or p_amount_satang not between 1 and 9007199254740991
    or p_reference is null or length(btrim(p_reference)) not between 1 and 500 then raise exception 'Invalid claim'; end if;
  select * into c from public.clients where portal_token=p_token and portal_enabled for share;
  if not found then raise exception 'Portal unavailable'; end if;
  select * into i from public.invoices where id=p_invoice_id and org_id=c.org_id and client_id=c.id for update;
  if not found then raise exception 'Invoice unavailable'; end if;
  select * into existing from public.payment_claims where org_id=c.org_id and idempotency_key=p_key;
  if found then
    if existing.invoice_id<>i.id or existing.amount_satang<>p_amount_satang or existing.reference<>btrim(p_reference) then
      raise exception 'Idempotency conflict'; end if;
    return existing.id;
  end if;
  if i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
  select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=c.org_id and invoice_id=i.id and verification_state='verified';
  if p_amount_satang>i.amount_satang-paid then raise exception 'Claim exceeds open balance'; end if;
  -- Different retries while a report is pending resolve to that report only when identical.
  select * into existing from public.payment_claims where org_id=c.org_id and invoice_id=i.id and status='pending';
  if found then
    if existing.amount_satang<>p_amount_satang or existing.reference<>btrim(p_reference) then raise exception 'Pending claim already exists'; end if;
    return existing.id;
  end if;
  insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key)
    values(c.org_id,c.id,i.id,p_amount_satang,btrim(p_reference),p_key) returning id into result;
  insert into public.audit_log(org_id,entity,entity_id,action,summary,meta)
    values(c.org_id,'payment_claim',result,'payment_claim_submitted','Customer reported payment; awaiting verification',jsonb_build_object('invoiceId',i.id));
  return result;
end;
$$;
revoke all on function public.submit_payment_claim(text,uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.submit_payment_claim(text,uuid,bigint,text,uuid) to service_role;

create or replace function public.review_payment_claim(p_org_id uuid,p_claim_id uuid,p_amount_satang bigint,p_reference text,p_key uuid,p_decision text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.payment_claims; i public.invoices; cmd public.payment_command_results; req jsonb; paid bigint; receipt uuid; actor uuid:=auth.uid();
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may verify payments'; end if;
  if p_key is null or p_decision is null or p_decision not in ('verified','rejected') or p_amount_satang is null
    or p_reference is null or length(btrim(p_reference)) not between 3 and 500 then raise exception 'Invalid verification evidence'; end if;
  req:=jsonb_build_object('claim',p_claim_id,'amount',p_amount_satang,'reference',btrim(p_reference),'decision',p_decision);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict'; end if;
  if cmd.result is not null then return cmd.result; end if;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id;
  if not found then raise exception 'Claim unavailable'; end if;
  -- Always lock invoice then claim, matching submission lock order.
  select * into i from public.invoices where org_id=p_org_id and id=c.invoice_id for update;
  select * into c from public.payment_claims where org_id=p_org_id and id=p_claim_id for update;
  if c.status<>'pending' then raise exception 'Claim already reviewed'; end if;
  if p_decision='rejected' then
    if p_amount_satang<>0 then raise exception 'Rejected claim has no settlement'; end if;
    receipt:=c.id;
  else
    if i.status not in ('sent','overdue','partially_paid') then raise exception 'Invoice is not payable'; end if;
    select coalesce(sum(amount_satang),0) into paid from public.payments where org_id=p_org_id and invoice_id=i.id and verification_state='verified';
    if p_amount_satang not between 1 and 9007199254740991 or p_amount_satang>i.amount_satang-paid
      or p_amount_satang>c.amount_satang then raise exception 'Verified amount exceeds claim or open balance'; end if;
    insert into public.payments(org_id,invoice_id,amount_satang,verification_state,verified_by,verification_reference,command_key,notes)
      values(p_org_id,i.id,p_amount_satang,'verified',actor,btrim(p_reference),p_key,'Verified customer payment claim') returning id into receipt;
    insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) values(p_org_id,receipt,i.id,p_amount_satang);
    update public.invoices set status=case when paid+p_amount_satang=amount_satang then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end
      where id=i.id and org_id=p_org_id;
  end if;
  update public.payment_claims set status=p_decision,reviewed_by=actor,review_reference=btrim(p_reference),reviewed_at=now(),
    payment_id=case when p_decision='verified' then receipt else null end where id=c.id and org_id=p_org_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,actor,'payment',receipt,case when p_decision='verified' then 'payment_verified' else 'payment_claim_rejected' end,
      case when p_decision='verified' then 'Verified and allocated payment' else 'Rejected payment claim' end,
      jsonb_build_object('invoiceId',i.id,'claimId',c.id,'amountSatang',p_amount_satang,'reference',btrim(p_reference)));
  update public.payment_command_results set result=receipt where org_id=p_org_id and key=p_key;
  return receipt;
end;
$$;
revoke all on function public.review_payment_claim(uuid,uuid,bigint,text,uuid,text) from public,anon,service_role;
grant execute on function public.review_payment_claim(uuid,uuid,bigint,text,uuid,text) to authenticated;
