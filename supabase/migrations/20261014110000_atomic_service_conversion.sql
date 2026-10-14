-- Service workflow: preserve accepted terms and convert one agreement atomically.
alter table public.projects add column source_quote_id uuid;
alter table public.milestones add column source_quote_id uuid;
alter table public.invoices add column source_quote_id uuid;
alter table public.invoices add column source_milestone_id uuid;
alter table public.invoices add column discount_satang bigint not null default 0 check(discount_satang between 0 and 9007199254740991);
alter table public.projects add constraint projects_source_quote_tenant foreign key(org_id,source_quote_id) references public.quotes(org_id,id) deferrable initially deferred;
alter table public.milestones add constraint milestones_source_quote_tenant foreign key(org_id,source_quote_id) references public.quotes(org_id,id) deferrable initially deferred;
alter table public.invoices add constraint invoices_source_quote_tenant foreign key(org_id,source_quote_id) references public.quotes(org_id,id) deferrable initially deferred;
alter table public.invoices add constraint invoices_source_milestone_tenant foreign key(org_id,source_milestone_id) references public.milestones(org_id,id) deferrable initially deferred;
create unique index projects_one_source_quote on public.projects(org_id,source_quote_id) where source_quote_id is not null;
create unique index invoices_one_source_quote on public.invoices(org_id,source_quote_id) where source_quote_id is not null;
alter table public.quotes drop constraint quotes_converted_invoice_id_fkey_tenant;
alter table public.quotes add constraint quotes_converted_invoice_tenant foreign key(org_id,converted_invoice_id) references public.invoices(org_id,id) deferrable initially deferred;

create table public.quote_conversion_requests (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key uuid not null,
  quote_id uuid not null,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  primary key(org_id,key),
  foreign key(org_id,quote_id) references public.quotes(org_id,id) on delete cascade,
  foreign key(org_id,invoice_id) references public.invoices(org_id,id) on delete cascade
);
alter table public.quote_conversion_requests enable row level security;
alter table public.quote_conversion_requests force row level security;
revoke all on public.quote_conversion_requests from anon,authenticated;

create or replace function private.guard_quote_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare subtotal numeric; project_client uuid;
begin
  if new.discount_satang not between 0 and 9007199254740991 then raise exception 'Invalid quote discount'; end if;
  if tg_op='INSERT' and new.status<>'draft' then raise exception 'New quote must start as draft'; end if;
  if tg_op='UPDATE' then
    if old.status in ('accepted','converted','declined','expired') and
      (new.client_id<>old.client_id or new.number<>old.number or new.discount_satang<>old.discount_satang
       or new.notes is distinct from old.notes or new.issue_date<>old.issue_date or new.valid_until is distinct from old.valid_until) then
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
  new.total_satang:=greatest(0,subtotal-new.discount_satang)::bigint;
  if new.status in ('sent','accepted','converted') and (subtotal<=0 or new.discount_satang>subtotal) then raise exception 'Priced lines and valid discount required'; end if;
  if new.status='accepted' and new.valid_until is not null and new.valid_until<(now() at time zone 'Asia/Bangkok')::date then raise exception 'Quote expired'; end if;
  return new;
end;
$$;
create trigger guard_quote_record before insert or update on public.quotes for each row execute function private.guard_quote_record();

create or replace function private.guard_quote_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare q public.quotes; target uuid; tenant uuid; amount numeric;
begin
  if tg_op='DELETE' then target:=old.quote_id;tenant:=old.org_id;else target:=new.quote_id;tenant:=new.org_id;end if;
  select * into q from public.quotes where org_id=tenant and id=target for update;
  if not found then if tg_op='DELETE' then return old;end if;raise exception 'Quote unavailable';end if;
  if q.status not in ('draft','sent') then raise exception 'Agreement lines are frozen'; end if;
  if tg_op='DELETE' then return old;end if;
  if tg_op='UPDATE' and new.quote_id<>old.quote_id then raise exception 'Line reassignment forbidden';end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line';end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount>9007199254740991 then raise exception 'Unsafe line amount';end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;
create trigger guard_quote_line before insert or update or delete on public.quote_items for each row execute function private.guard_quote_line();
create or replace function private.recompute_quote_lines()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;
begin
  if tg_op='DELETE' then target:=old.quote_id;tenant:=old.org_id;else target:=new.quote_id;tenant:=new.org_id;end if;
  update public.quotes set updated_at=now() where org_id=tenant and id=target;
  return null;
end;
$$;
create trigger recompute_quote_lines after insert or update or delete on public.quote_items for each row execute function private.recompute_quote_lines();

create or replace function private.recompute_invoice_lines()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;
begin
  if tg_op='DELETE' then target:=old.invoice_id;tenant:=old.org_id;else target:=new.invoice_id;tenant:=new.org_id;end if;
  update public.invoices set amount_satang=greatest(0,(select coalesce(sum(amount_satang),0) from public.invoice_items where org_id=tenant and invoice_id=target)-discount_satang)
    where org_id=tenant and id=target;
  return null;
end;
$$;
create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;
begin
  if new.project_id is not null then
    select client_id into customer from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or customer is distinct from new.client_id then raise exception 'Invoice and project customer must match';end if;
  end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and
    exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
end;
$$;
create trigger guard_commercial_customer before insert or update on public.invoices for each row execute function private.guard_commercial_customer();

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
  select * into q from public.quotes where org_id=p_org_id and id=p_quote_id for update;
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
  insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position)
    select p_org_id,invoice,description,quantity,unit_price_satang,amount_satang,position from public.quote_items where org_id=p_org_id and quote_id=q.id order by position,id;
  if (select amount_satang from public.invoices where id=invoice and org_id=p_org_id)<>q.total_satang then raise exception 'Conversion totals disagree';end if;
  update public.quotes set status='converted',project_id=project,converted_invoice_id=invoice where id=q.id and org_id=p_org_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Accepted service quote converted atomically',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;
revoke all on function public.convert_accepted_quote(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.convert_accepted_quote(uuid,uuid,uuid) to authenticated;
