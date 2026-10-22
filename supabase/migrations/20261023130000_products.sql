create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sku text check (sku is null or (sku = btrim(sku) and length(sku) between 1 and 80)),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text check (length(description) <= 4000),
  type text not null default 'service' check (type in ('service','goods')),
  unit text not null default 'piece' check (length(btrim(unit)) between 1 and 40),
  list_price_satang bigint not null default 0 check (list_price_satang between 0 and 9007199254740991),
  cost_satang bigint not null default 0 check (cost_satang between 0 and 9007199254740991),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  is_stockable boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id)
);
create unique index products_org_sku_key on public.products(org_id,sku) where sku is not null;
create index products_org_active_name_idx on public.products(org_id,active,name);
alter table public.products enable row level security;
alter table public.products force row level security;
revoke all on public.products from anon;
grant select,insert,update,delete on public.products to authenticated;
create policy tenant_read on public.products for select to authenticated using(private.is_org_member(org_id));
create policy tenant_insert on public.products for insert to authenticated with check(private.is_org_staff(org_id));
create policy tenant_update on public.products for update to authenticated using(private.is_org_staff(org_id)) with check(private.is_org_staff(org_id));
create policy tenant_delete on public.products for delete to authenticated using(private.is_org_staff(org_id));
create trigger guard_tenant_identity before update on public.products for each row execute function private.guard_tenant_identity();
create trigger set_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.quote_items
  add column product_id uuid,
  add column unit text check (unit is null or length(btrim(unit)) between 1 and 40),
  add constraint quote_items_product_tenant_fkey foreign key(org_id,product_id) references public.products(org_id,id) on delete set null (product_id);
alter table public.invoice_items
  add column product_id uuid,
  add column unit text check (unit is null or length(btrim(unit)) between 1 and 40),
  add constraint invoice_items_product_tenant_fkey foreign key(org_id,product_id) references public.products(org_id,id) on delete set null (product_id);
create index quote_items_product_idx on public.quote_items(org_id,product_id) where product_id is not null;
create index invoice_items_product_idx on public.invoice_items(org_id,product_id) where product_id is not null;

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
  insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,amount_satang,position)
    select p_org_id,invoice,product_id,description,quantity,unit,unit_price_satang,amount_satang,position from public.quote_items where org_id=p_org_id and quote_id=q.id order by position,id;
  if (select amount_satang from public.invoices where id=invoice and org_id=p_org_id)<>q.total_satang then raise exception 'Conversion totals disagree';end if;
  update public.quotes set status='converted',project_id=project,converted_invoice_id=invoice where id=q.id and org_id=p_org_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Accepted service quote converted atomically',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;
