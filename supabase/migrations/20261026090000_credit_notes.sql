create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  number text not null,
  issue_date date not null,
  reason text not null check(length(btrim(reason)) between 3 and 1000),
  amount_satang bigint not null check(amount_satang between 0 and 9007199254740991),
  snapshot jsonb not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(org_id,id),unique(org_id,number),
  foreign key(org_id,invoice_id) references public.invoices(org_id,id) on delete cascade
);
create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  credit_note_id uuid not null,
  invoice_item_id uuid not null,
  raw_satang bigint not null check(raw_satang between 1 and 9007199254740991),
  foreign key(org_id,credit_note_id) references public.credit_notes(org_id,id) on delete cascade,
  foreign key(org_id,invoice_item_id) references public.invoice_items(org_id,id) on delete cascade,
  unique(org_id,credit_note_id,invoice_item_id)
);
alter table public.credit_notes enable row level security;
alter table public.credit_notes force row level security;
alter table public.credit_note_lines enable row level security;
alter table public.credit_note_lines force row level security;
create policy credit_notes_read on public.credit_notes for select to authenticated using(private.is_org_member(org_id));
create policy credit_lines_read on public.credit_note_lines for select to authenticated using(private.is_org_member(org_id));
revoke all on public.credit_notes,public.credit_note_lines from anon,authenticated,service_role;
grant select on public.credit_notes,public.credit_note_lines to authenticated,service_role;

create function private.retain_credit_note() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.organizations where id=old.org_id) then raise exception 'Issued credit notes are immutable';end if;
  return old;
end;
$$;
create trigger retain_credit_note before update or delete on public.credit_notes for each row execute function private.retain_credit_note();
create trigger retain_credit_line before update or delete on public.credit_note_lines for each row execute function private.retain_credit_note();

create function private.invoice_settled_satang(p_org uuid,p_invoice uuid) returns bigint language sql stable security definer set search_path='' as $$
  select (coalesce((select sum(amount_satang) from public.payments where org_id=p_org and invoice_id=p_invoice and verification_state='verified'),0)
    +coalesce((select sum(amount_satang) from public.credit_notes where org_id=p_org and invoice_id=p_invoice),0))::bigint;
$$;
revoke all on function private.invoice_settled_satang(uuid,uuid) from public,anon,authenticated,service_role;

create function private.refresh_invoice_status(p_org uuid,p_invoice uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.invoices;settled bigint;
begin
  select * into i from public.invoices where org_id=p_org and id=p_invoice for update;
  if i.issued_snapshot_id is null or i.status='cancelled' then return;end if;
  settled:=private.invoice_settled_satang(p_org,p_invoice);
  update public.invoices set status=case when settled>=amount_satang then 'paid'::public.invoice_status
    when settled>0 then 'partially_paid'::public.invoice_status else 'sent'::public.invoice_status end where org_id=p_org and id=p_invoice;
end;
$$;
revoke all on function private.refresh_invoice_status(uuid,uuid) from public,anon,authenticated,service_role;

-- Residual tax makes successive partial corrections add up to the original VAT and WHT.
create function private.credit_note_totals(p_org uuid,p_invoice uuid,p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;g record;old_raw numeric;new_raw numeric;net numeric;old_net numeric;new_net numeric;
  old_vat numeric;new_vat numeric;old_base numeric:=0;new_base numeric:=0;vat numeric:=0;wht numeric;parts jsonb:='[]';total numeric;
begin
  select * into i from public.invoices where org_id=p_org and id=p_invoice;
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
revoke all on function private.credit_note_totals(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.issue_credit_note(p_org_id uuid,p_invoice_id uuid,p_lines jsonb,p_reason text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;l public.invoice_items;line_input jsonb;raw numeric;used numeric;qty numeric;chosen jsonb:='[]';lines jsonb:='[]';
  cmd public.payment_command_results;req jsonb;target uuid;totals jsonb;original jsonb;counter bigint;num text;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue credit notes';end if;
  if p_key is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000
    or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invalid credit note';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found then raise exception 'Invoice unavailable';end if;
  req:=jsonb_build_object('operation','credit_note','invoice',i.id,'lines',p_lines,'reason',btrim(p_reason));
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if i.issued_snapshot_id is null or i.status in ('draft','cancelled') then raise exception 'Issued invoice required';end if;
  perform private.assert_finance_date_open(p_org_id,today);
  if exists(select 1 from public.payment_claims where org_id=p_org_id and invoice_id=i.id and status='pending') then raise exception 'Resolve pending payment claims before crediting';end if;
  if exists(select 1 from jsonb_array_elements(p_lines) e group by e->>'invoice_item_id' having count(*)>1) then raise exception 'Duplicate credit line';end if;
  for line_input in select value from jsonb_array_elements(p_lines) loop
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
  perform private.refresh_invoice_status(p_org_id,i.id);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'credit_note_issued','Issued linked credit note',jsonb_build_object('creditNoteId',target,'number',num,'reason',btrim(p_reason),'amountSatang',totals->'amountDueSatang'));
  update public.payment_command_results set result=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;
revoke all on function public.issue_credit_note(uuid,uuid,jsonb,text,uuid) from public,anon,service_role;
grant execute on function public.issue_credit_note(uuid,uuid,jsonb,text,uuid) to authenticated;

create or replace view public.invoice_balances with (security_invoker=true) as
select i.org_id,i.id invoice_id,i.client_id,i.status,i.amount_satang,paid.satang::bigint paid_satang,
  greatest(i.amount_satang-paid.satang-credit.satang,0)::bigint outstanding_satang,
  credit.satang::bigint credited_satang,(i.amount_satang-credit.satang)::bigint collectible_satang
from public.invoices i
cross join lateral(select coalesce(sum(amount_satang),0) satang from public.payments where org_id=i.org_id and invoice_id=i.id and verification_state='verified') paid
cross join lateral(select coalesce(sum(amount_satang),0) satang from public.credit_notes where org_id=i.org_id and invoice_id=i.id) credit;

create or replace function private.guard_invoice_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare paid bigint;
begin
  if tg_op='UPDATE' and new.org_id<>old.org_id then raise exception 'Tenant reassignment forbidden'; end if;
  -- Linking an audited historical snapshot preserves its original state, even if cash disagrees.
  if tg_op='UPDATE' and old.issued_snapshot_id is null and new.issued_snapshot_id is not null
    and to_jsonb(new)-array['version','updated_at','issued_snapshot_id']=to_jsonb(old)-array['version','updated_at','issued_snapshot_id']
    and exists(select 1 from public.invoice_snapshots s where s.org_id=old.org_id and s.invoice_id=old.id and s.id=new.issued_snapshot_id
      and s.source_version=old.version and s.snapshot->>'kind'='legacy_operational_invoice'
      and s.snapshot->'legacy'->'originalInvoice'=to_jsonb(old)-array['version','updated_at','issued_snapshot_id']) then return new;end if;
  paid:=private.invoice_settled_satang(new.org_id,new.id);
  if tg_op='UPDATE' and new.client_id<>old.client_id and exists(select 1 from public.payment_claims where org_id=old.org_id and invoice_id=old.id and status='pending') then
    raise exception 'Pending claim prevents customer reassignment'; end if;
  if paid>0 and paid>=new.amount_satang and new.status<>'paid' then raise exception 'Settled invoice must remain paid'; end if;
  if new.status='paid' and (new.amount_satang=0 or paid<new.amount_satang) then
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
  paid:=private.invoice_settled_satang(c.org_id,i.id);
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
  paid:=private.invoice_settled_satang(p_org_id,i.id);
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
  select * into i from public.invoices where org_id=p_org_id and id=original.invoice_id for update;
  select * into original from public.payments where org_id=p_org_id and id=p_legacy_payment_id for update;
  if original.verification_state='legacy_reconciled' then
    select * into evidence from public.payments where org_id=p_org_id and id=original.reconciled_payment_id;
    if evidence.amount_satang<>p_amount_satang or evidence.verification_reference<>btrim(p_reference) or (evidence.paid_at at time zone 'Asia/Bangkok')::date<>p_paid_on or evidence.method<>p_method then raise exception 'Legacy receipt already reconciled differently'; end if;
    target:=evidence.id;
  else
    if original.verification_state<>'legacy_unverified' or i.issued_snapshot_id is null or i.status in ('draft','cancelled')
      or exists(select 1 from public.payment_claims where org_id=p_org_id and invoice_id=i.id and status='pending') then raise exception 'Legacy receipt not reconcilable; resolve pending claims first'; end if;
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
