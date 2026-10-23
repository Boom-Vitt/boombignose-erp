create or replace function public.issue_credit_note(p_org_id uuid,p_invoice_id uuid,p_lines jsonb,p_reason text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;l public.invoice_items;line_input jsonb;raw numeric;used numeric;qty numeric;chosen jsonb:='[]';lines jsonb:='[]';
  source uuid;legacy boolean;limit_raw numeric;
  cmd public.payment_command_results;req jsonb;target uuid;totals jsonb;original jsonb;counter bigint;num text;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue credit notes';end if;
  if p_key is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000
    or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invalid credit note';end if;
  select source_quote_id into source from public.invoices where org_id=p_org_id and id=p_invoice_id;
  if source is not null then perform 1 from public.quotes where org_id=p_org_id and id=source for no key update;end if;
  perform private.lock_finance_customer(p_org_id,p_invoice_id);
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for update;
  if not found then raise exception 'Invoice unavailable';end if;
  req:=jsonb_build_object('operation','credit_note','invoice',i.id,'lines',p_lines,'reason',btrim(p_reason));
  insert into public.payment_command_results(org_id,key,request) values(p_org_id,p_key,req) on conflict do nothing;
  select * into cmd from public.payment_command_results where org_id=p_org_id and key=p_key for update;
  if cmd.request<>req then raise exception 'Idempotency conflict';end if;
  if cmd.result is not null then return cmd.result;end if;
  if i.issued_snapshot_id is null or i.status in ('draft','cancelled') then raise exception 'Issued invoice required';end if;
  if i.quote_invoice_kind='deposit' and exists(select 1 from public.invoices where org_id=p_org_id and source_quote_id=i.source_quote_id and quote_invoice_kind='lines' and status<>'cancelled' and issued_snapshot_id is null and quote_deposit_deduction_satang>0) then raise exception 'Deposit is reserved by a final invoice; cancel the final draft or correct the final invoice';end if;
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
