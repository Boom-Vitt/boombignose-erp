alter table public.payments add column reversal_of uuid;
alter table public.payments add constraint payment_reversal_tenant foreign key(org_id,reversal_of) references public.payments(org_id,id) deferrable initially deferred;
create unique index payment_one_reversal on public.payments(org_id,reversal_of) where reversal_of is not null;
alter table public.payments drop constraint payments_safe_amount;
alter table public.payments add constraint payments_safe_amount check(amount_satang between -9007199254740991 and 9007199254740991 and amount_satang<>0);
alter table public.payments add constraint reversal_is_negative check(reversal_of is null or (verification_state='verified' and amount_satang<0));
alter table public.payment_allocations drop constraint payment_allocations_amount_satang_check;
alter table public.payment_allocations add constraint allocation_safe_amount check(amount_satang between -9007199254740991 and 9007199254740991 and amount_satang<>0);

create function public.reverse_payment(p_org_id uuid,p_payment_id uuid,p_reason text,p_reversed_on date,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare original public.payments;i public.invoices;target uuid;cmd public.payment_command_results;req jsonb;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may reverse receipts';end if;
  if p_key is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or p_reversed_on is null or not isfinite(p_reversed_on) or p_reversed_on>(now() at time zone 'Asia/Bangkok')::date then raise exception 'Invalid reversal evidence';end if;
  select * into original from public.payments where org_id=p_org_id and id=p_payment_id;
  if not found then raise exception 'Receipt unavailable';end if;
  select * into i from public.invoices where org_id=p_org_id and id=original.invoice_id for update;
  select * into original from public.payments where org_id=p_org_id and id=p_payment_id for update;
  req:=jsonb_build_object('operation','reverse_payment','payment',p_payment_id,'reason',btrim(p_reason),'date',p_reversed_on);
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if original.verification_state<>'verified' or original.amount_satang<=0 or original.reversal_of is not null or exists(select 1 from public.payments where org_id=p_org_id and reversal_of=original.id) then raise exception 'Unreversed verified receipt required';end if;
  if p_reversed_on<(original.paid_at at time zone 'Asia/Bangkok')::date then raise exception 'Reversal predates receipt';end if;
  perform private.assert_finance_date_open(p_org_id,p_reversed_on);
  insert into public.payments(org_id,invoice_id,amount_satang,paid_at,method,notes,verification_state,verified_by,verification_reference,command_key,reversal_of)
    values(p_org_id,original.invoice_id,-original.amount_satang,p_reversed_on::timestamp at time zone 'Asia/Bangkok',original.method,btrim(p_reason),'verified',auth.uid(),left(btrim(p_reason),500),p_key,original.id) returning id into target;
  insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang)
    select org_id,target,invoice_id,-amount_satang from public.payment_allocations where org_id=p_org_id and payment_id=original.id;
  perform private.refresh_invoice_status(p_org_id,original.invoice_id);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'payment',target,'payment_reversed','Posted offsetting verified cash',jsonb_build_object('originalPaymentId',original.id,'reason',btrim(p_reason),'reversedOn',p_reversed_on,'amountSatang',-original.amount_satang));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.reverse_payment(uuid,uuid,text,date,uuid) from public,anon,service_role;
grant execute on function public.reverse_payment(uuid,uuid,text,date,uuid) to authenticated;
