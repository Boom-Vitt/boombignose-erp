-- Invoker guard distinguishes direct writes from authorized definer commands.
create or replace function private.guard_quote_record()
returns trigger language plpgsql set search_path='' as $$
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

create or replace function private.guard_source_links()
returns trigger language plpgsql set search_path='' as $$
declare field text;
begin
  if current_user in ('authenticated','service_role') then
    foreach field in array array['source_quote_id','source_milestone_id'] loop
      if to_jsonb(new)?field and ((tg_op='INSERT' and to_jsonb(new)->>field is not null) or
        (tg_op='UPDATE' and (to_jsonb(new)->field is distinct from to_jsonb(old)->field))) then
        raise exception 'Source links require the transaction command';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
create trigger guard_source_links before insert or update on public.projects for each row execute function private.guard_source_links();
create trigger guard_source_links before insert or update on public.milestones for each row execute function private.guard_source_links();
create trigger guard_source_links before insert or update on public.invoices for each row execute function private.guard_source_links();
create or replace function private.guard_project_customer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.client_id is distinct from old.client_id and
    (exists(select 1 from public.quotes where org_id=old.org_id and project_id=old.id and status in ('accepted','converted'))
      or exists(select 1 from public.invoices where org_id=old.org_id and project_id=old.id)) then
      raise exception 'Contracted project customer is frozen';end if;
  return new;
end;
$$;
create trigger guard_project_customer before update on public.projects for each row execute function private.guard_project_customer();
