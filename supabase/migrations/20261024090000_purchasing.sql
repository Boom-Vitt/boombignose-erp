alter type public.record_type add value if not exists 'vendor';
alter type public.record_type add value if not exists 'purchase_order';
create type public.purchase_status as enum ('draft','sent','confirmed','received','billed','cancelled');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 200),
  tax_id text check(length(tax_id)<=80),
  email text check(length(email)<=320),
  phone text check(length(phone)<=80),
  address text check(length(address)<=2000),
  payment_terms_days integer not null default 30 check(payment_terms_days between 0 and 3650),
  notes text check(length(notes)<=10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id)
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  vendor_id uuid not null,
  status public.purchase_status not null default 'draft',
  order_date date not null default current_date check(isfinite(order_date)),
  expected_date date check(isfinite(expected_date)),
  notes text check(length(notes)<=10000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id),
  unique(org_id,number),
  foreign key(org_id,vendor_id) references public.vendors(org_id,id)
);
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  product_id uuid,
  description text not null check(length(btrim(description)) between 1 and 4000),
  quantity numeric(12,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
  unit text not null default 'piece' check(length(btrim(unit)) between 1 and 40),
  unit_cost_satang bigint not null check(unit_cost_satang between 0 and 9007199254740991),
  received_quantity numeric(12,3) not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
  billed_quantity numeric(12,3) not null default 0 check(billed_quantity>=0 and billed_quantity<=received_quantity),
  position integer not null default 0 check(position>=0),
  unique(org_id,id),
  foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id) on delete cascade,
  foreign key(org_id,product_id) references public.products(org_id,id) on delete set null (product_id),
  check(round(quantity*unit_cost_satang)<=9007199254740991)
);
alter table public.costs
  add column vendor_id uuid,
  add column purchase_order_id uuid,
  add column bill_number text check(length(bill_number) between 1 and 200),
  add column bill_date date check(isfinite(bill_date)),
  add column due_date date check(isfinite(due_date)),
  add column paid_at timestamptz check(isfinite(paid_at)),
  add constraint costs_vendor_tenant_fkey foreign key(org_id,vendor_id) references public.vendors(org_id,id),
  add constraint costs_purchase_order_tenant_fkey foreign key(org_id,purchase_order_id) references public.purchase_orders(org_id,id);
create unique index costs_vendor_bill_number_key on public.costs(org_id,vendor_id,bill_number) where vendor_id is not null and bill_number is not null;
create index vendors_org_name_idx on public.vendors(org_id,name);
create index purchase_orders_org_date_idx on public.purchase_orders(org_id,order_date desc);
create index purchase_orders_vendor_idx on public.purchase_orders(org_id,vendor_id);
create index purchase_order_items_order_idx on public.purchase_order_items(org_id,purchase_order_id,position);
create index costs_purchase_order_idx on public.costs(org_id,purchase_order_id);
create index costs_vendor_due_idx on public.costs(org_id,due_date) where vendor_id is not null and paid_at is null;

do $$ declare t text; begin
  foreach t in array array['vendors','purchase_orders','purchase_order_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_org_member(org_id))',t);
    execute format('create trigger guard_tenant_identity before update on public.%I for each row execute function private.guard_tenant_identity()',t);
  end loop;
end $$;
grant insert,update on public.vendors to authenticated;
create policy tenant_insert on public.vendors for insert to authenticated with check(private.is_org_staff(org_id));
create policy tenant_update on public.vendors for update to authenticated using(private.is_org_staff(org_id)) with check(private.is_org_staff(org_id));
grant insert,delete on public.purchase_order_items to authenticated;
create policy tenant_insert on public.purchase_order_items for insert to authenticated with check(private.is_org_staff(org_id));
create policy tenant_delete on public.purchase_order_items for delete to authenticated using(private.is_org_staff(org_id));
create trigger set_updated_at before update on public.vendors for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.purchase_orders for each row execute function public.set_updated_at();
create trigger log_record_status after update of status on public.purchase_orders for each row execute function private.log_record_status('purchase_order');

-- Compare the enum as text so new enum labels are safe in this migration transaction.
create or replace function private.record_exists(target_org uuid, kind public.record_type, target_id uuid)
returns boolean language sql stable set search_path='' as $$
  select case kind::text
    when 'client' then exists(select 1 from public.clients where org_id=target_org and id=target_id)
    when 'deal' then exists(select 1 from public.deals where org_id=target_org and id=target_id)
    when 'quote' then exists(select 1 from public.quotes where org_id=target_org and id=target_id)
    when 'invoice' then exists(select 1 from public.invoices where org_id=target_org and id=target_id)
    when 'project' then exists(select 1 from public.projects where org_id=target_org and id=target_id)
    when 'subscription' then exists(select 1 from public.subscriptions where org_id=target_org and id=target_id)
    when 'vendor' then exists(select 1 from public.vendors where org_id=target_org and id=target_id)
    when 'purchase_order' then exists(select 1 from public.purchase_orders where org_id=target_org and id=target_id)
    else false end;
$$;

create function private.lock_purchase_order_for_line(p_org_id uuid,p_order_id uuid)
returns public.purchase_orders language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found then raise exception 'Purchase order unavailable';end if;
  return po;
end;
$$;
revoke all on function private.lock_purchase_order_for_line(uuid,uuid) from public,anon;
grant execute on function private.lock_purchase_order_for_line(uuid,uuid) to authenticated;

create function private.guard_purchase_line()
returns trigger language plpgsql set search_path='' as $$
declare po public.purchase_orders; target_org uuid; target_order uuid; total numeric;
begin
  target_org:=case when tg_op='DELETE' then old.org_id else new.org_id end;
  target_order:=case when tg_op='DELETE' then old.purchase_order_id else new.purchase_order_id end;
  if current_user='authenticated' then
    select * into po from private.lock_purchase_order_for_line(target_org,target_order);
  else
    select * into po from public.purchase_orders where org_id=target_org and id=target_order for no key update;
    if not found then raise exception 'Purchase order unavailable';end if;
  end if;
  if current_user='authenticated' then
    if po.status<>'draft' then raise exception 'Only draft purchase lines are editable';end if;
    if tg_op<>'DELETE' and (new.received_quantity<>0 or new.billed_quantity<>0) then raise exception 'Use receipt and billing commands';end if;
    if tg_op='INSERT' and new.product_id is not null and not exists(select 1 from public.products where org_id=new.org_id and id=new.product_id and active) then raise exception 'Active workspace product required';end if;
  end if;
  if tg_op='DELETE' then return old;end if;
  select coalesce(sum(round(quantity*unit_cost_satang)),0)+round(new.quantity*new.unit_cost_satang)
    into total from public.purchase_order_items where org_id=new.org_id and purchase_order_id=new.purchase_order_id and id<>new.id;
  if total>9007199254740991 then raise exception 'Purchase total exceeds safe satang bounds';end if;
  return new;
end;
$$;
create trigger guard_purchase_line before insert or update or delete on public.purchase_order_items for each row execute function private.guard_purchase_line();

create function public.create_purchase_order(p_org_id uuid,p_vendor_id uuid,p_order_date date,p_expected_date date default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; counter bigint; num text; yr integer;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  if not exists(select 1 from public.vendors where org_id=p_org_id and id=p_vendor_id and active) then raise exception 'Active workspace vendor required';end if;
  yr:=extract(year from p_order_date);
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'PO',yr,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='PO-'||yr::text||'-'||lpad(counter::text,greatest(3,length(counter::text)),'0');
    exit when not exists(select 1 from public.purchase_orders where org_id=p_org_id and number=num);
  end loop;
  insert into public.purchase_orders(org_id,number,vendor_id,order_date,expected_date,notes,created_by)
    values(p_org_id,num,p_vendor_id,p_order_date,p_expected_date,p_notes,auth.uid()) returning id into result;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
    values(p_org_id,auth.uid(),'purchase_order',result,'created','Created purchase order '||num);
  return result;
end;
$$;

create function public.transition_purchase_order(p_org_id uuid,p_order_id uuid,p_status public.purchase_status)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found then raise exception 'Purchase order unavailable';end if;
  if po.status=p_status then return;end if;
  if not ((po.status='draft' and p_status='sent') or (po.status in ('draft','sent') and p_status='confirmed') or
    (po.status in ('draft','sent','confirmed') and p_status='cancelled' and not exists(select 1 from public.purchase_order_items where purchase_order_id=po.id and received_quantity>0))) then
    raise exception 'Invalid purchase transition';end if;
  if p_status in ('sent','confirmed') and not exists(select 1 from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id) then raise exception 'Add purchase lines first';end if;
  update public.purchase_orders set status=p_status where org_id=p_org_id and id=po.id;
end;
$$;

create function public.receive_purchase_order(p_org_id uuid,p_order_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; line jsonb; item public.purchase_order_items; qty numeric; changed boolean:=false;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status not in ('confirmed','received') then raise exception 'Confirmed purchase order required';end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Receipt lines required';end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_lines)) then raise exception 'Duplicate receipt line';end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    select * into item from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id and id=(line->>'id')::uuid for update;
    if not found then raise exception 'Receipt line unavailable';end if;
    qty:=(line->>'received_quantity')::numeric;
    if qty is null or qty='NaN'::numeric or qty<item.received_quantity or qty>item.quantity or qty<>round(qty,3) then raise exception 'Invalid cumulative receipt quantity';end if;
    changed:=changed or qty<>item.received_quantity;
    update public.purchase_order_items set received_quantity=qty where org_id=p_org_id and id=item.id;
  end loop;
  if not exists(select 1 from public.purchase_order_items where purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='received' where org_id=p_org_id and id=po.id;
  end if;
  if changed then
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
      values(p_org_id,auth.uid(),'purchase_order',po.id,'received','Recorded received quantities',jsonb_build_object('lines',p_lines));
  end if;
end;
$$;

create function public.bill_purchase_order(p_org_id uuid,p_order_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; vendor public.vendors; amount numeric; result uuid; bill_no text; today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may manage purchases';end if;
  select * into po from public.purchase_orders where org_id=p_org_id and id=p_order_id for no key update;
  if not found or po.status not in ('confirmed','received','billed') then raise exception 'Received purchase quantities required';end if;
  select coalesce(sum(round(received_quantity*unit_cost_satang)-round(billed_quantity*unit_cost_satang)),0) into amount
    from public.purchase_order_items where org_id=p_org_id and purchase_order_id=po.id;
  if amount=0 and not exists(select 1 from public.purchase_order_items where purchase_order_id=po.id and received_quantity>billed_quantity) then
    select id into result from public.costs where org_id=p_org_id and purchase_order_id=po.id order by created_at desc,id desc limit 1;
    if result is null then raise exception 'Receive quantities before creating a bill';end if;
    return result;
  end if;
  if amount<0 or amount>9007199254740991 then raise exception 'Bill amount within safe satang bounds required';end if;
  select * into vendor from public.vendors where org_id=p_org_id and id=po.vendor_id;
  select po.number||'-B'||(count(*)+1)::text into bill_no from public.costs where org_id=p_org_id and purchase_order_id=po.id;
  insert into public.costs(org_id,category,amount_satang,incurred_on,vendor,vendor_id,purchase_order_id,bill_number,bill_date,due_date,notes)
    values(p_org_id,'other',amount,today,vendor.name,vendor.id,po.id,bill_no,today,today+vendor.payment_terms_days,'Vendor bill for '||po.number) returning id into result;
  update public.purchase_order_items set billed_quantity=received_quantity where org_id=p_org_id and purchase_order_id=po.id;
  if not exists(select 1 from public.purchase_order_items where purchase_order_id=po.id and received_quantity<quantity) then
    update public.purchase_orders set status='billed' where org_id=p_org_id and id=po.id;
  end if;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'purchase_order',po.id,'bill_created','Created vendor bill '||bill_no,jsonb_build_object('costId',result,'amount_satang',amount));
  return result;
end;
$$;

create function private.guard_vendor_bill()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' then
    if tg_op='DELETE' and (old.vendor_id is not null or old.purchase_order_id is not null) then raise exception 'Linked vendor bills must be retained';end if;
    if tg_op='INSERT' and (new.vendor_id is not null or new.purchase_order_id is not null) then raise exception 'Use purchase billing command';end if;
    if tg_op='UPDATE' and (old.vendor_id is not null or old.purchase_order_id is not null or new.vendor_id is not null or new.purchase_order_id is not null) then
      if not private.is_org_staff(new.org_id) then raise exception 'Only owners and admins may pay vendor bills';end if;
      if (to_jsonb(new)-'paid_at'-'updated_at') is distinct from (to_jsonb(old)-'paid_at'-'updated_at') or
        (old.paid_at is not null and new.paid_at is distinct from old.paid_at) then raise exception 'Vendor bill evidence is immutable';end if;
    end if;
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
create trigger guard_vendor_bill before insert or update or delete on public.costs for each row execute function private.guard_vendor_bill();

revoke all on function public.create_purchase_order(uuid,uuid,date,date,text), public.transition_purchase_order(uuid,uuid,public.purchase_status), public.receive_purchase_order(uuid,uuid,jsonb), public.bill_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.create_purchase_order(uuid,uuid,date,date,text), public.transition_purchase_order(uuid,uuid,public.purchase_status), public.receive_purchase_order(uuid,uuid,jsonb), public.bill_purchase_order(uuid,uuid) to authenticated;
