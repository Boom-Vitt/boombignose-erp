create type public.record_type as enum ('client','deal','quote','invoice','project','subscription');
grant usage on schema private to authenticated,service_role;

create function private.record_exists(target_org uuid, kind public.record_type, target_id uuid)
returns boolean language sql stable set search_path='' as $$
  select case kind
    when 'client' then exists(select 1 from public.clients where org_id=target_org and id=target_id)
    when 'deal' then exists(select 1 from public.deals where org_id=target_org and id=target_id)
    when 'quote' then exists(select 1 from public.quotes where org_id=target_org and id=target_id)
    when 'invoice' then exists(select 1 from public.invoices where org_id=target_org and id=target_id)
    when 'project' then exists(select 1 from public.projects where org_id=target_org and id=target_id)
    when 'subscription' then exists(select 1 from public.subscriptions where org_id=target_org and id=target_id)
    else false end;
$$;
revoke all on function private.record_exists(uuid,public.record_type,uuid) from public,anon;
grant execute on function private.record_exists(uuid,public.record_type,uuid) to authenticated,service_role;

create function public.record_activity_assignees(p_org_id uuid)
returns table(user_id uuid, full_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required'; end if;
  return query select m.user_id,p.full_name from public.memberships m
    join public.profiles p on p.id=m.user_id where m.org_id=p_org_id order by p.full_name,m.user_id;
end;
$$;
revoke all on function public.record_activity_assignees(uuid) from public,anon;
grant execute on function public.record_activity_assignees(uuid) to authenticated;

alter table public.activities
  add column record_type public.record_type,
  add column record_id uuid,
  add column completed_at timestamptz,
  add constraint activities_record_pair check ((record_type is null)=(record_id is null));
update public.activities set
  record_type=case when deal_id is not null then 'deal'::public.record_type when client_id is not null then 'client'::public.record_type end,
  record_id=coalesce(deal_id,client_id),
  completed_at=case when done then updated_at end;
create index activities_record_idx on public.activities(org_id,record_type,record_id);
create index activities_owner_due_idx on public.activities(org_id,owner,done,due_date);

create function private.sync_activity_record()
returns trigger language plpgsql set search_path='' as $$
declare legacy_changed boolean := false; target_changed boolean := true; deal_client uuid;
begin
  if tg_op='UPDATE' then
    target_changed := (new.record_type,new.record_id) is distinct from (old.record_type,old.record_id);
    legacy_changed := not target_changed and (new.client_id,new.deal_id) is distinct from (old.client_id,old.deal_id);
  end if;
  if (new.record_type is null and new.record_id is null) or legacy_changed then
    new.record_type := case when new.deal_id is not null then 'deal'::public.record_type when new.client_id is not null then 'client'::public.record_type end;
    new.record_id := coalesce(new.deal_id,new.client_id);
    target_changed := true;
  end if;
  if (new.record_type is null) <> (new.record_id is null) then raise exception 'Record type and id must be supplied together'; end if;
  if tg_op='INSERT' and new.record_id is not null then
    if (new.deal_id is not null and (new.record_type<>'deal' or new.record_id<>new.deal_id))
      or (new.record_type='client' and new.client_id is not null and new.client_id<>new.record_id)
      or (new.record_type not in ('client','deal') and new.client_id is not null) then
      raise exception 'Conflicting activity record links';
    end if;
    if new.record_type='deal' and new.client_id is not null and not exists(
      select 1 from public.deals where org_id=new.org_id and id=new.record_id and client_id=new.client_id
    ) then raise exception 'Conflicting activity record links'; end if;
  end if;
  if target_changed and new.record_id is not null then
    if not private.record_exists(new.org_id,new.record_type,new.record_id) then raise exception 'Record not found in workspace'; end if;
    if new.record_type='deal' then
      select client_id into deal_client from public.deals where org_id=new.org_id and id=new.record_id;
      new.deal_id := new.record_id;
      new.client_id := deal_client;
    elsif new.record_type='client' then
      new.client_id := new.record_id; new.deal_id := null;
    else
      new.client_id := null; new.deal_id := null;
    end if;
  end if;
  if new.owner is not null and (tg_op='INSERT' or new.owner is distinct from old.owner) then
    if current_user in ('postgres','service_role') then
      if not exists(select 1 from public.memberships where org_id=new.org_id and user_id=new.owner) then raise exception 'Assignee not found in workspace'; end if;
    elsif not exists(select 1 from public.record_activity_assignees(new.org_id) where user_id=new.owner) then
      raise exception 'Assignee not found in workspace';
    end if;
  end if;
  if tg_op='INSERT' then
    new.completed_at := case when new.done then now() end;
  elsif new.done is distinct from old.done then
    new.completed_at := case when new.done then now() end;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;
create trigger sync_activity_record before insert or update on public.activities for each row execute function private.sync_activity_record();

create table public.record_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  record_type public.record_type not null,
  record_id uuid not null,
  author uuid not null references auth.users(id),
  body text not null check(length(btrim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  unique(org_id,id)
);
create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  record_type public.record_type not null,
  record_id uuid not null,
  path text not null unique,
  filename text not null check(length(filename) between 1 and 255),
  size bigint not null check(size between 1 and 10485760),
  content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv')),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(org_id,id),
  check(path=org_id::text||'/'||record_type::text||'/'||record_id::text||'/'||id::text)
);
create index record_notes_record_idx on public.record_notes(org_id,record_type,record_id,created_at desc);
create index record_attachments_record_idx on public.record_attachments(org_id,record_type,record_id,created_at desc);
alter table public.record_notes enable row level security;
alter table public.record_notes force row level security;
alter table public.record_attachments enable row level security;
alter table public.record_attachments force row level security;
create policy record_notes_read on public.record_notes for select to authenticated using(private.is_org_member(org_id));
create policy record_notes_insert on public.record_notes for insert to authenticated with check(private.is_org_member(org_id) and author=(select auth.uid()) and private.record_exists(org_id,record_type,record_id));
create policy record_attachments_read on public.record_attachments for select to authenticated using(private.is_org_member(org_id));
create policy record_attachments_insert on public.record_attachments for insert to authenticated with check(private.is_org_member(org_id) and uploaded_by=(select auth.uid()) and private.record_exists(org_id,record_type,record_id));
grant select,insert on public.record_notes,public.record_attachments to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('record-attachments','record-attachments',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv']);
create function private.can_access_record_attachment(object_name text)
returns boolean language plpgsql stable set search_path='' as $$
declare parts text[] := string_to_array(object_name,'/');
begin
  if array_length(parts,1)<>4 then return false; end if;
  return parts[4]::uuid is not null and private.is_org_member(parts[1]::uuid)
    and private.record_exists(parts[1]::uuid,parts[2]::public.record_type,parts[3]::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function private.can_access_record_attachment(text) from public,anon;
grant execute on function private.can_access_record_attachment(text) to authenticated;
create policy record_attachments_storage_read on storage.objects for select to authenticated
  using(bucket_id='record-attachments' and private.can_access_record_attachment(name));
create policy record_attachments_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='record-attachments' and owner_id=(select auth.uid())::text and private.can_access_record_attachment(name));
create policy record_attachments_storage_cleanup on storage.objects for delete to authenticated
  using(bucket_id='record-attachments' and owner_id=(select auth.uid())::text and private.can_access_record_attachment(name)
    and not exists(select 1 from public.record_attachments a where a.path=name));

create trigger guard_tenant_identity before update on public.record_notes for each row execute function private.guard_tenant_identity();
create trigger guard_tenant_identity before update on public.record_attachments for each row execute function private.guard_tenant_identity();

create function private.log_record_status()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(new.org_id,auth.uid(),tg_argv[0],new.id,'record_status_changed','Status changed',jsonb_build_object('from',old.status,'to',new.status));
  end if;
  return new;
end;
$$;
create trigger log_record_status after update of status on public.quotes for each row execute function private.log_record_status('quote');
create trigger log_record_status after update of status on public.invoices for each row execute function private.log_record_status('invoice');
create trigger log_record_status after update of status on public.projects for each row execute function private.log_record_status('project');
create trigger log_record_status after update of status on public.subscriptions for each row execute function private.log_record_status('subscription');
