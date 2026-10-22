-- Operational document arithmetic only, not a tax ledger, filing or e-Tax Invoice.
alter table public.org_settings
  add column vat_registered boolean not null default false,
  add column vat_rate_bps integer not null default 700 check(vat_rate_bps between 0 and 10000),
  add column prices_include_vat boolean not null default false,
  add column branch_label text check(length(branch_label)<=200);
alter table public.clients add column if not exists tax_id text;
alter table public.clients add column if not exists branch_label text check(length(branch_label)<=200);
alter table public.quote_items add column tax_rate_bps integer not null default 0 check(tax_rate_bps between 0 and 10000);
alter table public.invoice_items add column tax_rate_bps integer not null default 0 check(tax_rate_bps between 0 and 10000);
alter table public.quotes
  add column prices_include_vat boolean not null default false,
  add column vat_satang bigint not null default 0 check(vat_satang between 0 and 9007199254740991),
  add column tax_breakdown jsonb not null default '[]';
alter table public.invoices
  add column prices_include_vat boolean not null default false,
  add column wht_rate_bps integer not null default 0 check(wht_rate_bps in (0,100,200,300,500)),
  add column subtotal_satang bigint not null default 0 check(subtotal_satang between 0 and 9007199254740991),
  add column vat_satang bigint not null default 0 check(vat_satang between 0 and 9007199254740991),
  add column wht_satang bigint not null default 0 check(wht_satang between 0 and 9007199254740991),
  add column total_satang bigint not null default 0 check(total_satang between 0 and 9007199254740991),
  add column tax_breakdown jsonb not null default '[]';
-- Retain legacy zero-tax semantics and all issued JSON snapshots.
update public.invoices i set subtotal_satang=coalesce((select sum(amount_satang) from public.invoice_items l where l.org_id=i.org_id and l.invoice_id=i.id),i.amount_satang+i.discount_satang),total_satang=i.amount_satang;
comment on column public.invoices.amount_satang is 'Collectible amount due = total_satang - wht_satang. Payment guards, balances, overdue and portal readers use this column; revenue uses verified payments.';
comment on column public.invoices.total_satang is 'Gross document total including VAT before withholding. Immutable after issue.';
comment on column public.invoices.subtotal_satang is 'Sum of entered line amounts before discount, VAT-inclusive only when prices_include_vat.';

create function private.document_tax_totals(p_lines jsonb,p_discount bigint,p_inclusive boolean,p_wht integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare subtotal numeric;discount numeric;vat numeric:=0;base numeric:=0;tax numeric;net numeric;remaining integer;g record;parts jsonb:='[]';wht numeric;total numeric;
begin
  if p_discount is null or p_discount not between 0 and 9007199254740991 or p_wht is null or p_wht not in (0,100,200,300,500) or p_inclusive is null then raise exception 'Invalid tax inputs';end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l where (l->>'amount_satang')::numeric not between 0 and 9007199254740991 or (l->>'tax_rate_bps')::integer not between 0 and 10000) then raise exception 'Invalid tax line';end if;
  select coalesce(sum((l->>'amount_satang')::numeric),0) into subtotal from jsonb_array_elements(p_lines) l;
  if subtotal>9007199254740991 then raise exception 'Unsafe subtotal';end if;
  -- Drafts can carry a discount before lines are entered; issue validates it strictly.
  discount:=least(p_discount,subtotal);
  select (discount-coalesce(sum(floor(discount*amount/nullif(subtotal,0))),0))::integer into remaining
    from (select sum((l->>'amount_satang')::numeric) amount from jsonb_array_elements(p_lines) l group by (l->>'tax_rate_bps')::integer) buckets;
  for g in
    with buckets as (select (l->>'tax_rate_bps')::integer rate,sum((l->>'amount_satang')::numeric) amount from jsonb_array_elements(p_lines) l group by 1)
    select *,row_number() over(order by coalesce(mod(discount*amount,nullif(subtotal,0)),0) desc,rate) rank from buckets order by rate
  loop
    net:=g.amount-coalesce(floor(discount*g.amount/nullif(subtotal,0)),0)-case when g.rank<=remaining then 1 else 0 end;
    tax:=round(net*g.rate/(case when p_inclusive then 10000+g.rate else 10000 end));
    vat:=vat+tax;
    base:=base+net-case when p_inclusive then tax else 0 end;
    parts:=parts||jsonb_build_array(jsonb_build_object('rateBps',g.rate,'baseSatang',net-case when p_inclusive then tax else 0 end,'vatSatang',tax));
  end loop;
  total:=base+vat;wht:=round(base*p_wht/10000);
  if total>9007199254740991 then raise exception 'Unsafe total';end if;
  return jsonb_build_object('subtotalSatang',subtotal,'baseSatang',base,'vatSatang',vat,'totalSatang',total,'whtSatang',wht,'amountDueSatang',total-wht,'vatByRate',parts);
end;
$$;
revoke all on function private.document_tax_totals(jsonb,bigint,boolean,integer) from public;
grant execute on function private.document_tax_totals(jsonb,bigint,boolean,integer) to authenticated,service_role;

create function private.default_document_tax_mode()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if tg_table_name='invoices' then
      if new.source_quote_id is not null then
        select prices_include_vat into new.prices_include_vat from public.quotes where org_id=new.org_id and id=new.source_quote_id;
        return new;
      end if;
    end if;
    select coalesce((select prices_include_vat from public.org_settings where org_id=new.org_id),false) into new.prices_include_vat;
  elsif new.prices_include_vat<>old.prices_include_vat then raise exception 'Document price mode is frozen; create a new draft';end if;
  return new;
end;
$$;
create trigger a_default_tax_mode before insert or update on public.quotes for each row execute function private.default_document_tax_mode();
create trigger a_default_tax_mode before insert or update on public.invoices for each row execute function private.default_document_tax_mode();

create function public.update_tax_business_profile(p_org_id uuid,p_legal_name text,p_business_address text,p_tax_id text,p_vat_registered boolean,p_vat_rate_bps integer,p_prices_include_vat boolean,p_branch_label text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may edit business profile';end if;
  if p_vat_registered is null or p_vat_rate_bps is null or p_vat_rate_bps not between 0 and 10000 or p_prices_include_vat is null or length(p_branch_label)>200 then raise exception 'Invalid tax profile';end if;
  perform public.update_business_profile(p_org_id,p_legal_name,p_business_address,p_tax_id,case when p_vat_registered then 'registered' else 'not_registered' end);
  update public.org_settings set vat_registered=p_vat_registered,vat_rate_bps=p_vat_rate_bps,prices_include_vat=p_prices_include_vat,branch_label=nullif(btrim(p_branch_label),'') where org_id=p_org_id;
end;
$$;
revoke all on function public.update_tax_business_profile(uuid,text,text,text,boolean,integer,boolean,text) from public,anon,service_role;
grant execute on function public.update_tax_business_profile(uuid,text,text,text,boolean,integer,boolean,text) to authenticated;

create or replace function private.guard_quote_record()
returns trigger language plpgsql set search_path='' as $$
declare subtotal numeric; totals jsonb; project_client uuid;
begin
  if new.discount_satang not between 0 and 9007199254740991 then raise exception 'Invalid quote discount'; end if;
  if tg_op='INSERT' and new.status<>'draft' then raise exception 'New quote must start as draft'; end if;
  if tg_op='UPDATE' then
    if old.status in ('accepted','converted','declined','expired') and
      (new.client_id<>old.client_id or new.number<>old.number or new.discount_satang<>old.discount_satang
       or new.notes is distinct from old.notes or new.issue_date<>old.issue_date or new.valid_until is distinct from old.valid_until or new.prices_include_vat<>old.prices_include_vat) then
      raise exception 'Accepted or terminal agreement content is frozen'; end if;
    if new.status<>old.status and not (
      (old.status='draft' and new.status='sent') or
      (old.status='sent' and new.status in ('accepted','declined','expired')) or
      (old.status='accepted' and new.status='converted' and current_user='postgres')) then raise exception 'Invalid quote transition'; end if;
    if (new.converted_invoice_id is distinct from old.converted_invoice_id or
      (old.status in ('accepted','converted') and new.project_id is distinct from old.project_id)) and current_user<>'postgres' then
      raise exception 'Conversion links require the transaction command'; end if;
  end if;
  if new.project_id is not null then
    select client_id into project_client from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or project_client is distinct from new.client_id then raise exception 'Project and quote customer must match'; end if;
  end if;
  select coalesce(sum(amount_satang),0) into subtotal from public.quote_items where org_id=new.org_id and quote_id=new.id;
  if subtotal>9007199254740991 then raise exception 'Quote exceeds safe satang bounds'; end if;
  new.subtotal_satang:=subtotal::bigint;
  select private.document_tax_totals(coalesce(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),'[]'),new.discount_satang,new.prices_include_vat,0) into totals from public.quote_items where org_id=new.org_id and quote_id=new.id;
  new.total_satang:=(totals->>'totalSatang')::bigint;new.vat_satang:=(totals->>'vatSatang')::bigint;new.tax_breakdown:=totals->'vatByRate';
  if new.status in ('sent','accepted','converted') and (subtotal<=0 or new.discount_satang>subtotal) then raise exception 'Priced lines and valid discount required'; end if;
  if new.status='accepted' and new.valid_until is not null and new.valid_until<(now() at time zone 'Asia/Bangkok')::date then raise exception 'Quote expired'; end if;
  return new;
end;
$$;

create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;q public.quotes;subtotal numeric;line_count integer;totals jsonb;
begin
  if tg_op='UPDATE' and new.amount_satang<>old.amount_satang and (old.issued_snapshot_id is not null or (old.source_quote_id is not null and exists(select 1 from public.quotes where org_id=old.org_id and id=old.source_quote_id and status='converted'))) then raise exception 'Retained invoice amount cannot be overwritten';end if;
  if tg_op='UPDATE' and old.issued_snapshot_id is not null and
    (new.wht_rate_bps<>old.wht_rate_bps or new.subtotal_satang<>old.subtotal_satang or new.vat_satang<>old.vat_satang or new.total_satang<>old.total_satang or new.wht_satang<>old.wht_satang or new.tax_breakdown<>old.tax_breakdown) then raise exception 'Issued tax content is frozen';end if;
  if tg_op='UPDATE' and new.wht_rate_bps<>old.wht_rate_bps and (old.status<>'draft' or exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=old.org_id and invoice_id=old.id and status='pending')) then raise exception 'Payment evidence locks withholding';end if;
  if new.project_id is not null then
    select client_id into customer from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or customer is distinct from new.client_id then raise exception 'Invoice and project customer must match';end if;
  end if;
  select coalesce(sum(amount_satang),0),count(*) into subtotal,line_count from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
  if subtotal>9007199254740991 then raise exception 'Invoice exceeds safe satang bounds';end if;
  if line_count>0 then
    select private.document_tax_totals(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),new.discount_satang,new.prices_include_vat,new.wht_rate_bps) into totals from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
    new.subtotal_satang:=(totals->>'subtotalSatang')::bigint;new.vat_satang:=(totals->>'vatSatang')::bigint;new.total_satang:=(totals->>'totalSatang')::bigint;new.wht_satang:=(totals->>'whtSatang')::bigint;new.amount_satang:=(totals->>'amountDueSatang')::bigint;new.tax_breakdown:=totals->'vatByRate';
  elsif tg_op='INSERT' or (tg_op='UPDATE' and old.issued_snapshot_id is null) then
    new.subtotal_satang:=case when new.amount_satang=0 then 0 else new.amount_satang+new.discount_satang end;new.total_satang:=new.amount_satang;new.vat_satang:=0;new.wht_satang:=0;new.tax_breakdown:='[]';
    if new.wht_rate_bps<>0 and new.amount_satang>0 then raise exception 'WHT requires priced lines';end if;
  end if;
  if new.source_quote_id is not null then
    select * into q from public.quotes where org_id=new.org_id and id=new.source_quote_id;
    if not found or new.client_id<>q.client_id or new.project_id is distinct from q.project_id then
      -- During conversion the quote is linked only after its complete invoice exists.
      if q.status<>'accepted' then raise exception 'Source invoice customer/project binding is frozen';end if;
    end if;
    if q.status='converted' and (new.discount_satang<>q.discount_satang or new.total_satang<>q.total_satang or new.prices_include_vat<>q.prices_include_vat or new.client_id<>q.client_id or new.project_id is distinct from q.project_id) then raise exception 'Converted invoice must preserve accepted source terms';end if;
  end if;
  if new.source_milestone_id is not null and not exists(select 1 from public.milestones where org_id=new.org_id and id=new.source_milestone_id and project_id=new.project_id and source_quote_id is not distinct from new.source_quote_id) then raise exception 'Source milestone must match invoice agreement and project';end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
end;
$$;

create or replace function private.recompute_invoice_lines()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;
begin
  if tg_op='DELETE' then target:=old.invoice_id;tenant:=old.org_id;else target:=new.invoice_id;tenant:=new.org_id;end if;
  update public.invoices set amount_satang=case when exists(select 1 from public.invoice_items where org_id=tenant and invoice_id=target) then amount_satang else 0 end,updated_at=now() where org_id=tenant and id=target;
  return null;
end;
$$;

create or replace function private.guard_invoice_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;amount numeric;parent public.invoices;
begin
  if tg_op='DELETE' then target:=old.invoice_id;tenant:=old.org_id;else target:=new.invoice_id;tenant:=new.org_id;end if;
  if tg_op='UPDATE' and (new.invoice_id<>old.invoice_id or new.org_id<>old.org_id) then raise exception 'Line reassignment forbidden';end if;
  select * into parent from public.invoices where org_id=tenant and id=target for update;
  if not found then if tg_op='DELETE' then return old;end if;raise exception 'Invoice unavailable';end if;
  if parent.source_quote_id is not null and exists(select 1 from public.quotes where org_id=tenant and id=parent.source_quote_id and status='converted') then raise exception 'Converted source invoice lines are frozen';end if;
  if parent.issued_snapshot_id is not null or exists(select 1 from public.payments where org_id=tenant and invoice_id=target and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=tenant and invoice_id=target and status='pending') then raise exception 'Issued or payment evidence locks invoice lines';end if;
  if tg_op='DELETE' then return old;end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line amount';end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount not between 0 and 9007199254740991 then raise exception 'Line exceeds safe satang bounds';end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;

create or replace function public.issue_invoice(p_org_id uuid,p_invoice_id uuid,p_expected_version integer,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;profile public.org_settings;buyer public.clients;cmd public.invoice_issue_requests;target uuid;lines jsonb;subtotal numeric;totals jsonb;counter bigint;yr integer;num text;doc jsonb;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may issue invoices';end if;
  if p_key is null or p_expected_version is null or p_expected_version<1 then raise exception 'Invalid issue command';end if;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if not found then raise exception 'Invoice unavailable';end if;
  insert into public.invoice_issue_requests(org_id,key,invoice_id,source_version) values(p_org_id,p_key,i.id,p_expected_version) on conflict do nothing;
  select * into cmd from public.invoice_issue_requests where org_id=p_org_id and key=p_key for update;
  if cmd.invoice_id<>i.id or cmd.source_version<>p_expected_version then raise exception 'Idempotency conflict';end if;
  if cmd.snapshot_id is not null then return cmd.snapshot_id;end if;
  if i.issued_snapshot_id is not null then
    if (select source_version from public.invoice_snapshots where org_id=p_org_id and id=i.issued_snapshot_id)<>p_expected_version then raise exception 'Stale invoice version';end if;
    update public.invoice_issue_requests set snapshot_id=i.issued_snapshot_id where org_id=p_org_id and key=p_key;return i.issued_snapshot_id;
  end if;
  if i.status<>'draft' or i.version<>p_expected_version then raise exception 'Draft at expected version required';end if;
  select * into profile from public.org_settings where org_id=p_org_id for share;
  if not found or profile.legal_name is null or length(btrim(profile.legal_name)) not between 1 and 200 or profile.business_address is null or length(btrim(profile.business_address)) not between 1 and 1000
    or (profile.vat_registered and profile.tax_id is null) then raise exception 'Complete seller profile required';end if;
  select * into buyer from public.clients where org_id=p_org_id and id=i.client_id for share;
  if not found or length(btrim(buyer.name))<1 then raise exception 'Buyer required';end if;
  select coalesce(sum(amount_satang),0),jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unitPriceSatang',unit_price_satang,'amountSatang',amount_satang,'position',position,'taxRateBps',tax_rate_bps) order by position,id) into subtotal,lines from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  select private.document_tax_totals(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),i.discount_satang,i.prices_include_vat,i.wht_rate_bps) into totals from public.invoice_items where org_id=p_org_id and invoice_id=i.id;
  if lines is null or subtotal>9007199254740991 or i.discount_satang>subtotal or i.amount_satang<=0 or i.amount_satang<>(totals->>'amountDueSatang')::bigint then raise exception 'Valid complete priced lines required';end if;
  yr:=extract(year from i.issue_date);
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'INV',yr,1) on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='INV-'||yr::text||'-'||lpad(counter::text,6,'0');
    exit when not exists(select 1 from public.invoices where org_id=p_org_id and number=num and id<>i.id);
  end loop;
  doc:=jsonb_build_object('version',1,'kind','operational_invoice','seller',jsonb_build_object('legalName',profile.legal_name,'address',profile.business_address,'taxId',profile.tax_id,'taxStatus',profile.tax_status,'vatRegistered',profile.vat_registered,'branchLabel',profile.branch_label),
    'buyer',jsonb_build_object('id',buyer.id,'name',buyer.name,'address',buyer.billing_address,'taxId',buyer.tax_id,'branchLabel',buyer.branch_label),
    'document',jsonb_build_object('number',num,'issueDate',i.issue_date,'dueDate',i.due_date,'notes',i.notes,'subtotalSatang',subtotal,'discountSatang',i.discount_satang,'totalSatang',i.total_satang,'vatSatang',i.vat_satang,'whtSatang',i.wht_satang,'whtRateBps',i.wht_rate_bps,'amountDueSatang',i.amount_satang,'pricesIncludeVat',i.prices_include_vat,'vatByRate',i.tax_breakdown),'lines',lines);
  insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by) values(p_org_id,i.id,i.version,num,doc,auth.uid()) returning id into target;
  update public.invoices set number=num,status='sent',issued_snapshot_id=target where org_id=p_org_id and id=i.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta) values(p_org_id,auth.uid(),'invoice',i.id,'invoice_issued','Issued frozen operational invoice',jsonb_build_object('snapshotId',target,'sourceVersion',i.version,'number',num));
  update public.invoice_issue_requests set snapshot_id=target where org_id=p_org_id and key=p_key;
  return target;
end;
$$;

create or replace function public.convert_accepted_quote(p_org_id uuid,p_quote_id uuid,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.quotes;request public.quote_conversion_requests;project uuid;milestone uuid;invoice uuid;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may convert quotes';end if;
  if p_key is null then raise exception 'Command key required';end if;
  insert into public.quote_conversion_requests(org_id,key,quote_id) values(p_org_id,p_key,p_quote_id) on conflict do nothing;
  select * into request from public.quote_conversion_requests where org_id=p_org_id and key=p_key for update;
  if request.quote_id<>p_quote_id then raise exception 'Idempotency conflict';end if;
  if request.invoice_id is not null then return request.invoice_id;end if;
  select * into q from public.quotes where org_id=p_org_id and id=p_quote_id for no key update;
  if not found then raise exception 'Quote unavailable';end if;
  if q.status='converted' and q.converted_invoice_id is not null then
    update public.quote_conversion_requests set invoice_id=q.converted_invoice_id where org_id=p_org_id and key=p_key;
    return q.converted_invoice_id;
  end if;
  if q.status<>'accepted' or (q.valid_until is not null and q.valid_until<today) then raise exception 'Accepted nonexpired quote required';end if;
  if q.total_satang<=0 or q.discount_satang>q.subtotal_satang then raise exception 'Billable quote required';end if;
  project:=q.project_id;
  if project is not null and not exists(select 1 from public.projects where org_id=p_org_id and id=project and client_id=q.client_id) then raise exception 'Project customer mismatch';end if;
  if project is null then
    insert into public.projects(org_id,client_id,name,budget_satang,source_quote_id) values(p_org_id,q.client_id,'Service '||q.number,q.total_satang,q.id) returning id into project;
  end if;
  insert into public.milestones(org_id,project_id,title,source_quote_id) values(p_org_id,project,'Delivery '||q.number,q.id) returning id into milestone;
  insert into public.invoices(org_id,client_id,project_id,number,status,amount_satang,discount_satang,source_quote_id,source_milestone_id,issue_date,notes)
    values(p_org_id,q.client_id,project,'INV-'||q.number,'draft',0,q.discount_satang,q.id,milestone,today,'From accepted quote '||q.number) returning id into invoice;
  insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,amount_satang,position,tax_rate_bps)
    select p_org_id,invoice,product_id,description,quantity,unit,unit_price_satang,amount_satang,position,tax_rate_bps from public.quote_items where org_id=p_org_id and quote_id=q.id order by position,id;
  if (select total_satang from public.invoices where id=invoice and org_id=p_org_id)<>q.total_satang then raise exception 'Conversion totals disagree';end if;
  update public.quotes set status='converted',project_id=project,converted_invoice_id=invoice where id=q.id and org_id=p_org_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Accepted service quote converted atomically',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;
