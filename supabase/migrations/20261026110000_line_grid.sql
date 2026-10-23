-- Line grid: section and note rows, and one atomic save for every line change.
-- Sections and notes live beside the priced line tables, so no line guard, totals trigger,
-- conversion, issue snapshot or receipt command ever sees an amount-free row.
create table public.document_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  quote_id uuid,
  invoice_id uuid,
  purchase_order_id uuid,
  kind text not null check(kind in ('section','note')),
  description text not null check(length(btrim(description)) between 1 and 4000),
  -- Priced lines above this row; placement survives line renumbering and issue snapshots.
  lines_before integer not null check(lines_before>=0),
  position integer not null check(position>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(num_nonnulls(quote_id,invoice_id,purchase_order_id)=1),
  foreign key(org_id,quote_id) references public.quotes(org_id,id) on delete cascade,
  foreign key(org_id,invoice_id) references public.invoices(org_id,id) on delete cascade,
  foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id) on delete cascade
);
create index document_sections_quote_idx on public.document_sections(org_id,quote_id,position) where quote_id is not null;
create index document_sections_invoice_idx on public.document_sections(org_id,invoice_id,position) where invoice_id is not null;
create index document_sections_purchase_idx on public.document_sections(org_id,purchase_order_id,position) where purchase_order_id is not null;

alter table public.document_sections enable row level security;
alter table public.document_sections force row level security;
revoke all on public.document_sections from anon,authenticated;
grant select,insert,update,delete on public.document_sections to authenticated;
-- Writers match the parent's line table: members for quotes and invoices, staff for purchases.
create policy tenant_read on public.document_sections for select to authenticated using(private.is_org_member(org_id));
create policy tenant_insert on public.document_sections for insert to authenticated
  with check(case when purchase_order_id is null then private.is_org_member(org_id) else private.is_org_staff(org_id) end);
create policy tenant_update on public.document_sections for update to authenticated
  using(case when purchase_order_id is null then private.is_org_member(org_id) else private.is_org_staff(org_id) end)
  with check(case when purchase_order_id is null then private.is_org_member(org_id) else private.is_org_staff(org_id) end);
create policy tenant_delete on public.document_sections for delete to authenticated
  using(case when purchase_order_id is null then private.is_org_member(org_id) else private.is_org_staff(org_id) end);
create trigger guard_tenant_identity before update on public.document_sections for each row execute function private.guard_tenant_identity();
create trigger set_updated_at before update on public.document_sections for each row execute function public.set_updated_at();

-- A section freezes with its document's priced lines; the conditions mirror each line guard.
create function private.guard_document_section()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.document_sections; q public.quotes; i public.invoices; po public.purchase_orders; present boolean;
begin
  if tg_op='DELETE' then r:=old; else r:=new; end if;
  if tg_op='UPDATE' and (new.quote_id,new.invoice_id,new.purchase_order_id) is distinct from (old.quote_id,old.invoice_id,old.purchase_order_id) then
    raise exception 'Line reassignment forbidden';
  end if;
  if r.quote_id is not null then
    select * into q from public.quotes where org_id=r.org_id and id=r.quote_id for no key update;
    present:=found;
    if present and q.status not in ('draft','sent') then raise exception 'Agreement lines are frozen'; end if;
  elsif r.invoice_id is not null then
    select * into i from public.invoices where org_id=r.org_id and id=r.invoice_id for update;
    present:=found;
    if present and ((i.source_quote_id is not null and i.quote_invoice_sealed) or i.issued_snapshot_id is not null
      or exists(select 1 from public.payments where org_id=r.org_id and invoice_id=i.id and verification_state='verified')
      or exists(select 1 from public.payment_claims where org_id=r.org_id and invoice_id=i.id and status='pending')) then
      raise exception 'Issued or payment evidence locks invoice lines';
    end if;
  else
    select * into po from public.purchase_orders where org_id=r.org_id and id=r.purchase_order_id for no key update;
    present:=found;
    if present and po.status<>'draft' then raise exception 'Only draft purchase lines are editable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if not present then raise exception 'Document unavailable'; end if;
  return new;
end;
$$;
revoke all on function private.guard_document_section() from public;
create trigger guard_document_section before insert or update or delete on public.document_sections
  for each row execute function private.guard_document_section();

-- Draft purchase lines become editable in place; guard_purchase_line keeps them draft-only
-- and receipt and billing quantities stay command-only.
grant update(product_id,description,quantity,unit,unit_cost_satang,position) on public.purchase_order_items to authenticated;
create policy tenant_update on public.purchase_order_items for update to authenticated
  using(private.is_org_staff(org_id)) with check(private.is_org_staff(org_id));

-- The grid payload in display order: lines and sections each numbered among their own kind.
create function private.line_grid_rows(p_rows jsonb)
returns table(kind text,id uuid,product_id uuid,description text,quantity numeric,unit text,unit_price_satang bigint,tax_rate_bps integer,slot integer,lines_before integer)
language sql immutable set search_path='' as $$
  select e.v->>'kind',(e.v->>'id')::uuid,(e.v->>'product_id')::uuid,e.v->>'description',(e.v->>'quantity')::numeric,e.v->>'unit',
    (e.v->>'unit_price_satang')::bigint,coalesce((e.v->>'tax_rate_bps')::integer,0),
    (row_number() over(partition by e.v->>'kind'='line' order by e.n)-1)::integer,
    (count(*) filter(where e.v->>'kind'='line') over(order by e.n)-case when e.v->>'kind'='line' then 1 else 0 end)::integer
  from jsonb_array_elements(p_rows) with ordinality e(v,n)
$$;

/**
 * Saves every line change of one document in one transaction, through the line guards.
 * Rows carry stable ids (new rows bring a client id), so a retried save converges instead
 * of duplicating lines. Lines another user added meanwhile keep their order after these.
 * Security invoker: RLS and the guards' role checks apply to the caller.
 */
create function public.save_document_lines(p_document text,p_document_id uuid,p_rows jsonb,p_deleted uuid[])
returns void language plpgsql set search_path='' as $$
declare v_org uuid;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or p_deleted is null then raise exception 'Invalid line rows'; end if;
  if exists(select 1 from private.line_grid_rows(p_rows) r where r.id is null or r.kind is null or r.kind not in ('line','section','note'))
    or (select count(distinct r.id) from private.line_grid_rows(p_rows) r)<>jsonb_array_length(p_rows)
    or exists(select 1 from private.line_grid_rows(p_rows) r where r.id=any(p_deleted)) then
    raise exception 'Invalid line rows';
  end if;
  if p_document='quote' then select org_id into v_org from public.quotes where id=p_document_id;
  elsif p_document='invoice' then select org_id into v_org from public.invoices where id=p_document_id;
  elsif p_document='purchase_order' then select org_id into v_org from public.purchase_orders where id=p_document_id;
  else raise exception 'Unknown document'; end if;
  if v_org is null then raise exception 'Document unavailable'; end if;
  -- New or re-pointed lines need an active catalog product; a line keeps one archived later.
  if exists(select 1 from private.line_grid_rows(p_rows) r where r.kind='line' and r.product_id is not null
      and not exists(select 1 from public.products p where p.org_id=v_org and p.id=r.product_id and p.active)
      and not exists(select 1 from public.quote_items t where t.org_id=v_org and t.id=r.id and t.product_id=r.product_id)
      and not exists(select 1 from public.invoice_items t where t.org_id=v_org and t.id=r.id and t.product_id=r.product_id)
      and not exists(select 1 from public.purchase_order_items t where t.org_id=v_org and t.id=r.id and t.product_id=r.product_id)) then
    raise exception 'Product unavailable. Choose an active product or a free-text line.';
  end if;

  if p_document='quote' then
    delete from public.quote_items where org_id=v_org and quote_id=p_document_id and id=any(p_deleted);
    update public.quote_items t set product_id=r.product_id,description=r.description,quantity=r.quantity,unit=r.unit,unit_price_satang=r.unit_price_satang,tax_rate_bps=r.tax_rate_bps
      from private.line_grid_rows(p_rows) r
      where r.kind='line' and t.org_id=v_org and t.quote_id=p_document_id and t.id=r.id
        and (t.product_id,t.description,t.quantity,t.unit,t.unit_price_satang,t.tax_rate_bps) is distinct from (r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang,r.tax_rate_bps);
    insert into public.quote_items(id,org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,tax_rate_bps)
      select r.id,v_org,p_document_id,r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang,r.tax_rate_bps from private.line_grid_rows(p_rows) r
      where r.kind='line' and not exists(select 1 from public.quote_items t where t.org_id=v_org and t.quote_id=p_document_id and t.id=r.id);
    update public.quote_items t set position=o.n
      from (select q.id,(row_number() over(order by r.slot nulls last,q.position,q.id)-1)::integer n
        from public.quote_items q left join private.line_grid_rows(p_rows) r on r.kind='line' and r.id=q.id
        where q.org_id=v_org and q.quote_id=p_document_id) o
      where t.org_id=v_org and t.id=o.id and t.position<>o.n;
  elsif p_document='invoice' then
    delete from public.invoice_items where org_id=v_org and invoice_id=p_document_id and id=any(p_deleted);
    update public.invoice_items t set product_id=r.product_id,description=r.description,quantity=r.quantity,unit=r.unit,unit_price_satang=r.unit_price_satang,tax_rate_bps=r.tax_rate_bps
      from private.line_grid_rows(p_rows) r
      where r.kind='line' and t.org_id=v_org and t.invoice_id=p_document_id and t.id=r.id
        and (t.product_id,t.description,t.quantity,t.unit,t.unit_price_satang,t.tax_rate_bps) is distinct from (r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang,r.tax_rate_bps);
    insert into public.invoice_items(id,org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,tax_rate_bps)
      select r.id,v_org,p_document_id,r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang,r.tax_rate_bps from private.line_grid_rows(p_rows) r
      where r.kind='line' and not exists(select 1 from public.invoice_items t where t.org_id=v_org and t.invoice_id=p_document_id and t.id=r.id);
    update public.invoice_items t set position=o.n
      from (select i.id,(row_number() over(order by r.slot nulls last,i.position,i.id)-1)::integer n
        from public.invoice_items i left join private.line_grid_rows(p_rows) r on r.kind='line' and r.id=i.id
        where i.org_id=v_org and i.invoice_id=p_document_id) o
      where t.org_id=v_org and t.id=o.id and t.position<>o.n;
  else
    delete from public.purchase_order_items where org_id=v_org and purchase_order_id=p_document_id and id=any(p_deleted);
    update public.purchase_order_items t set product_id=r.product_id,description=r.description,quantity=r.quantity,unit=r.unit,unit_cost_satang=r.unit_price_satang
      from private.line_grid_rows(p_rows) r
      where r.kind='line' and t.org_id=v_org and t.purchase_order_id=p_document_id and t.id=r.id
        and (t.product_id,t.description,t.quantity,t.unit,t.unit_cost_satang) is distinct from (r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang);
    insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,position)
      select r.id,v_org,p_document_id,r.product_id,r.description,r.quantity,r.unit,r.unit_price_satang,r.slot from private.line_grid_rows(p_rows) r
      where r.kind='line' and not exists(select 1 from public.purchase_order_items t where t.org_id=v_org and t.purchase_order_id=p_document_id and t.id=r.id);
    update public.purchase_order_items t set position=o.n
      from (select p.id,(row_number() over(order by r.slot nulls last,p.position,p.id)-1)::integer n
        from public.purchase_order_items p left join private.line_grid_rows(p_rows) r on r.kind='line' and r.id=p.id
        where p.org_id=v_org and p.purchase_order_id=p_document_id) o
      where t.org_id=v_org and t.id=o.id and t.position<>o.n;
  end if;

  delete from public.document_sections s where s.org_id=v_org and p_document_id in (s.quote_id,s.invoice_id,s.purchase_order_id) and s.id=any(p_deleted);
  update public.document_sections s set kind=r.kind,description=r.description,lines_before=r.lines_before,position=r.slot
    from private.line_grid_rows(p_rows) r
    where r.kind<>'line' and s.org_id=v_org and p_document_id in (s.quote_id,s.invoice_id,s.purchase_order_id) and s.id=r.id
      and (s.kind,s.description,s.lines_before,s.position) is distinct from (r.kind,r.description,r.lines_before,r.slot);
  insert into public.document_sections(id,org_id,quote_id,invoice_id,purchase_order_id,kind,description,lines_before,position)
    select r.id,v_org,case when p_document='quote' then p_document_id end,case when p_document='invoice' then p_document_id end,
      case when p_document='purchase_order' then p_document_id end,r.kind,r.description,r.lines_before,r.slot
    from private.line_grid_rows(p_rows) r
    where r.kind<>'line' and not exists(select 1 from public.document_sections s where s.org_id=v_org and p_document_id in (s.quote_id,s.invoice_id,s.purchase_order_id) and s.id=r.id);
end;
$$;
revoke all on function public.save_document_lines(text,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.save_document_lines(text,uuid,jsonb,uuid[]) to authenticated;
revoke all on function private.line_grid_rows(jsonb) from public;
grant execute on function private.line_grid_rows(jsonb) to authenticated;
