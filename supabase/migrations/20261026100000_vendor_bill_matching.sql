alter table public.org_settings add column bill_variance_tolerance_bps integer not null default 100 check(bill_variance_tolerance_bps between 0 and 10000);

create table public.vendor_bill_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  vendor_id uuid not null,
  purchase_order_id uuid not null,
  vendor_reference text not null check(length(btrim(vendor_reference)) between 1 and 200),
  kind text not null check(kind in ('bill','credit')),
  bill_date date not null check(isfinite(bill_date)),
  due_date date not null check(isfinite(due_date) and due_date>=bill_date),
  original_bill_id uuid,
  lines jsonb not null default '[]' check(jsonb_typeof(lines)='array'),
  variances jsonb not null default '[]' check(jsonb_typeof(variances)='array'),
  variance_reason text check(length(variance_reason)<=2000),
  tolerance_bps integer not null check(tolerance_bps between 0 and 10000),
  created_at timestamptz not null default now(),
  unique(org_id,id),
  unique(org_id,id,vendor_id,purchase_order_id),
  foreign key(org_id,vendor_id) references public.vendors(org_id,id),
  foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id),
  foreign key(org_id,original_bill_id,vendor_id,purchase_order_id) references public.vendor_bill_matches(org_id,id,vendor_id,purchase_order_id),
  check(jsonb_array_length(variances)=0 or coalesce(length(btrim(variance_reason)),0)>0),
  check(kind='credit' or original_bill_id is null)
);
create unique index vendor_bill_reference_key on public.vendor_bill_matches(org_id,vendor_id,lower(btrim(vendor_reference)));
alter table public.vendor_bill_matches enable row level security;
alter table public.vendor_bill_matches force row level security;
revoke all on public.vendor_bill_matches from public,anon,authenticated;
grant select on public.vendor_bill_matches to authenticated;
create policy tenant_read on public.vendor_bill_matches for select to authenticated using(private.is_org_member(org_id));

alter table public.costs
  add column vendor_bill_match_id uuid,
  add column vendor_invoice_reference text,
  add column input_vat_rate numeric(5,2) not null default 0 check(input_vat_rate between 0 and 100),
  add column input_vat_satang bigint not null default 0 check(abs(input_vat_satang)<=9007199254740991),
  add constraint costs_vendor_match_fkey foreign key(org_id,vendor_bill_match_id,vendor_id,purchase_order_id) references public.vendor_bill_matches(org_id,id,vendor_id,purchase_order_id),
  add constraint costs_input_vat_sign check((amount_satang>=0 and input_vat_satang between 0 and amount_satang) or (amount_satang<0 and input_vat_satang between amount_satang and 0));
create index costs_vendor_match_idx on public.costs(org_id,vendor_bill_match_id) where vendor_bill_match_id is not null;
comment on column public.costs.amount_satang is 'Recorded gross money out, including input VAT; negative vendor credits reverse money out. Inventory category remains excluded from operating costs.';
comment on table public.vendor_bill_matches is 'Immutable vendor invoice matching evidence. Money out and allocated input VAT live only in costs.';

create or replace function private.guard_vendor_bill()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' then
    if tg_op='DELETE' and (old.vendor_id is not null or old.purchase_order_id is not null) then raise exception 'Linked vendor bills must be retained';end if;
    if tg_op='INSERT' and (new.vendor_id is not null or new.purchase_order_id is not null or new.vendor_bill_match_id is not null or new.vendor_invoice_reference is not null or new.input_vat_satang<>0 or new.input_vat_rate<>0) then raise exception 'Use purchase billing command';end if;
    if tg_op='UPDATE' then
      if old.vendor_id is not null or old.purchase_order_id is not null or new.vendor_id is not null or new.purchase_order_id is not null then
        if not private.is_org_staff(new.org_id) then raise exception 'Only owners and admins may pay vendor bills';end if;
        if (to_jsonb(new)-'paid_at'-'updated_at') is distinct from (to_jsonb(old)-'paid_at'-'updated_at') or
          (old.paid_at is not null and new.paid_at is distinct from old.paid_at) then raise exception 'Vendor bill evidence is immutable';end if;
      elsif new.vendor_bill_match_id is not null or new.vendor_invoice_reference is not null or new.input_vat_satang<>0 or new.input_vat_rate<>0 then raise exception 'Use purchase billing command';end if;
    end if;
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;

drop function public.bill_purchase_order(uuid,uuid);
create function public.bill_purchase_order(p_org_id uuid,p_order_id uuid,p_bill jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  po public.purchase_orders; vendor public.vendors; item public.purchase_order_items; line jsonb; bucket record;
  ref text:=btrim(p_bill->>'vendor_reference'); bill_date date:=(p_bill->>'bill_date')::date; due_date date;
  rate numeric:=(p_bill->>'input_vat_rate')::numeric; vat numeric:=(p_bill->>'input_vat_satang')::numeric;
  total numeric:=(p_bill->>'vendor_total_satang')::numeric; tolerance integer; reason text:=nullif(btrim(p_bill->>'variance_reason'),'');
  lines jsonb:=p_bill->'lines'; snapshot jsonb:='[]'; variances jsonb:='[]'; qty numeric; price numeric; expected numeric; amount numeric;
  base numeric:=0; cumulative numeric:=0; allocated_base numeric:=0; allocated_vat numeric:=0; next_base numeric; next_vat numeric;
  match_id uuid; result uuid; bill_no text; category text;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  if ref is null or length(ref) not between 1 and 200 or bill_date is null or not isfinite(bill_date) or rate is null or rate not between 0 and 100 or rate<>round(rate,2)
    or vat is null or vat not between 0 and 9007199254740991 or vat<>round(vat) or total is null or total not between vat and 9007199254740991 or total<>round(total)
    or length(reason)>2000 then raise exception 'Valid vendor reference, dates, VAT and total required';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status::text not in ('confirmed','received','closed','billed') then raise exception 'Received purchase quantities required';end if;
  if exists(select 1 from public.vendor_bill_matches where org_id=p_org_id and vendor_id=po.vendor_id and lower(btrim(vendor_reference))=lower(ref)) then raise exception 'Duplicate vendor invoice reference';end if;
  select * into vendor from public.vendors where org_id=p_org_id and id=po.vendor_id;
  due_date:=coalesce(nullif(p_bill->>'due_date','')::date,bill_date+vendor.payment_terms_days);
  if not isfinite(due_date) or due_date<bill_date then raise exception 'Due date must be on or after bill date';end if;
  perform private.assert_finance_date_open(p_org_id,bill_date);
  select bill_variance_tolerance_bps into tolerance from public.org_settings where org_id=p_org_id;
  tolerance:=coalesce(tolerance,100);
  perform id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id order by id for update;
  if lines is null then
    select jsonb_agg(jsonb_build_object('id',id,'quantity',received_quantity-returned_quantity-billed_quantity,'expected_quantity',received_quantity-returned_quantity-billed_quantity,'unit_cost_satang',unit_cost_satang) order by id)
      into lines from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity-returned_quantity>billed_quantity;
  end if;
  if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)=0 then raise exception 'Receive quantities before creating a bill';end if;
  if jsonb_array_length(lines)<>(select count(*) from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity-returned_quantity>billed_quantity)
    or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(lines)) then raise exception 'Match every unbilled received line once';end if;
  for line in select value from jsonb_array_elements(lines) loop
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and id=(line->>'id')::uuid;
    if not found then raise exception 'Bill line unavailable';end if;
    expected:=item.received_quantity-item.returned_quantity-item.billed_quantity;
    if expected<=0 or (line->>'expected_quantity')::numeric is distinct from expected then raise exception 'Receipt changed, reload';end if;
    qty:=(line->>'quantity')::numeric; price:=(line->>'unit_cost_satang')::numeric;
    if qty is null or qty not between 0.001 and 999999999.999 or qty<>round(qty,3) or price is null or price not between 0 and 9007199254740991 or price<>round(price) then raise exception 'Invalid vendor bill line';end if;
    if abs(qty-expected)*10000>expected*tolerance then variances:=variances||jsonb_build_array('Quantity: '||item.id);end if;
    if abs(price-item.unit_cost_satang)*10000>item.unit_cost_satang*tolerance then variances:=variances||jsonb_build_array('Price: '||item.id);end if;
    amount:=case when qty=expected and price=item.unit_cost_satang then round((item.billed_quantity+qty)*price)-round(item.billed_quantity*price) else round(qty*price) end;
    base:=base+amount;
    if base>9007199254740991 then raise exception 'Bill amount within safe satang bounds required';end if;
    category:='other';
    if exists(select 1 from public.products where org_id=p_org_id and id=item.product_id and is_stockable) then category:='inventory';end if;
    snapshot:=snapshot||jsonb_build_array(jsonb_build_object('id',item.id,'quantity',qty,'expected_quantity',expected,'unit_cost_satang',price,'po_unit_cost_satang',item.unit_cost_satang,'amount_satang',amount,'category',category));
  end loop;
  if vat<>round(base*rate/100) then variances:=variances||jsonb_build_array('Input VAT differs from rate');end if;
  if total<>base+vat then variances:=variances||jsonb_build_array('Vendor total differs from matched lines');end if;
  if jsonb_array_length(variances)>0 and reason is null then raise exception 'Variance reason required';end if;
  insert into public.vendor_bill_matches(org_id,vendor_id,purchase_order_id,vendor_reference,kind,bill_date,due_date,lines,variances,variance_reason,tolerance_bps)
    values(p_org_id,vendor.id,po.id,ref,'bill',bill_date,due_date,snapshot,variances,reason,tolerance) returning id into match_id;
  for bucket in select value->>'category' as category,sum((value->>'amount_satang')::numeric) as amount from jsonb_array_elements(snapshot) group by 1 order by 1 loop
    cumulative:=cumulative+bucket.amount;
    next_base:=case when base=0 then total-vat else div(2*(total-vat)*cumulative+base,2*base) end;
    next_vat:=case when base=0 then vat else div(2*vat*cumulative+base,2*base) end;
    select po.number||'-B'||(count(*)+1)::text into bill_no from public.costs where org_id=p_org_id and purchase_order_id=po.id;
    insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,vendor_id,purchase_order_id,bill_number,bill_date,due_date,notes,purchase_cost_kind,vendor_bill_match_id,vendor_invoice_reference,input_vat_rate,input_vat_satang)
      values(p_org_id,bucket.category::public.cost_category,next_base-allocated_base+next_vat-allocated_vat,bill_date,vendor.name,vendor.id,po.id,bill_no,bill_date,due_date,'Vendor invoice '||ref,'bill',match_id,ref,rate,next_vat-allocated_vat) returning id into result;
    allocated_base:=next_base; allocated_vat:=next_vat;
  end loop;
  update public.purchase_order_items set billed_quantity=received_quantity-returned_quantity where org_id=p_org_id and purchase_order_id=po.id;
  if po.status::text<>'closed' and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='billed' where org_id=p_org_id and id=po.id;
  end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'bill_created','Matched vendor invoice '||ref,jsonb_build_object('matchId',match_id,'total_satang',total,'input_vat_satang',vat,'variances',variances,'reason',reason));
  return result;
exception when unique_violation then raise exception 'Duplicate vendor invoice reference';
end;
$$;
revoke all on function public.bill_purchase_order(uuid,uuid,jsonb) from public,anon;
grant execute on function public.bill_purchase_order(uuid,uuid,jsonb) to authenticated;

create function public.link_vendor_credit(p_org_id uuid,p_cost_id uuid,p_bill jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare cost public.costs; original public.vendor_bill_matches; match_id uuid; ref text:=btrim(p_bill->>'vendor_reference'); bill_date date:=(p_bill->>'bill_date')::date;
  vat numeric:=(p_bill->>'input_vat_satang')::numeric; rate numeric:=(p_bill->>'input_vat_rate')::numeric;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into cost from public.costs where org_id=p_org_id and id=p_cost_id for update;
  if not found or cost.purchase_cost_kind<>'credit' or cost.amount_satang>=0 or cost.vendor_id is null then raise exception 'Vendor return credit required';end if;
  if cost.vendor_bill_match_id is not null then raise exception 'Vendor credit already linked';end if;
  if cost.paid_at is not null then raise exception 'Link vendor credit before marking it paid';end if;
  select * into original from public.vendor_bill_matches where org_id=p_org_id and id=(p_bill->>'original_bill_id')::uuid and vendor_id=cost.vendor_id and purchase_order_id=cost.purchase_order_id and kind='bill' for update;
  if not found then raise exception 'Original matched vendor bill required';end if;
  if ref is null or length(ref) not between 1 and 200 or bill_date is null or not isfinite(bill_date) or rate is null or rate not between 0 and 100 or rate<>round(rate,2)
    or vat is null or vat not between 0 and 9007199254740991 or vat<>round(vat) or abs(cost.amount_satang)+vat>9007199254740991 then raise exception 'Valid vendor credit reference, date and VAT required';end if;
  if vat>coalesce((select sum(c.input_vat_satang) from public.costs c join public.vendor_bill_matches m on m.org_id=c.org_id and m.id=c.vendor_bill_match_id where c.org_id=p_org_id and (m.id=original.id or m.original_bill_id=original.id)),0) then raise exception 'Credit VAT exceeds remaining original input VAT';end if;
  perform private.assert_finance_date_open(p_org_id,bill_date);
  if vat<>round(abs(cost.amount_satang)*rate/100) and nullif(btrim(p_bill->>'variance_reason'),'') is null then raise exception 'Variance reason required';end if;
  insert into public.vendor_bill_matches(org_id,vendor_id,purchase_order_id,vendor_reference,kind,bill_date,due_date,original_bill_id,tolerance_bps,variance_reason,variances)
    values(p_org_id,cost.vendor_id,cost.purchase_order_id,ref,'credit',bill_date,bill_date,original.id,original.tolerance_bps,nullif(btrim(p_bill->>'variance_reason'),''),case when vat<>round(abs(cost.amount_satang)*rate/100) then '["Input VAT differs from rate"]'::jsonb else '[]'::jsonb end) returning id into match_id;
  update public.costs set vendor_bill_match_id=match_id,vendor_invoice_reference=ref,bill_date=(p_bill->>'bill_date')::date,incurred_on=(p_bill->>'bill_date')::date,input_vat_rate=rate,input_vat_satang=-vat,amount_satang=amount_satang-vat where org_id=p_org_id and id=cost.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',cost.purchase_order_id,'credit_linked','Linked vendor credit '||ref,jsonb_build_object('costId',cost.id,'matchId',match_id,'originalBillId',original.id));
  return match_id;
exception when unique_violation then raise exception 'Duplicate vendor invoice reference';
end;
$$;
revoke all on function public.link_vendor_credit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.link_vendor_credit(uuid,uuid,jsonb) to authenticated;

create view public.monthly_purchase_vat with(security_invoker=true) as
select org_id,date_trunc('month',bill_date)::date as month,sum(amount_satang-input_vat_satang)::bigint as base_satang,sum(input_vat_satang)::bigint as input_vat_satang,sum(amount_satang)::bigint as total_satang
from public.costs where vendor_bill_match_id is not null group by org_id,date_trunc('month',bill_date)::date;
grant select on public.monthly_purchase_vat to authenticated;
