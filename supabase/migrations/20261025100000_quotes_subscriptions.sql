begin;

alter table public.quotes
  add column accepted_at timestamptz,
  add column accepted_by_name text check(length(accepted_by_name)<=200),
  add column accepted_by_email text check(length(accepted_by_email)<=320);
alter table public.quote_items add column invoiced_quantity numeric(12,3) not null default 0
  check(invoiced_quantity between 0 and quantity);
alter table public.invoice_items
  add column quote_item_id uuid,
  add column wht_rate_bps integer not null default 0 check(wht_rate_bps in (0,100,200,300,500)),
  add constraint invoice_items_quote_item_tenant foreign key(org_id,quote_item_id) references public.quote_items(org_id,id);
alter table public.invoices
  add column quote_invoice_kind text not null default 'lines' check(quote_invoice_kind in ('lines','deposit')),
  add column quote_invoice_sealed boolean not null default false,
  add column quote_deposit_satang bigint not null default 0 check(quote_deposit_satang between 0 and 9007199254740991),
  add column quote_deposit_deduction_satang bigint not null default 0 check(quote_deposit_deduction_satang between 0 and 9007199254740991),
  add column quote_discount_satang bigint not null default 0 check(quote_discount_satang between 0 and 9007199254740991);
alter table public.quote_conversion_requests add column request_payload jsonb;
drop index public.invoices_one_source_quote;
create index invoices_source_quote on public.invoices(org_id,source_quote_id) where source_quote_id is not null;
create index invoice_items_quote_item on public.invoice_items(org_id,quote_item_id) where quote_item_id is not null;

-- Legacy source invoices already reserve their complete accepted scope.
alter table public.quote_items disable trigger guard_quote_line;
alter table public.quote_items disable trigger recompute_quote_lines;
alter table public.invoice_items disable trigger guard_invoice_line;
alter table public.invoice_items disable trigger recompute_invoice_lines;
with ranked as (
  select id,row_number() over(partition by org_id,quote_id order by position,created_at,id)-1 pos
  from public.quote_items
) update public.quote_items l set position=r.pos from ranked r where l.id=r.id and l.position<>r.pos;
with ranked as (
  select id,row_number() over(partition by org_id,invoice_id order by position,created_at,id)-1 pos
  from public.invoice_items
) update public.invoice_items l set position=r.pos from ranked r where l.id=r.id and l.position<>r.pos;
with quoted as (
  select q.*,row_number() over(partition by org_id,quote_id,description,quantity,unit_price_satang,product_id,unit,tax_rate_bps order by position,created_at,id) occurrence
    from public.quote_items q
),billed as (
  select l.*,i.source_quote_id,row_number() over(partition by l.org_id,l.invoice_id,l.description,l.quantity,l.unit_price_satang,l.product_id,l.unit,l.tax_rate_bps order by l.position,l.created_at,l.id) occurrence
    from public.invoice_items l join public.invoices i on i.org_id=l.org_id and i.id=l.invoice_id where i.source_quote_id is not null
)
update public.invoice_items l set quote_item_id=q.id from billed b,quoted q where l.id=b.id and q.org_id=b.org_id and q.quote_id=b.source_quote_id
  and q.description=b.description and q.quantity=b.quantity and q.unit_price_satang=b.unit_price_satang
  and q.product_id is not distinct from b.product_id and q.unit is not distinct from b.unit and q.tax_rate_bps=b.tax_rate_bps and q.occurrence=b.occurrence;
update public.quote_items q set invoiced_quantity=coalesce((
  select sum(l.quantity) from public.invoice_items l join public.invoices i on i.org_id=l.org_id and i.id=l.invoice_id
  where l.org_id=q.org_id and l.quote_item_id=q.id and i.status<>'cancelled'
),0);
update public.invoices set quote_invoice_sealed=true,quote_discount_satang=discount_satang where source_quote_id is not null;
alter table public.quote_items enable trigger guard_quote_line;
alter table public.quote_items enable trigger recompute_quote_lines;
alter table public.invoice_items enable trigger guard_invoice_line;
alter table public.invoice_items enable trigger recompute_invoice_lines;

insert into public.document_counters(org_id,kind,year,value)
  select org_id,'QUO',substring(number from '^QUO-([0-9]{4})-')::integer,max(substring(number from '-([0-9]{1,15})$')::bigint)
    from public.quotes where number ~ '^QUO-[0-9]{4}-[0-9]{1,15}$' group by org_id,substring(number from '^QUO-([0-9]{4})-')::integer
  on conflict(org_id,kind,year) do update set value=greatest(document_counters.value,excluded.value);

create function public.reserve_document_number(p_org_id uuid,p_kind text,p_year integer)
returns text language plpgsql security definer set search_path='' as $$
declare counter bigint;num text;
begin
  if not private.is_org_member(p_org_id) then raise exception 'Organization membership required';end if;
  if p_kind is distinct from 'quote' or p_year is null or p_year not between 2000 and 9999 then raise exception 'Invalid quote counter';end if;
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'QUO',p_year,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='QUO-'||p_year::text||'-'||lpad(counter::text,greatest(3,length(counter::text)),'0');
    exit when not exists(select 1 from public.quotes where org_id=p_org_id and number=num);
  end loop;
  return num;
end;
$$;
revoke all on function public.reserve_document_number(uuid,text,integer) from public,anon,service_role;
grant execute on function public.reserve_document_number(uuid,text,integer) to authenticated;

create function private.guard_quote_invoicing_fields()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','service_role') and
    ((tg_op='INSERT' and new.invoiced_quantity<>0) or (tg_op='UPDATE' and new.invoiced_quantity<>old.invoiced_quantity)) then
    raise exception 'Invoiced quantity requires the conversion command';
  end if;
  return new;
end;
$$;
create trigger guard_quote_invoicing_fields before insert or update on public.quote_items
  for each row execute function private.guard_quote_invoicing_fields();

create function private.append_document_line_position()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='quote_items' then
    perform 1 from public.quotes where org_id=new.org_id and id=new.quote_id for no key update;
    select coalesce(max(position)+1,0) into new.position from public.quote_items where org_id=new.org_id and quote_id=new.quote_id;
  else
    perform 1 from public.invoices where org_id=new.org_id and id=new.invoice_id for no key update;
    select coalesce(max(position)+1,0) into new.position from public.invoice_items where org_id=new.org_id and invoice_id=new.invoice_id;
  end if;
  return new;
end;
$$;
create trigger append_document_line_position before insert on public.quote_items for each row execute function private.append_document_line_position();
create trigger append_document_line_position before insert on public.invoice_items for each row execute function private.append_document_line_position();

create function public.accept_portal_quote(p_token text,p_quote_id uuid,p_name text,p_email text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.clients;q public.quotes;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 200 or p_email is null or length(p_email)>320
    or btrim(p_email)!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Accepting name and email required';end if;
  select * into c from public.clients where portal_token=p_token and portal_enabled for share;
  if not found then raise exception 'Quote unavailable';end if;
  select * into q from public.quotes where org_id=c.org_id and client_id=c.id and id=p_quote_id for no key update;
  if not found or q.status<>'sent' then raise exception 'Quote unavailable';end if;
  update public.quotes set status='accepted',accepted_by_name=btrim(p_name),accepted_by_email=lower(btrim(p_email)) where org_id=c.org_id and id=q.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(c.org_id,null,'quote',q.id,'quote_accepted','Customer accepted quote through portal',
      jsonb_build_object('name',btrim(p_name),'email',lower(btrim(p_email)),'acceptedAt',now()));
  return q.id;
end;
$$;
revoke all on function public.accept_portal_quote(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.accept_portal_quote(text,uuid,text,text) to service_role;

alter table public.org_settings add column wht_rate_bps integer not null default 0 check(wht_rate_bps in (0,100,200,300,500));
alter table public.products add column wht_rate_bps integer check(wht_rate_bps in (0,100,200,300,500));
alter table public.subscriptions
  add column tax_rate_bps integer not null default 0 check(tax_rate_bps between 0 and 10000),
  add column wht_rate_bps integer not null default 0 check(wht_rate_bps in (0,100,200,300,500)),
  add column prices_include_vat boolean not null default false,
  add column product_id uuid,
  add column unit text check(unit is null or length(btrim(unit)) between 1 and 40),
  add constraint subscriptions_product_tenant foreign key(org_id,product_id) references public.products(org_id,id);
update public.subscriptions s set tax_rate_bps=case when o.vat_registered then o.vat_rate_bps else 0 end,
  wht_rate_bps=o.wht_rate_bps,prices_include_vat=o.prices_include_vat from public.org_settings o where o.org_id=s.org_id;
update public.subscriptions set unit='period' where unit is null;

create function private.default_subscription_tax()
returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.org_settings;product public.products;
begin
  select * into settings from public.org_settings where org_id=new.org_id;
  if new.product_id is not null then
    select * into product from public.products where org_id=new.org_id and id=new.product_id and active;
    if not found then raise exception 'Product unavailable';end if;
  end if;
  new.tax_rate_bps:=coalesce(new.tax_rate_bps,product.tax_rate_bps,case when settings.vat_registered then settings.vat_rate_bps else 0 end,0);
  new.wht_rate_bps:=coalesce(new.wht_rate_bps,product.wht_rate_bps,settings.wht_rate_bps,0);
  new.prices_include_vat:=coalesce(new.prices_include_vat,settings.prices_include_vat,false);
  return new;
end;
$$;
alter table public.subscriptions alter column tax_rate_bps drop default,alter column wht_rate_bps drop default,alter column prices_include_vat drop default;
create trigger default_subscription_tax before insert on public.subscriptions for each row execute function private.default_subscription_tax();

alter table public.invoices add column source_subscription_id uuid,
  add constraint invoices_subscription_tenant foreign key(org_id,source_subscription_id) references public.subscriptions(org_id,id);
create function private.subscription_invoice_tax_mode()
returns trigger language plpgsql set search_path='' as $$
declare s public.subscriptions;
begin
  if tg_op='UPDATE' then
    if new.source_subscription_id is distinct from old.source_subscription_id then raise exception 'Subscription source is immutable';end if;
  elsif new.source_subscription_id is not null then
    if current_user in ('authenticated','service_role') then raise exception 'Subscription source requires the occurrence command';end if;
    select * into s from public.subscriptions where org_id=new.org_id and id=new.source_subscription_id;
    if not found or new.client_id<>s.client_id or new.project_id is distinct from s.project_id then raise exception 'Subscription source customer mismatch';end if;
    new.prices_include_vat:=s.prices_include_vat;
  end if;
  return new;
end;
$$;
create trigger b_subscription_tax_mode before insert or update on public.invoices for each row execute function private.subscription_invoice_tax_mode();

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
      (old.status in ('accepted','converted') and new.status in ('accepted','converted') and current_user='postgres')) then raise exception 'Invalid quote transition'; end if;
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
  if tg_op='INSERT' then
    if new.accepted_at is not null or new.accepted_by_name is not null or new.accepted_by_email is not null then raise exception 'Acceptance requires a sent quote';end if;
  elsif old.status='sent' and new.status='accepted' then
    if current_user in ('authenticated','service_role') and not private.is_org_staff(new.org_id) then raise exception 'Only staff may accept quotes';end if;
    if new.valid_until is not null and new.valid_until<(now() at time zone 'Asia/Bangkok')::date then raise exception 'Quote expired';end if;
    new.accepted_at:=now();
  elsif new.accepted_at is distinct from old.accepted_at or new.accepted_by_name is distinct from old.accepted_by_name
    or new.accepted_by_email is distinct from old.accepted_by_email then raise exception 'Acceptance evidence is immutable';
  end if;
  return new;
end;
$$;

create or replace function private.guard_quote_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare q public.quotes; target uuid; tenant uuid; amount numeric;
begin
  if tg_op='DELETE' then target:=old.quote_id;tenant:=old.org_id;else target:=new.quote_id;tenant:=new.org_id;end if;
  select * into q from public.quotes where org_id=tenant and id=target for no key update;
  if not found then if tg_op='DELETE' then return old;end if;raise exception 'Quote unavailable';end if;
  if tg_op='UPDATE' and (to_jsonb(new)-'invoiced_quantity'-'updated_at')=(to_jsonb(old)-'invoiced_quantity'-'updated_at') and new.invoiced_quantity<>old.invoiced_quantity then return new;end if;
  if q.status not in ('draft','sent') then raise exception 'Agreement lines are frozen'; end if;
  if tg_op='DELETE' then return old;end if;
  if tg_op='UPDATE' and new.quote_id<>old.quote_id then raise exception 'Line reassignment forbidden';end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line';end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount>9007199254740991 then raise exception 'Unsafe line amount';end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;

create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;q public.quotes;subtotal numeric;line_count integer;totals jsonb;
begin
  if tg_op='UPDATE' and new.amount_satang<>old.amount_satang and (old.issued_snapshot_id is not null or (old.source_quote_id is not null and old.quote_invoice_sealed)) then raise exception 'Retained invoice amount cannot be overwritten';end if;
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
    if not found or new.client_id<>q.client_id or new.project_id is distinct from q.project_id or new.prices_include_vat<>q.prices_include_vat then
      raise exception 'Source invoice customer/project binding is frozen';end if;
    if tg_op='UPDATE' and old.quote_invoice_sealed and
      (new.discount_satang<>old.discount_satang or new.total_satang<>old.total_satang or new.prices_include_vat<>old.prices_include_vat) then
      raise exception 'Converted invoice must preserve accepted source terms';end if;
  end if;
  if new.source_milestone_id is not null and not exists(select 1 from public.milestones where org_id=new.org_id and id=new.source_milestone_id and project_id=new.project_id and source_quote_id is not distinct from new.source_quote_id) then raise exception 'Source milestone must match invoice agreement and project';end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
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
  if parent.source_quote_id is not null and parent.quote_invoice_sealed then raise exception 'Converted source invoice lines are frozen';end if;
  if parent.issued_snapshot_id is not null or exists(select 1 from public.payments where org_id=tenant and invoice_id=target and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=tenant and invoice_id=target and status='pending') then raise exception 'Issued or payment evidence locks invoice lines';end if;
  if tg_op='DELETE' then return old;end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line amount';end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount not between 0 and 9007199254740991 then raise exception 'Line exceeds safe satang bounds';end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;

create function private.guard_quote_invoice_command()
returns trigger language plpgsql set search_path='' as $$
declare target uuid;tenant uuid;
begin
  if tg_op='DELETE' then
    if old.source_quote_id is not null and exists(select 1 from public.organizations where id=old.org_id) then raise exception 'Cancel the source invoice to release quote quantities';end if;
    return old;
  end if;
  if current_user in ('authenticated','service_role') and (
    (tg_op='INSERT' and (new.quote_invoice_sealed or new.quote_deposit_satang<>0 or new.quote_deposit_deduction_satang<>0 or new.quote_discount_satang<>0 or new.quote_invoice_kind<>'lines')) or
    (tg_op='UPDATE' and (new.quote_invoice_sealed<>old.quote_invoice_sealed or new.quote_invoice_kind<>old.quote_invoice_kind
      or new.quote_deposit_satang<>old.quote_deposit_satang or new.quote_deposit_deduction_satang<>old.quote_deposit_deduction_satang or new.quote_discount_satang<>old.quote_discount_satang))
  ) then raise exception 'Quote billing fields require the conversion command';end if;
  if tg_op='UPDATE' and old.source_quote_id is not null then
    if old.status='cancelled' and new.status<>'cancelled' then raise exception 'Cancelled quote invoice cannot be reopened';end if;
    if new.status='cancelled' and old.status<>'cancelled' then
      if current_user in ('authenticated','service_role') then raise exception 'Use the quote invoice cancellation command';end if;
      target:=old.source_quote_id;tenant:=old.org_id;
      perform 1 from public.quotes where org_id=tenant and id=target for no key update;
      if old.quote_invoice_kind='deposit' and exists(select 1 from public.invoices where org_id=tenant and source_quote_id=target
        and status<>'cancelled' and quote_invoice_sealed and quote_deposit_deduction_satang>0) then
        raise exception 'Cancel the final draft invoice before its deposit';end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_quote_invoice_command before insert or update or delete on public.invoices for each row execute function private.guard_quote_invoice_command();

create function private.release_quote_invoice_quantities()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.source_quote_id is null or new.status<>'cancelled' or old.status='cancelled' or old.issued_snapshot_id is not null then return null;end if;
  perform 1 from public.quotes where org_id=old.org_id and id=old.source_quote_id for no key update;
  with reserved as (
    select q.id,coalesce((select sum(l.quantity) from public.invoice_items l join public.invoices i on i.org_id=l.org_id and i.id=l.invoice_id
      where l.org_id=q.org_id and l.quote_item_id=q.id and i.status<>'cancelled' and i.quote_invoice_sealed),0) qty
    from public.quote_items q where q.org_id=old.org_id and q.quote_id=old.source_quote_id
  ) update public.quote_items q set invoiced_quantity=r.qty from reserved r where q.id=r.id and q.invoiced_quantity<>r.qty;
  update public.quotes set status=case when exists(select 1 from public.invoices where org_id=old.org_id and source_quote_id=old.source_quote_id and status<>'cancelled') then 'converted'::public.quote_status else 'accepted'::public.quote_status end,
    converted_invoice_id=(select id from public.invoices where org_id=old.org_id and source_quote_id=old.source_quote_id and status<>'cancelled' order by created_at desc,id desc limit 1)
    where org_id=old.org_id and id=old.source_quote_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(old.org_id,auth.uid(),'quote',old.source_quote_id,'invoice_cancelled','Cancelled draft released quote quantities',jsonb_build_object('invoiceId',old.id));
  return null;
end;
$$;
create trigger release_quote_invoice_quantities after update of status on public.invoices for each row execute function private.release_quote_invoice_quantities();

create function public.cancel_quote_invoice(p_org_id uuid,p_invoice_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare i public.invoices;source uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may cancel quote invoices';end if;
  select source_quote_id into source from public.invoices where org_id=p_org_id and id=p_invoice_id;
  if source is null then raise exception 'Quote invoice unavailable';end if;
  perform 1 from public.quotes where org_id=p_org_id and id=source for no key update;
  select * into i from public.invoices where org_id=p_org_id and id=p_invoice_id for no key update;
  if i.status='cancelled' then return;end if;
  if i.status<>'draft' or i.issued_snapshot_id is not null then raise exception 'Only draft quote invoices can be cancelled';end if;
  update public.invoices set status='cancelled' where org_id=p_org_id and id=i.id;
end;
$$;
revoke all on function public.cancel_quote_invoice(uuid,uuid) from public,anon,service_role;
grant execute on function public.cancel_quote_invoice(uuid,uuid) to authenticated;

create function private.guard_invoice_quote_item()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','service_role') and ((tg_op='INSERT' and new.quote_item_id is not null)
    or (tg_op='UPDATE' and new.quote_item_id is distinct from old.quote_item_id)) then raise exception 'Quote line source requires the conversion command';end if;
  if new.quote_item_id is not null and not exists(select 1 from public.quote_items q join public.invoices i on i.org_id=q.org_id and i.source_quote_id=q.quote_id
    where q.org_id=new.org_id and q.id=new.quote_item_id and i.id=new.invoice_id) then raise exception 'Invoice and quote line source must match';end if;
  return new;
end;
$$;
create trigger guard_invoice_quote_item before insert or update on public.invoice_items for each row execute function private.guard_invoice_quote_item();

create function private.guard_quote_audit_event()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','service_role') and new.action in ('quote_accepted','subscription_schedule_changed','invoice_cancelled') then
    raise exception 'Reserved audit action requires its command';end if;
  return new;
end;
$$;
create trigger guard_quote_audit_event before insert on public.audit_log for each row execute function private.guard_quote_audit_event();

drop function public.convert_accepted_quote(uuid,uuid,uuid);
create function public.convert_accepted_quote(p_org_id uuid,p_quote_id uuid,p_key uuid,p_lines jsonb default null,p_deposit_satang bigint default null,p_deposit_bps integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.quotes;request public.quote_conversion_requests;project uuid;milestone uuid;invoice uuid;item record;
  payload jsonb;chosen jsonb;qty numeric;raw_amount numeric:=0;previous_raw numeric;previous_discount numeric;discount bigint;
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
  select coalesce(sum(quote_deposit_satang-quote_deposit_deduction_satang),0),coalesce(sum(quote_discount_satang),0)
    into deposits,previous_discount from public.invoices where org_id=p_org_id and source_quote_id=q.id and status<>'cancelled' and quote_invoice_sealed;
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
    if (select count(distinct tax_rate_bps) from public.quote_items where org_id=p_org_id and quote_id=q.id)>1 then raise exception 'Deposits require one tax rate';end if;
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
    insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps)
      values(p_org_id,invoice,'Deposit for '||q.number,1,deposit,rate);
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
    update public.invoices set discount_satang=discount+deposit_deduction,
      quote_discount_satang=discount,quote_deposit_deduction_satang=deposit_deduction where org_id=p_org_id and id=invoice;
  end if;
  update public.invoices set quote_invoice_sealed=true where org_id=p_org_id and id=invoice;
  update public.quotes set status='converted',converted_invoice_id=invoice where org_id=p_org_id and id=q.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Created invoice from accepted quote',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key,'scope',payload));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;
revoke all on function public.convert_accepted_quote(uuid,uuid,uuid,jsonb,bigint,integer) from public,anon,service_role;
grant execute on function public.convert_accepted_quote(uuid,uuid,uuid,jsonb,bigint,integer) to authenticated;

create or replace function private.guard_subscription_schedule()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.organizations where id=old.org_id) and exists(select 1 from public.subscription_occurrences where org_id=old.org_id and subscription_id=old.id) then
      raise exception 'Billed subscription must be retained';end if;
    return old;
  end if;
  if exists(select 1 from public.subscription_occurrences where org_id=old.org_id and subscription_id=old.id)
    and (new.start_date<>old.start_date or new.interval<>old.interval or new.client_id<>old.client_id or new.project_id is distinct from old.project_id) then
    raise exception 'Billed subscription scope and cadence require a new agreement';end if;
  if current_user in ('authenticated','service_role') and
    (new.start_date<>old.start_date or new.interval<>old.interval or new.status<>old.status or new.next_run_date<>old.next_run_date or new.last_generated_on is distinct from old.last_generated_on) then
    raise exception 'Schedule changes require the subscription command';end if;
  return new;
end;
$$;

create function public.update_subscription_schedule(p_org_id uuid,p_subscription_id uuid,p_start_date date default null,p_status public.subscription_status default null,p_bill_missed_periods boolean default false,p_changes jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare s public.subscriptions;next_date date;anchor date;cadence public.recurring_interval;desired_status public.subscription_status;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may manage subscriptions';end if;
  if p_bill_missed_periods is null or p_changes is null or jsonb_typeof(p_changes)<>'object' or exists(select 1 from jsonb_object_keys(p_changes) k
    where k not in ('name','client_id','project_id','amount_satang','interval','notes','product_id','unit','tax_rate_bps','wht_rate_bps','prices_include_vat')) then raise exception 'Invalid subscription changes';end if;
  if p_start_date is not null and not isfinite(p_start_date) then raise exception 'Invalid start date';end if;
  if p_changes ? 'name' and (p_changes->>'name' is null or length(btrim(p_changes->>'name')) not between 1 and 200) then raise exception 'Invalid subscription name';end if;
  select * into s from public.subscriptions where org_id=p_org_id and id=p_subscription_id for no key update;
  if not found then raise exception 'Subscription unavailable';end if;
  anchor:=coalesce(p_start_date,s.start_date);cadence:=coalesce((p_changes->>'interval')::public.recurring_interval,s.interval);desired_status:=coalesce(p_status,s.status);
  next_date:=s.next_run_date;
  if anchor<>s.start_date or cadence<>s.interval then
    if exists(select 1 from public.subscription_occurrences where org_id=p_org_id and subscription_id=s.id) then raise exception 'Billed subscription scope and cadence require a new agreement';end if;
    next_date:=anchor;
  end if;
  if s.status in ('paused','cancelled') and desired_status='active' and not p_bill_missed_periods then
    while next_date<today loop next_date:=private.next_subscription_date(anchor,next_date,cadence);end loop;
  end if;
  if p_changes->>'product_id' is not null and not exists(select 1 from public.products where org_id=p_org_id and id=(p_changes->>'product_id')::uuid and active) then raise exception 'Product unavailable';end if;
  update public.subscriptions set start_date=anchor,interval=cadence,status=desired_status,next_run_date=next_date,
    client_id=coalesce((p_changes->>'client_id')::uuid,s.client_id),
    project_id=case when p_changes ? 'project_id' then (p_changes->>'project_id')::uuid else s.project_id end,
    name=coalesce(btrim(p_changes->>'name'),s.name),amount_satang=coalesce((p_changes->>'amount_satang')::bigint,s.amount_satang),
    notes=case when p_changes ? 'notes' then p_changes->>'notes' else s.notes end,
    product_id=case when p_changes ? 'product_id' then (p_changes->>'product_id')::uuid else s.product_id end,
    unit=case when p_changes ? 'unit' then p_changes->>'unit' else s.unit end,
    tax_rate_bps=coalesce((p_changes->>'tax_rate_bps')::integer,s.tax_rate_bps),
    wht_rate_bps=coalesce((p_changes->>'wht_rate_bps')::integer,s.wht_rate_bps),
    prices_include_vat=coalesce((p_changes->>'prices_include_vat')::boolean,s.prices_include_vat)
    where org_id=p_org_id and id=s.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'subscription',s.id,'subscription_schedule_changed','Updated recurring agreement schedule',
      jsonb_build_object('startDate',anchor,'nextRunDate',next_date,'status',desired_status,'billMissedPeriods',p_bill_missed_periods));
end;
$$;
revoke all on function public.update_subscription_schedule(uuid,uuid,date,public.subscription_status,boolean,jsonb) from public,anon,service_role;
grant execute on function public.update_subscription_schedule(uuid,uuid,date,public.subscription_status,boolean,jsonb) to authenticated;

create or replace function public.generate_subscription_occurrence(p_org_id uuid,p_subscription_id uuid,p_occurrence date)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; target uuid; next_date date; months integer; wanted date; day_max integer; actor uuid:=auth.uid();
begin
  if coalesce(auth.role(),'')<>'service_role' and not private.is_org_staff(p_org_id) then raise exception 'Only staff may bill subscriptions'; end if;
  if p_occurrence is null then raise exception 'Scheduled occurrence required'; end if;
  -- NO KEY UPDATE permits concurrent FK checks; all occurrence commands serialize.
  select * into s from public.subscriptions where org_id=p_org_id and id=p_subscription_id for no key update;
  if not found then raise exception 'Subscription unavailable'; end if;
  select invoice_id into target from public.subscription_occurrences where org_id=p_org_id and subscription_id=s.id and occurrence_date=p_occurrence;
  if found then return target; end if;
  if s.status<>'active' or p_occurrence<>s.next_run_date or p_occurrence<s.start_date
    or p_occurrence>(now() at time zone 'Asia/Bangkok')::date or s.amount_satang not between 1 and 9007199254740991 then raise exception 'Invalid scheduled billing occurrence'; end if;
  if s.interval='weekly' then
    if (p_occurrence-s.start_date)%7<>0 then raise exception 'Occurrence does not match cadence'; end if;
  else
    months:=(extract(year from p_occurrence)::integer-extract(year from s.start_date)::integer)*12+extract(month from p_occurrence)::integer-extract(month from s.start_date)::integer;
    if months%(case s.interval when 'monthly' then 1 when 'quarterly' then 3 else 12 end)<>0 then raise exception 'Occurrence does not match cadence'; end if;
    wanted:=date_trunc('month',p_occurrence)::date;
    day_max:=extract(day from wanted+interval '1 month - 1 day');
    wanted:=wanted+least(extract(day from s.start_date)::integer,day_max)-1;
    if wanted<>p_occurrence then raise exception 'Occurrence does not match anchor date'; end if;
  end if;
  if s.project_id is not null and not exists(select 1 from public.projects where org_id=p_org_id and id=s.project_id and client_id=s.client_id) then raise exception 'Subscription project customer mismatch'; end if;
  next_date:=private.next_subscription_date(s.start_date,p_occurrence,s.interval);
  insert into public.invoices(org_id,client_id,project_id,number,status,issue_date,due_date,amount_satang,notes,prices_include_vat,wht_rate_bps,source_subscription_id)
    values(p_org_id,s.client_id,s.project_id,'SUB-'||s.id::text||'-'||to_char(p_occurrence,'YYYYMMDD'),'draft',p_occurrence,p_occurrence+15,0,'Recurring agreement: '||s.name,s.prices_include_vat,s.wht_rate_bps,s.id)
    returning id into target;
  insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position,product_id,unit,tax_rate_bps,wht_rate_bps)
    values(p_org_id,target,s.name,1,s.amount_satang,s.amount_satang,0,s.product_id,s.unit,s.tax_rate_bps,s.wht_rate_bps);
  insert into public.subscription_occurrences(org_id,subscription_id,occurrence_date,invoice_id) values(p_org_id,s.id,p_occurrence,target);
  update public.subscriptions set last_generated_on=p_occurrence,next_run_date=next_date where org_id=p_org_id and id=s.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,actor,'subscription',s.id,'subscription_occurrence_generated','Created scheduled draft invoice',jsonb_build_object('invoiceId',target,'occurrence',p_occurrence,'nextRun',next_date));
  return target;
end;
$$;
revoke all on function public.generate_subscription_occurrence(uuid,uuid,date) from public,anon;
grant execute on function public.generate_subscription_occurrence(uuid,uuid,date) to authenticated,service_role;

commit;
