create or replace function public.bill_purchase_order(p_org_id uuid,p_order_id uuid,p_bill jsonb)
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
    or (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(lines)) or exists(select id from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and received_quantity-returned_quantity>billed_quantity except select (value->>'id')::uuid from jsonb_array_elements(lines)) then raise exception 'Match every unbilled received line once';end if;
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
  if vat>base or (rate=0 and vat<>0) or abs(vat-round(base*rate/100))>least(base,3*jsonb_array_length(lines)) then raise exception 'Input VAT contradicts matched base and rate';end if;
  if total<>base+vat then raise exception 'Vendor total must equal matched base plus VAT';end if;
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

create or replace function public.link_vendor_credit(p_org_id uuid,p_cost_id uuid,p_bill jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  anchor public.costs; cost public.costs; original public.vendor_bill_matches; item public.purchase_order_items;
  ids uuid[]; entered jsonb:=p_bill->'lines'; line jsonb; billed jsonb; snapshot jsonb:='[]'; source_costs jsonb; bucket record;
  match_id uuid; ref text:=btrim(p_bill->>'vendor_reference'); credit_date date:=(p_bill->>'bill_date')::date;
  vat numeric:=(p_bill->>'input_vat_satang')::numeric; rate numeric:=(p_bill->>'input_vat_rate')::numeric;
  reason text:=nullif(btrim(p_bill->>'variance_reason'),''); variances jsonb:='[]';
  qty numeric; previous_qty numeric; returned_qty numeric; creditable_returned numeric; amount numeric; base numeric:=0; po_base numeric;
  cumulative numeric:=0; allocated numeric:=0; next_vat numeric; category_vat numeric; adjustment numeric; bill_no text;
  row_weight numeric; row_total numeric; row_base numeric; row_vat numeric; next_base numeric; next_row_vat numeric;
  original_base numeric; original_vat numeric; credited_base numeric; credited_vat numeric; expected_vat numeric;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into anchor from public.costs where org_id=p_org_id and id=p_cost_id;
  if not found or anchor.purchase_cost_kind<>'credit' or anchor.amount_satang>0 or anchor.vendor_id is null then raise exception 'Vendor return credit required';end if;
  perform id from public.purchase_orders where org_id=p_org_id and id=anchor.purchase_order_id for no key update;
  select * into anchor from public.costs where org_id=p_org_id and id=p_cost_id for update;
  select * into original from public.vendor_bill_matches where org_id=p_org_id and id=(p_bill->>'original_bill_id')::uuid and vendor_id=anchor.vendor_id and purchase_order_id=anchor.purchase_order_id and kind='bill' for update;
  if anchor.vendor_bill_match_id is not null then raise exception 'Vendor credit already linked';end if;
  if not found then raise exception 'Original matched vendor bill required';end if;
  if exists(select 1 from public.vendor_bill_matches where org_id=p_org_id and purchase_order_id=anchor.purchase_order_id and kind='credit' and jsonb_array_length(lines)=0) then raise exception 'Existing vendor credits need line reconciliation';end if;
  if ref is null or length(ref) not between 1 and 200 or credit_date is null or not isfinite(credit_date) or rate is null or rate not between 0 and 100 or rate<>round(rate,2)
    or vat is null or vat not between 0 and 9007199254740991 or vat<>round(vat) or length(reason)>2000 then raise exception 'Valid vendor credit reference, date and VAT required';end if;
  if exists(select 1 from public.vendor_bill_matches where org_id=p_org_id and vendor_id=anchor.vendor_id and lower(btrim(vendor_reference))=lower(ref)) then raise exception 'Duplicate vendor invoice reference';end if;
  if rate is distinct from (select input_vat_rate from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id order by id limit 1) then raise exception 'Credit VAT rate must match original invoice';end if;
  if p_bill ? 'cost_ids' then
    if jsonb_typeof(p_bill->'cost_ids')<>'array' then raise exception 'Select each return credit once';end if;
    select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_bill->'cost_ids');
  else ids:=array[p_cost_id];end if;
  if coalesce(cardinality(ids),0)=0 or not p_cost_id=any(ids) or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Select each return credit once';end if;
  perform id from public.costs where org_id=p_org_id and id=any(ids) order by id for update;
  if cardinality(ids)<>(select count(*) from public.costs where org_id=p_org_id and id=any(ids) and purchase_order_id=anchor.purchase_order_id and vendor_id=anchor.vendor_id and purchase_cost_kind='credit' and amount_satang<=0 and vendor_bill_match_id is null and paid_at is null) then raise exception 'Unlinked unpaid return credits from this purchase order required';end if;
  perform private.assert_finance_date_open(p_org_id,credit_date);
  for cost in select * from public.costs where org_id=p_org_id and id=any(ids) loop
    perform private.assert_finance_date_open(p_org_id,cost.incurred_on);
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'amount_satang',amount_satang,'incurred_on',incurred_on)) into source_costs from public.costs where org_id=p_org_id and id=any(ids);
  if entered is null or jsonb_typeof(entered)<>'array' or jsonb_array_length(entered)=0 then raise exception 'Returned credit lines required';end if;
  if (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(entered)) then raise exception 'Select each returned line once';end if;
  for line in select value from jsonb_array_elements(entered) loop
    select value into billed from jsonb_array_elements(original.lines) where (value->>'id')::uuid=(line->>'id')::uuid;
    if not found then raise exception 'Original billed line required';end if;
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=anchor.purchase_order_id and id=(line->>'id')::uuid for update;
    if not found then raise exception 'Original billed line required';end if;
    qty:=(line->>'quantity')::numeric;
    if qty is null or qty not between 0.001 and 999999999.999 or qty<>round(qty,3) then raise exception 'Invalid credit quantity';end if;
    select coalesce(sum((l->>'quantity')::numeric) filter(where m.original_bill_id=original.id),0),coalesce(sum((l->>'quantity')::numeric),0)
      into previous_qty,returned_qty from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l
      where m.org_id=p_org_id and m.purchase_order_id=anchor.purchase_order_id and m.kind='credit' and (l->>'id')::uuid=item.id;
    select coalesce(sum((l->>'expected_quantity')::numeric),0)-item.billed_quantity into creditable_returned
      from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) l
      where m.org_id=p_org_id and m.purchase_order_id=anchor.purchase_order_id and m.kind='bill' and (l->>'id')::uuid=item.id;
    if previous_qty+qty>(billed->>'expected_quantity')::numeric or returned_qty+qty>least(item.returned_quantity,creditable_returned) then raise exception 'Credit quantity exceeds original billed or returned quantity';end if;
    amount:=round((previous_qty+qty)*(billed->>'amount_satang')::numeric/(billed->>'expected_quantity')::numeric)-round(previous_qty*(billed->>'amount_satang')::numeric/(billed->>'expected_quantity')::numeric);
    snapshot:=snapshot||jsonb_build_array(jsonb_build_object('id',item.id,'quantity',qty,'amount_satang',amount,'po_amount_satang',round(qty*item.unit_cost_satang),'category',billed->>'category'));
    base:=base+amount;
  end loop;
  if base+vat>9007199254740991 then raise exception 'Credit amount within safe satang bounds required';end if;
  select sum(amount_satang-input_vat_satang),sum(input_vat_satang) into original_base,original_vat from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id;
  select coalesce(-sum(c.amount_satang-c.input_vat_satang),0),coalesce(-sum(c.input_vat_satang),0) into credited_base,credited_vat
    from public.costs c join public.vendor_bill_matches m on m.org_id=c.org_id and m.id=c.vendor_bill_match_id where c.org_id=p_org_id and m.original_bill_id=original.id;
  if vat>original_vat-credited_vat then raise exception 'Credit VAT exceeds remaining original input VAT';end if;
  if original_vat>original_base or (rate=0 and original_vat<>0) or abs(original_vat-round(original_base*rate/100))>least(original_base,3*jsonb_array_length(original.lines)) then raise exception 'Original invoice VAT needs reconciliation';end if;
  expected_vat:=case when original_base=0 then 0 else round(original_vat*(credited_base+base)/original_base)-credited_vat end;
  if vat<>expected_vat then raise exception 'Credit VAT must equal cumulative original invoice allocation';end if;
  if exists(select category::text from public.costs where org_id=p_org_id and id=any(ids) except select value->>'category' from jsonb_array_elements(snapshot)) then raise exception 'Select the costs for every credited category';end if;
  for bucket in select value->>'category' as category,sum((value->>'po_amount_satang')::numeric) as po_amount,count(*) as lines from jsonb_array_elements(snapshot) group by 1 loop
    select -sum(amount_satang) into po_base from public.costs where org_id=p_org_id and id=any(ids) and category::text=bucket.category;
    -- Each return command subtracts rounded cumulative PO amounts, which can differ by one satang per line.
    if po_base is null or abs(po_base-bucket.po_amount)>bucket.lines then raise exception 'Selected costs do not match returned line quantities';end if;
    if (select sum((value->>'amount_satang')::numeric) from jsonb_array_elements(original.lines) where value->>'category'=bucket.category) is distinct from
      (select sum(amount_satang-input_vat_satang) from public.costs where org_id=p_org_id and vendor_bill_match_id=original.id and category::text=bucket.category) then raise exception 'Original bill base does not match its line evidence';end if;
  end loop;
  insert into public.vendor_bill_matches(org_id,vendor_id,purchase_order_id,vendor_reference,kind,bill_date,due_date,original_bill_id,lines,tolerance_bps,variance_reason,variances)
    values(p_org_id,anchor.vendor_id,anchor.purchase_order_id,ref,'credit',credit_date,credit_date,original.id,snapshot,original.tolerance_bps,reason,variances) returning id into match_id;
  for bucket in select value->>'category' as category,sum((value->>'amount_satang')::numeric) as amount from jsonb_array_elements(snapshot) group by 1 order by 1 loop
    cumulative:=cumulative+bucket.amount;
    next_vat:=case when base=0 then 0 else round(vat*cumulative/base) end;
    category_vat:=next_vat-allocated;
    select -sum(amount_satang) into po_base from public.costs where org_id=p_org_id and id=any(ids) and category::text=bucket.category;
    adjustment:=bucket.amount-po_base;
    row_weight:=0;row_base:=0;row_vat:=0;
    row_total:=case when po_base=0 then (select count(*) from public.costs where org_id=p_org_id and id=any(ids) and category::text=bucket.category) else po_base end;
    for cost in select * from public.costs where org_id=p_org_id and id=any(ids) and category::text=bucket.category order by id loop
      row_weight:=row_weight+case when po_base=0 then 1 else -cost.amount_satang end;
      next_base:=round(bucket.amount*row_weight/row_total);
      next_row_vat:=round(category_vat*row_weight/row_total);
      update public.costs set vendor_bill_match_id=match_id,vendor_invoice_reference=ref,bill_date=credit_date,incurred_on=credit_date,due_date=credit_date,input_vat_rate=rate,input_vat_satang=-(next_row_vat-row_vat),amount_satang=-(next_base-row_base)-(next_row_vat-row_vat) where org_id=p_org_id and id=cost.id;
      row_base:=next_base;row_vat:=next_row_vat;
    end loop;
    if bucket.category='inventory' and adjustment<>0 then
      select po.number||'-A'||(count(c.id)+1)::text into bill_no from public.purchase_orders po left join public.costs c on c.org_id=po.org_id and c.purchase_order_id=po.id where po.org_id=p_org_id and po.id=anchor.purchase_order_id group by po.number;
      insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,purchase_order_id,bill_number,bill_date,purchase_cost_kind,notes)
        values(p_org_id,'inventory',adjustment,credit_date,anchor.vendor,anchor.purchase_order_id,bill_no,credit_date,'return_adjustment','Matched vendor credit price reconciliation '||ref);
    end if;
    allocated:=next_vat;
  end loop;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',anchor.purchase_order_id,'credit_linked','Linked vendor credit '||ref,jsonb_build_object('sourceCosts',source_costs,'matchId',match_id,'originalBillId',original.id,'lines',snapshot));
  return match_id;
exception when unique_violation then raise exception 'Duplicate vendor invoice reference';
end;
$$;
revoke all on function public.link_vendor_credit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.link_vendor_credit(uuid,uuid,jsonb) to authenticated;
