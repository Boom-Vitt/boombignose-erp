create function private.quote_deposit_buckets(p_org uuid,p_quote uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rate',rate,'amount',amount) order by rate),'[]') from (
    select l.tax_rate_bps rate,sum(l.amount_satang-coalesce(c.amount,0))::bigint amount
    from public.invoices i join public.invoice_items l on l.org_id=i.org_id and l.invoice_id=i.id
    left join lateral(select sum(raw_satang) amount from public.credit_note_lines where org_id=l.org_id and invoice_item_id=l.id) c on true
    where i.org_id=p_org and i.source_quote_id=p_quote and i.quote_invoice_kind='deposit' and i.status<>'cancelled'
    group by l.tax_rate_bps
  ) buckets;
$$;
revoke all on function private.quote_deposit_buckets(uuid,uuid) from public,anon,authenticated,service_role;

create function private.quote_rate_capacity(p_org uuid,p_quote uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_agg(jsonb_build_object('rate',b->'rateBps','amount',
    (b->>'baseSatang')::bigint+case when q.prices_include_vat then (b->>'vatSatang')::bigint else 0 end
    -coalesce((select sum((t->>'baseSatang')::bigint+case when q.prices_include_vat then (t->>'vatSatang')::bigint else 0 end)
      from public.invoices i cross join lateral jsonb_array_elements(i.tax_breakdown) t where i.org_id=p_org and i.source_quote_id=p_quote and i.quote_invoice_kind='lines' and i.status<>'cancelled' and t->>'rateBps'=b->>'rateBps'),0)
    -coalesce((select (d->>'amount')::bigint from jsonb_array_elements(private.quote_deposit_buckets(p_org,p_quote)) d where d->>'rate'=b->>'rateBps'),0)) order by (b->>'rateBps')::integer)
  from public.quotes q cross join lateral jsonb_array_elements(q.tax_breakdown) b where q.org_id=p_org and q.id=p_quote;
$$;
revoke all on function private.quote_rate_capacity(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.convert_accepted_quote(p_org_id uuid,p_quote_id uuid,p_key uuid,p_lines jsonb default null,p_deposit_satang bigint default null,p_deposit_bps integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.quotes;request public.quote_conversion_requests;project uuid;milestone uuid;invoice uuid;item record;
  payload jsonb;chosen jsonb;qty numeric;raw_amount numeric:=0;previous_raw numeric;previous_discount numeric;discount bigint;
  mixed boolean;capacity jsonb;bucket record;available_total numeric;allocated bigint:=0;
  deposits bigint;deposit bigint;deposit_deduction bigint;rate integer;final_invoice boolean;
  today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may convert quotes';end if;
  if p_key is null then raise exception 'Command key required';end if;
  if (p_deposit_satang is not null and p_deposit_bps is not null) or (p_lines is not null and (p_deposit_satang is not null or p_deposit_bps is not null))
    or (p_deposit_satang is not null and p_deposit_satang not between 1 and 9007199254740991)
    or (p_deposit_bps is not null and p_deposit_bps not between 1 and 10000) then raise exception 'Invalid invoice scope';end if;
  payload:=jsonb_build_object('lines',p_lines,'depositSatang',p_deposit_satang,'depositBps',p_deposit_bps);
  insert into public.quote_conversion_requests(org_id,key,quote_id,request_payload) values(p_org_id,p_key,p_quote_id,payload) on conflict do nothing;
  select * into request from public.quote_conversion_requests where org_id=p_org_id and key=p_key for update;
  if request.quote_id<>p_quote_id or (request.request_payload is not null and request.request_payload<>payload) then raise exception 'Idempotency conflict';end if;
  if request.invoice_id is not null then return request.invoice_id;end if;
  select * into q from public.quotes where org_id=p_org_id and id=p_quote_id for no key update;
  if not found or q.status not in ('accepted','converted') then raise exception 'Accepted quote required';end if;
  if q.total_satang<=0 or q.discount_satang>q.subtotal_satang then raise exception 'Billable quote required';end if;
  select count(distinct tax_rate_bps)>1 into mixed from public.quote_items where org_id=p_org_id and quote_id=q.id;
  select coalesce(sum(quote_deposit_satang-quote_deposit_deduction_satang),0),coalesce(sum(quote_discount_satang),0)
    into deposits,previous_discount from public.invoices where org_id=p_org_id and source_quote_id=q.id and status<>'cancelled' and quote_invoice_sealed;
  if mixed then
    select coalesce(sum((d->>'amount')::bigint),0) into deposits from jsonb_array_elements(private.quote_deposit_buckets(p_org_id,q.id)) d;
    deposits:=deposits-coalesce((select sum(quote_deposit_deduction_satang) from public.invoices where org_id=p_org_id and source_quote_id=q.id and quote_invoice_kind='lines' and status<>'cancelled' and issued_snapshot_id is null),0);
  end if;
  select coalesce(sum(l.amount_satang),0) into previous_raw from public.invoice_items l join public.invoices i on i.org_id=l.org_id and i.id=l.invoice_id
    where i.org_id=p_org_id and i.source_quote_id=q.id and i.status<>'cancelled' and i.quote_invoice_kind='lines' and l.quote_item_id is not null;
  if p_lines is null and p_deposit_satang is null and p_deposit_bps is null and q.converted_invoice_id is not null
    and not exists(select 1 from public.quote_items where org_id=p_org_id and quote_id=q.id and quantity>invoiced_quantity) then
    update public.quote_conversion_requests set invoice_id=q.converted_invoice_id where org_id=p_org_id and key=p_key;
    return q.converted_invoice_id;
  end if;

  if p_lines is null then
    select coalesce(jsonb_agg(jsonb_build_object('quote_item_id',id,'quantity',quantity-invoiced_quantity) order by position,id),'[]') into chosen
      from public.quote_items where org_id=p_org_id and quote_id=q.id and quantity>invoiced_quantity;
  else chosen:=p_lines;end if;
  if jsonb_typeof(chosen)<>'array' or jsonb_array_length(chosen)=0 then raise exception 'Unbilled quote lines required';end if;
  if exists(select 1 from jsonb_array_elements(chosen) e group by e->>'quote_item_id' having count(*)>1) then raise exception 'Duplicate quote line';end if;
  for item in select e from jsonb_array_elements(chosen) e loop
    qty:=(item.e->>'quantity')::numeric;
    if qty is null or qty<=0 or qty<>round(qty,3) or qty>999999999.999 then raise exception 'Invalid invoice quantity';end if;
    if not exists(select 1 from public.quote_items where org_id=p_org_id and quote_id=q.id and id=(item.e->>'quote_item_id')::uuid and qty<=quantity-invoiced_quantity) then
      raise exception 'Quantity exceeds unbilled quote line';end if;
  end loop;
  select not exists(select 1 from public.quote_items l where l.org_id=p_org_id and l.quote_id=q.id and l.quantity-l.invoiced_quantity>
    coalesce((select (e->>'quantity')::numeric from jsonb_array_elements(chosen) e where (e->>'quote_item_id')::uuid=l.id),0)) into final_invoice;
  deposit:=coalesce(p_deposit_satang,case when p_deposit_bps is not null then div(2*(q.subtotal_satang-q.discount_satang)::numeric*p_deposit_bps+10000,20000)::bigint end);
  if deposit is not null then
    if mixed then
      capacity:=private.quote_rate_capacity(p_org_id,q.id);
      if exists(select 1 from jsonb_array_elements(capacity) c where (c->>'amount')::bigint<0) then raise exception 'Quote rate capacity exhausted';end if;
      select sum((c->>'amount')::numeric) into available_total from jsonb_array_elements(capacity) c;
      if deposit>available_total then raise exception 'Deposit exceeds remaining quote value';end if;
    end if;
    if deposit<=0 or deposit>q.subtotal_satang-q.discount_satang-deposits-(previous_raw-previous_discount) then raise exception 'Deposit exceeds remaining quote value';end if;
    select min(tax_rate_bps) into rate from public.quote_items where org_id=p_org_id and quote_id=q.id;
  end if;
  project:=q.project_id;
  if project is null then
    insert into public.projects(org_id,client_id,name,budget_satang,source_quote_id) values(p_org_id,q.client_id,'Service '||q.number,q.total_satang,q.id) returning id into project;
    update public.quotes set project_id=project where org_id=p_org_id and id=q.id;
  end if;
  select id into milestone from public.milestones where org_id=p_org_id and source_quote_id=q.id and project_id=project order by created_at,id limit 1;
  if milestone is null then
    insert into public.milestones(org_id,project_id,title,source_quote_id) values(p_org_id,project,'Delivery '||q.number,q.id) returning id into milestone;
  end if;
  insert into public.invoices(org_id,client_id,project_id,number,status,amount_satang,source_quote_id,source_milestone_id,issue_date,notes,prices_include_vat,quote_invoice_kind,quote_deposit_satang)
    values(p_org_id,q.client_id,project,'DRAFT-'||gen_random_uuid()::text,'draft',0,q.id,milestone,today,'From accepted quote '||q.number,q.prices_include_vat,
      case when deposit is null then 'lines' else 'deposit' end,coalesce(deposit,0)) returning id into invoice;
  if deposit is not null then
    if mixed then
      for bucket in
        select (c->>'rate')::integer rate,(c->>'amount')::numeric amount,
          row_number() over(order by mod(deposit::numeric*(c->>'amount')::numeric,available_total) desc,(c->>'rate')::integer) rank,
          deposit-sum(div(deposit::numeric*(c->>'amount')::numeric,available_total)) over() remainder
        from jsonb_array_elements(capacity) c order by (c->>'rate')::integer
      loop
        allocated:=div(deposit::numeric*bucket.amount,available_total)::bigint+case when bucket.rank<=bucket.remainder then 1 else 0 end;
        if allocated>0 then
          insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps)
            values(p_org_id,invoice,'Deposit for '||q.number,1,allocated,bucket.rate);
        end if;
      end loop;
    else
    insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps)
      values(p_org_id,invoice,'Deposit for '||q.number,1,deposit,rate);
    end if;
  else
    for item in select l.*,(e->>'quantity')::numeric bill_quantity from jsonb_array_elements(chosen) e
      join public.quote_items l on l.org_id=p_org_id and l.quote_id=q.id and l.id=(e->>'quote_item_id')::uuid order by l.position,l.id
    loop
      insert into public.invoice_items(org_id,invoice_id,quote_item_id,product_id,description,quantity,unit,unit_price_satang,tax_rate_bps)
        values(p_org_id,invoice,item.id,item.product_id,item.description,item.bill_quantity,item.unit,item.unit_price_satang,item.tax_rate_bps);
      update public.quote_items set invoiced_quantity=invoiced_quantity+item.bill_quantity where org_id=p_org_id and id=item.id;
    end loop;
    select sum(amount_satang) into raw_amount from public.invoice_items where org_id=p_org_id and invoice_id=invoice;
    discount:=case when final_invoice then q.discount_satang-previous_discount else greatest(0,least(q.discount_satang-previous_discount,
      div(2*q.discount_satang::numeric*(previous_raw+raw_amount)+q.subtotal_satang,2*q.subtotal_satang)-previous_discount))::bigint end;
    deposit_deduction:=case when final_invoice then deposits else 0 end;
    if discount+deposit_deduction>raw_amount then raise exception 'Invoice remaining quantities together to deduct deposits';end if;
    if not final_invoice and previous_raw-previous_discount+raw_amount-discount+deposits>q.subtotal_satang-q.discount_satang then
      raise exception 'Partial invoice exceeds quote value reserved by deposits';end if;
    update public.invoices set discount_satang=discount+case when mixed then 0 else deposit_deduction end,
      quote_discount_satang=discount,quote_deposit_deduction_satang=deposit_deduction where org_id=p_org_id and id=invoice;
  end if;
  if mixed and not final_invoice and deposit is null and exists(select 1 from jsonb_array_elements(private.quote_rate_capacity(p_org_id,q.id)) c where (c->>'amount')::bigint<0) then raise exception 'Partial invoice exceeds rate value reserved by deposits';end if;
  update public.invoices set quote_invoice_sealed=true where org_id=p_org_id and id=invoice;
  update public.quotes set status='converted',converted_invoice_id=invoice where org_id=p_org_id and id=q.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Created invoice from accepted quote',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key,'scope',payload));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;

alter function public.issue_invoice(uuid,uuid,integer,uuid) set schema private;
alter function private.issue_invoice(uuid,uuid,integer,uuid) rename to issue_invoice_document;
revoke all on function private.issue_invoice_document(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;

create function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;deposit public.invoices;source uuid;target uuid;lines jsonb;receipt record;previous jsonb;released bigint;outstanding bigint;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue invoices';end if;
  select source_quote_id into source from public.invoices where org_id=p_org_id and id=p_invoice_id;
  if source is not null then perform 1 from public.quotes where org_id=p_org_id and id=source for no key update;end if;
  perform private.lock_finance_customer(p_org_id,p_invoice_id);
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  target:=private.issue_invoice_document(p_org_id,p_invoice_id,p_expected_version,p_key);
  if i.issued_snapshot_id is not null or i.quote_deposit_deduction_satang=0 or
    (select count(distinct tax_rate_bps) from public.quote_items where org_id=p_org_id and quote_id=source)<=1 then return target;end if;
  select coalesce(jsonb_object_agg(id::text,coalesce(private.receipt_available_satang(p_org_id,id),0)),'{}') into previous from public.payments where org_id=p_org_id and client_id=i.client_id and amount_satang>0 and reversal_of is null;
  for deposit in select * from public.invoices where org_id=p_org_id and source_quote_id=source and quote_invoice_kind='deposit' and status<>'cancelled' order by id for update loop
    if deposit.issued_snapshot_id is null then
      perform public.cancel_quote_invoice(p_org_id,deposit.id);
    else
      select jsonb_agg(jsonb_build_object('invoice_item_id',l.id,'amount_satang',l.amount_satang-coalesce(c.amount,0)) order by l.id) into lines
        from public.invoice_items l left join lateral(select sum(raw_satang) amount from public.credit_note_lines where org_id=p_org_id and invoice_item_id=l.id) c on true
        where l.org_id=p_org_id and l.invoice_id=deposit.id and l.amount_satang>coalesce(c.amount,0);
      if lines is not null then
        perform public.issue_credit_note(p_org_id,deposit.id,lines,'Deposit credited to final invoice '||(select number from public.invoices where org_id=p_org_id and id=i.id),md5(p_key::text||deposit.id::text)::uuid);
      end if;
    end if;
  end loop;
  for receipt in select id from public.payments where org_id=p_org_id and client_id=i.client_id and amount_satang>0 and reversal_of is null order by paid_at,id loop
    released:=coalesce(private.receipt_available_satang(p_org_id,receipt.id),0)-coalesce((previous->>receipt.id::text)::bigint,0);
    outstanding:=i.amount_satang-private.invoice_settled_satang(p_org_id,i.id);
    if released>0 and outstanding>0 then perform private.allocate_receipt(p_org_id,receipt.id,jsonb_build_array(jsonb_build_object('invoice_id',i.id,'amount_satang',least(released,outstanding))));end if;
  end loop;
  return target;
end;
$$;
revoke all on function public.issue_invoice(uuid,uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.issue_invoice(uuid,uuid,integer,uuid) to authenticated;
