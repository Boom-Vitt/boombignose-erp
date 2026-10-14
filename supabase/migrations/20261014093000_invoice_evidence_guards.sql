-- Forward fix: payment evidence freezes related commercial identity and lines.
create or replace function private.guard_invoice_settlement()
returns trigger language plpgsql set search_path = '' as $$
declare paid bigint;
begin
  if tg_op='UPDATE' and new.org_id<>old.org_id then raise exception 'Tenant reassignment forbidden'; end if;
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
  if c.client_id<>i.client_id then raise exception 'Claim customer no longer matches invoice'; end if;
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

alter table public.invoice_items drop constraint invoice_items_invoice_id_fkey;
alter table public.invoice_items add constraint invoice_items_invoice_tenant_fkey foreign key(org_id,invoice_id)
  references public.invoices(org_id,id) on delete cascade;
create or replace function private.guard_invoice_line()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; tenant uuid; amount numeric; parent public.invoices;
begin
  if tg_op='DELETE' then target:=old.invoice_id; tenant:=old.org_id;
  else target:=new.invoice_id; tenant:=new.org_id; end if;
  if tg_op='UPDATE' and (new.invoice_id<>old.invoice_id or new.org_id<>old.org_id) then raise exception 'Line reassignment forbidden'; end if;
  select * into parent from public.invoices where org_id=tenant and id=target for update;
  if not found then
    if tg_op='DELETE' then return old; end if;
    raise exception 'Invoice unavailable';
  end if;
  if exists(select 1 from public.payments where org_id=tenant and invoice_id=target and verification_state='verified')
    or exists(select 1 from public.payment_claims where org_id=tenant and invoice_id=target and status='pending') then
    raise exception 'Payment evidence locks invoice lines; use an explicit correction';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line amount'; end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount not between 0 and 9007199254740991 then raise exception 'Line exceeds safe satang bounds'; end if;
  new.amount_satang:=amount::bigint;
  return new;
end;
$$;
create trigger guard_invoice_line before insert or update or delete on public.invoice_items
  for each row execute function private.guard_invoice_line();
create or replace function private.recompute_invoice_lines()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; tenant uuid;
begin
  if tg_op='DELETE' then target:=old.invoice_id; tenant:=old.org_id;
  else target:=new.invoice_id; tenant:=new.org_id; end if;
  update public.invoices set amount_satang=(select coalesce(sum(amount_satang),0) from public.invoice_items where org_id=tenant and invoice_id=target)
    where org_id=tenant and id=target;
  return null;
end;
$$;
create trigger recompute_invoice_lines after insert or update or delete on public.invoice_items
  for each row execute function private.recompute_invoice_lines();
