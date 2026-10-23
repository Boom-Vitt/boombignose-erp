alter table public.vendor_bill_matches add column credit_request jsonb check(credit_request is null or (kind='credit' and jsonb_typeof(credit_request)='object'));

create table public.vendor_return_credit_sources (
  org_id uuid not null references public.organizations(id) on delete cascade,
  cost_id uuid not null,
  purchase_order_item_id uuid not null,
  quantity numeric(12,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
  primary key(cost_id,purchase_order_item_id),
  foreign key(org_id,cost_id) references public.costs(org_id,id) on delete cascade,
  foreign key(org_id,purchase_order_item_id) references public.purchase_order_items(org_id,id) on delete cascade
);
alter table public.vendor_return_credit_sources enable row level security;
alter table public.vendor_return_credit_sources force row level security;
revoke all on public.vendor_return_credit_sources from public,anon,authenticated;
grant select on public.vendor_return_credit_sources to authenticated;
create policy tenant_read on public.vendor_return_credit_sources for select to authenticated using(private.is_org_member(org_id));
comment on table public.vendor_return_credit_sources is 'Immutable physical quantities behind each raw vendor return cost. Money remains in costs; evidence-free legacy costs require reconciliation.';

create function private.capture_vendor_return_credit_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.purchase_cost_kind is distinct from 'credit' or new.vendor_bill_match_id is not null or new.purchase_order_id is null then return new;end if;
  -- Legacy costs have no per-return quantity provenance, so never assign their units to a later return.
  if exists(select 1 from public.costs c left join public.vendor_bill_matches m on m.org_id=c.org_id and m.id=c.vendor_bill_match_id
    where c.org_id=new.org_id and c.purchase_order_id=new.purchase_order_id and c.id<>new.id
      and ((c.purchase_cost_kind='bill' and c.vendor_bill_match_id is null)
        or (c.purchase_cost_kind='credit' and m.credit_request is null and not exists(select 1 from public.vendor_return_credit_sources s where s.org_id=c.org_id and s.cost_id=c.id)))) then return new;end if;
  insert into public.vendor_return_credit_sources(org_id,cost_id,purchase_order_item_id,quantity)
    select new.org_id,new.id,i.id,
      (select coalesce(sum((l->>'expected_quantity')::numeric),0) from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l where m.org_id=new.org_id and m.purchase_order_id=new.purchase_order_id and m.kind='bill' and (l->>'id')::uuid=i.id)
      -i.billed_quantity-coalesce((select sum(s.quantity) from public.vendor_return_credit_sources s where s.org_id=new.org_id and s.purchase_order_item_id=i.id),0)
    from public.purchase_order_items i left join public.products p on p.org_id=i.org_id and p.id=i.product_id
    where i.org_id=new.org_id and i.purchase_order_id=new.purchase_order_id and new.category::text=case when coalesce(p.is_stockable,false) then 'inventory' else 'other' end
      and (select coalesce(sum((l->>'expected_quantity')::numeric),0) from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l where m.org_id=new.org_id and m.purchase_order_id=new.purchase_order_id and m.kind='bill' and (l->>'id')::uuid=i.id)
        -i.billed_quantity>coalesce((select sum(s.quantity) from public.vendor_return_credit_sources s where s.org_id=new.org_id and s.purchase_order_item_id=i.id),0);
  return new;
end;
$$;
revoke all on function private.capture_vendor_return_credit_source() from public,anon,authenticated,service_role;
create trigger capture_vendor_return_credit_source after insert on public.costs for each row execute function private.capture_vendor_return_credit_source();

create or replace function public.link_vendor_credit(p_org_id uuid,p_cost_id uuid,p_bill jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  anchor public.costs; cost public.costs; original public.vendor_bill_matches; item public.purchase_order_items;
  ids uuid[]; allocations jsonb:=p_bill->'allocations'; allocation jsonb; entered jsonb; line jsonb; billed jsonb;
  normalized jsonb:='[]'; request jsonb; snapshot jsonb:='[]'; original_lines jsonb; source_costs jsonb; bucket record;
  match_id uuid; sole_original uuid; ref text:=btrim(p_bill->>'vendor_reference'); credit_date date:=(p_bill->>'bill_date')::date;
  vat numeric:=(p_bill->>'input_vat_satang')::numeric; requested_rate numeric:=(p_bill->>'input_vat_rate')::numeric; rate numeric;
  reason text:=nullif(btrim(p_bill->>'variance_reason'),''); tolerance integer:=100;
  qty numeric; previous_qty numeric; returned_qty numeric; creditable_returned numeric; amount numeric; base numeric:=0; allocation_base numeric; po_base numeric;
  cumulative numeric; allocated numeric; next_vat numeric; adjustment numeric; bill_no text; first_bucket boolean;
  row_weight numeric; row_total numeric; row_base numeric; row_vat numeric; next_base numeric; next_row_vat numeric;
  original_base numeric; original_vat numeric; credited_base numeric; credited_vat numeric; expected_vat numeric; total_vat numeric:=0; remaining_vat numeric:=0;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into anchor from public.costs where org_id=p_org_id and id=p_cost_id;
  if not found or anchor.purchase_cost_kind<>'credit' or anchor.amount_satang>0 or anchor.vendor_id is null then raise exception 'Vendor return credit required';end if;
  if ref is null or length(ref) not between 1 and 200 or credit_date is null or not isfinite(credit_date)
    or vat is null or vat not between 0 and 9007199254740991 or vat<>round(vat) or length(reason)>2000
    or (p_bill ? 'input_vat_rate' and (requested_rate is null or requested_rate not between 0 and 100 or requested_rate<>round(requested_rate,2))) then
    if anchor.vendor_bill_match_id is not null then raise exception 'Vendor credit already linked';end if;
    raise exception 'Valid vendor credit reference, date and VAT required';
  end if;
  if allocations is null then allocations:=jsonb_build_array(jsonb_build_object('original_bill_id',p_bill->'original_bill_id','lines',p_bill->'lines'));end if;
  if jsonb_typeof(allocations)<>'array' or jsonb_array_length(allocations)=0 then raise exception 'Original bill allocations required';end if;
  if (select count(*)<>count(distinct (value->>'original_bill_id')::uuid) from jsonb_array_elements(allocations)) then raise exception 'Select each original bill once';end if;
  for allocation in select value from jsonb_array_elements(allocations) order by (value->>'original_bill_id')::uuid loop
    entered:=allocation->'lines';
    if entered is null or jsonb_typeof(entered)<>'array' or jsonb_array_length(entered)=0 then raise exception 'Returned credit lines required';end if;
    if (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(entered)) then raise exception 'Select each returned line once';end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('original_bill_id',(allocation->>'original_bill_id')::uuid,'lines',
      (select jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'quantity',(value->>'quantity')::numeric) order by (value->>'id')::uuid) from jsonb_array_elements(entered))));
  end loop;
  if p_bill ? 'cost_ids' then
    if jsonb_typeof(p_bill->'cost_ids')<>'array' then raise exception 'Select each return credit once';end if;
    select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_bill->'cost_ids');
  else ids:=array[p_cost_id];end if;
  if coalesce(cardinality(ids),0)=0 or not p_cost_id=any(ids) or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Select each return credit once';end if;
  request:=jsonb_build_object('vendor_reference',lower(ref),'bill_date',credit_date,'input_vat_satang',vat,'variance_reason',reason,'cost_ids',to_jsonb(ids),'allocations',normalized);
  perform id from public.purchase_orders where org_id=p_org_id and id=anchor.purchase_order_id for no key update;
  select * into anchor from public.costs where org_id=p_org_id and id=p_cost_id for update;
  if anchor.vendor_bill_match_id is not null then
    select * into original from public.vendor_bill_matches where org_id=p_org_id and id=anchor.vendor_bill_match_id;
    if original.credit_request=request then
      if requested_rate is not null and exists(select 1 from jsonb_array_elements(original.lines) l where (l->>'input_vat_rate')::numeric<>requested_rate) then raise exception 'Credit VAT rate must match original invoice';end if;
      return original.id;
    end if;
    raise exception 'Vendor credit already linked with different evidence';
  end if;
  if exists(select 1 from public.vendor_bill_matches where org_id=p_org_id and vendor_id=anchor.vendor_id and lower(btrim(vendor_reference))=lower(ref)) then raise exception 'Duplicate vendor invoice reference';end if;
  if exists(select 1 from public.vendor_bill_matches where org_id=p_org_id and purchase_order_id=anchor.purchase_order_id and kind='credit' and jsonb_array_length(lines)=0) then raise exception 'Existing vendor credits need line reconciliation';end if;
  perform id from public.costs where org_id=p_org_id and id=any(ids) order by id for update;
  if cardinality(ids)<>(select count(*) from public.costs where org_id=p_org_id and id=any(ids) and purchase_order_id=anchor.purchase_order_id and vendor_id=anchor.vendor_id and purchase_cost_kind='credit' and amount_satang<=0 and vendor_bill_match_id is null and paid_at is null) then raise exception 'Unlinked unpaid return credits from this purchase order required';end if;
  perform private.assert_finance_date_open(p_org_id,credit_date);
  for cost in select * from public.costs where org_id=p_org_id and id=any(ids) loop
    perform private.assert_finance_date_open(p_org_id,cost.incurred_on);
    if cost.bill_date is not null then perform private.assert_finance_date_open(p_org_id,cost.bill_date);end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'amount_satang',amount_satang,'incurred_on',incurred_on,'category',category) order by id) into source_costs from public.costs where org_id=p_org_id and id=any(ids);
  perform id from public.vendor_bill_matches where org_id=p_org_id and id in(select (value->>'original_bill_id')::uuid from jsonb_array_elements(normalized)) order by id for update;
  perform id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=anchor.purchase_order_id order by id for update;
  for allocation in select value from jsonb_array_elements(normalized) loop
    select * into original from public.vendor_bill_matches where org_id=p_org_id and id=(allocation->>'original_bill_id')::uuid and vendor_id=anchor.vendor_id and purchase_order_id=anchor.purchase_order_id and kind='bill';
    if not found then raise exception 'Original matched vendor bill required';end if;
    tolerance:=original.tolerance_bps;
    select min(input_vat_rate),sum(amount_satang-input_vat_satang),sum(input_vat_satang) into rate,original_base,original_vat from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id;
    if rate is null or exists(select 1 from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id and input_vat_rate<>rate) then raise exception 'Original invoice VAT needs reconciliation';end if;
    if requested_rate is not null and requested_rate<>rate then raise exception 'Credit VAT rate must match original invoice';end if;
    original_lines:='[]';allocation_base:=0;
    for line in select value from jsonb_array_elements(allocation->'lines') loop
      select value into billed from jsonb_array_elements(original.lines) where (value->>'id')::uuid=(line->>'id')::uuid;
      if not found then raise exception 'Original billed line required';end if;
      select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=anchor.purchase_order_id and id=(line->>'id')::uuid;
      if not found then raise exception 'Original billed line required';end if;
      qty:=(line->>'quantity')::numeric;
      if qty is null or qty not between 0.001 and 999999999.999 or qty<>round(qty,3) then raise exception 'Invalid credit quantity';end if;
      select coalesce(sum((l->>'quantity')::numeric) filter(where coalesce((l->>'original_bill_id')::uuid,m.original_bill_id)=original.id),0),coalesce(sum((l->>'quantity')::numeric),0)
        into previous_qty,returned_qty from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l
        where m.org_id=p_org_id and m.purchase_order_id=anchor.purchase_order_id and m.kind='credit' and (l->>'id')::uuid=item.id;
      select coalesce(sum((l->>'expected_quantity')::numeric),0)-item.billed_quantity into creditable_returned from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l
        where m.org_id=p_org_id and m.purchase_order_id=anchor.purchase_order_id and m.kind='bill' and (l->>'id')::uuid=item.id;
      if previous_qty+qty>(billed->>'expected_quantity')::numeric or returned_qty+qty>least(item.returned_quantity,creditable_returned) then raise exception 'Credit quantity exceeds original billed or returned quantity';end if;
      amount:=round((previous_qty+qty)*(billed->>'amount_satang')::numeric/(billed->>'expected_quantity')::numeric)-round(previous_qty*(billed->>'amount_satang')::numeric/(billed->>'expected_quantity')::numeric);
      original_lines:=original_lines||jsonb_build_array(jsonb_build_object('original_bill_id',original.id,'id',item.id,'quantity',qty,'amount_satang',amount,'category',billed->>'category','input_vat_rate',rate));
      allocation_base:=allocation_base+amount;
    end loop;
    if exists(select 1 from (select value->>'category' category,sum((value->>'amount_satang')::numeric) amount from jsonb_array_elements(original.lines) group by 1) l
      full join (select category::text category,sum(amount_satang-input_vat_satang) amount from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id group by 1) c using(category) where l.amount is distinct from c.amount) then raise exception 'Original bill base does not match its line evidence';end if;
    select coalesce(sum((l->>'amount_satang')::numeric),0),coalesce(sum((l->>'input_vat_satang')::numeric),0) into credited_base,credited_vat
      from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l where m.org_id=p_org_id and m.kind='credit' and coalesce((l->>'original_bill_id')::uuid,m.original_bill_id)=original.id;
    credited_vat:=credited_vat+coalesce((select -sum(c.input_vat_satang) from public.costs c join public.vendor_bill_matches m on m.org_id=c.org_id and m.id=c.vendor_bill_match_id
      where c.org_id=p_org_id and m.original_bill_id=original.id and m.credit_request is null),0);
    if original_vat>original_base or (rate=0 and original_vat<>0) or abs(original_vat-round(original_base*rate/100))>least(original_base,3*jsonb_array_length(original.lines)) then raise exception 'Original invoice VAT needs reconciliation';end if;
    expected_vat:=case when original_base=0 then 0 else round(original_vat*(credited_base+allocation_base)/original_base)-credited_vat end;
    if expected_vat<0 or expected_vat>original_vat-credited_vat then raise exception 'Credit VAT exceeds remaining original input VAT';end if;
    cumulative:=0;allocated:=0;
    for line in select value from jsonb_array_elements(original_lines) order by value->>'category',value->>'id' loop
      cumulative:=cumulative+(line->>'amount_satang')::numeric;
      next_vat:=case when allocation_base=0 then 0 else round(expected_vat*cumulative/allocation_base) end;
      snapshot:=snapshot||jsonb_build_array(line||jsonb_build_object('input_vat_satang',next_vat-allocated));
      allocated:=next_vat;
    end loop;
    total_vat:=total_vat+expected_vat;remaining_vat:=remaining_vat+original_vat-credited_vat;base:=base+allocation_base;
  end loop;
  if base+vat>9007199254740991 then raise exception 'Credit amount within safe satang bounds required';end if;
  if vat>remaining_vat then raise exception 'Credit VAT exceeds remaining original input VAT';end if;
  if vat<>total_vat then raise exception 'Credit VAT must equal cumulative original invoice allocation';end if;
  if exists(select 1 from public.costs c where c.org_id=p_org_id and c.id=any(ids) and not exists(select 1 from public.vendor_return_credit_sources s where s.org_id=c.org_id and s.cost_id=c.id)) then raise exception 'Return costs need source quantity reconciliation';end if;
  if exists(select 1 from (select (l->>'id')::uuid id,l->>'category' category,sum((l->>'quantity')::numeric) quantity from jsonb_array_elements(snapshot) l group by 1,2) a
    full join (select s.purchase_order_item_id id,c.category::text category,sum(s.quantity) quantity from public.vendor_return_credit_sources s join public.costs c on c.org_id=s.org_id and c.id=s.cost_id where s.org_id=p_org_id and s.cost_id=any(ids) group by 1,2) s using(id,category)
    where a.quantity is distinct from s.quantity) then raise exception 'Selected costs do not match returned line quantities';end if;
  if jsonb_array_length(normalized)=1 then sole_original:=(normalized->0->>'original_bill_id')::uuid;end if;
  insert into public.vendor_bill_matches(org_id,vendor_id,purchase_order_id,vendor_reference,kind,bill_date,due_date,original_bill_id,lines,tolerance_bps,variance_reason,credit_request)
    values(p_org_id,anchor.vendor_id,anchor.purchase_order_id,ref,'credit',credit_date,credit_date,sole_original,snapshot,tolerance,reason,request) returning id into match_id;
  for allocation in select jsonb_build_object('category',value->>'category','amount',sum((value->>'amount_satang')::numeric)) from jsonb_array_elements(snapshot) group by value->>'category' order by value->>'category' loop
    select -sum((value->>'amount_satang')::numeric) into po_base from jsonb_array_elements(source_costs) where value->>'category'=allocation->>'category';
    adjustment:=(allocation->>'amount')::numeric-po_base;first_bucket:=true;
    for bucket in select (value->>'input_vat_rate')::numeric rate,sum((value->>'amount_satang')::numeric) amount,sum((value->>'input_vat_satang')::numeric) vat from jsonb_array_elements(snapshot) where value->>'category'=allocation->>'category' group by 1 order by 1 loop
      if first_bucket then
        row_weight:=0;row_base:=0;row_vat:=0;
        row_total:=case when po_base=0 then (select count(*) from jsonb_array_elements(source_costs) where value->>'category'=allocation->>'category') else po_base end;
        for cost in select * from public.costs where org_id=p_org_id and id=any(ids) and category::text=allocation->>'category' order by id loop
          row_weight:=row_weight+case when po_base=0 then 1 else -cost.amount_satang end;
          next_base:=round(bucket.amount*row_weight/row_total);next_row_vat:=round(bucket.vat*row_weight/row_total);
          update public.costs set vendor_bill_match_id=match_id,vendor_invoice_reference=ref,bill_date=credit_date,incurred_on=credit_date,due_date=credit_date,input_vat_rate=bucket.rate,input_vat_satang=-(next_row_vat-row_vat),amount_satang=-(next_base-row_base)-(next_row_vat-row_vat) where org_id=p_org_id and id=cost.id;
          row_base:=next_base;row_vat:=next_row_vat;
        end loop;
        first_bucket:=false;
      else
        select po.number||'-C'||(count(c.id)+1)::text into bill_no from public.purchase_orders po left join public.costs c on c.org_id=po.org_id and c.purchase_order_id=po.id where po.org_id=p_org_id and po.id=anchor.purchase_order_id group by po.number;
        insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,vendor_id,purchase_order_id,bill_number,bill_date,due_date,purchase_cost_kind,vendor_bill_match_id,vendor_invoice_reference,input_vat_rate,input_vat_satang,notes)
          values(p_org_id,(allocation->>'category')::public.cost_category,-bucket.amount-bucket.vat,credit_date,anchor.vendor,anchor.vendor_id,anchor.purchase_order_id,bill_no,credit_date,credit_date,'credit',match_id,ref,bucket.rate,-bucket.vat,'Vendor credit VAT allocation '||ref);
      end if;
    end loop;
    if allocation->>'category'='inventory' and adjustment<>0 then
      select po.number||'-A'||(count(c.id)+1)::text into bill_no from public.purchase_orders po left join public.costs c on c.org_id=po.org_id and c.purchase_order_id=po.id where po.org_id=p_org_id and po.id=anchor.purchase_order_id group by po.number;
      insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,purchase_order_id,bill_number,bill_date,purchase_cost_kind,notes)
        values(p_org_id,'inventory',adjustment,credit_date,anchor.vendor,anchor.purchase_order_id,bill_no,credit_date,'return_adjustment','Matched vendor credit price reconciliation '||ref);
    end if;
  end loop;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',anchor.purchase_order_id,'credit_linked','Linked vendor credit '||ref,jsonb_build_object('sourceCosts',source_costs,'matchId',match_id,'allocations',normalized,'lines',snapshot));
  return match_id;
exception when unique_violation then raise exception 'Duplicate vendor invoice reference';
end;
$$;
revoke all on function public.link_vendor_credit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.link_vendor_credit(uuid,uuid,jsonb) to authenticated;
