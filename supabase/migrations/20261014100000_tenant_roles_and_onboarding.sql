-- Coordinator-owned tenant/role/onboarding batch. Existing violations abort the
-- upgrade; no record is silently repaired, reassigned, certified or deleted.
create or replace function private.guard_tenant_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.org_id<>old.org_id or new.id<>old.id then raise exception 'Tenant and record identity are immutable'; end if;
  return new;
end;
$$;
do $$
declare t record; fk record; delete_rule text;
begin
  -- Qualify every real FK between tenant-owned records, preserving nullable
  -- references with SET NULL(column) so their non-null org_id remains intact.
  for t in select c.oid,c.relname,a.attnum org_att,b.attnum id_att from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_attribute a on a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped
    join pg_attribute b on b.attrelid=c.oid and b.attname='id' and not b.attisdropped
    where c.relkind='r'
  loop
    if not exists(select 1 from pg_constraint where conrelid=t.oid and contype in ('p','u') and conkey=array[t.org_att,t.id_att]::smallint[]) then
      execute format('alter table public.%I add constraint %I unique(org_id,id)',t.relname,t.relname||'_tenant_identity_key');
    end if;
    execute format('create trigger guard_tenant_identity before update on public.%I for each row execute function private.guard_tenant_identity()',t.relname);
  end loop;
  for fk in select con.conname,child.relname child,parent.relname parent,col.attname column_name,con.confdeltype,con.condeferrable,con.condeferred
    from pg_constraint con join pg_class child on child.oid=con.conrelid join pg_class parent on parent.oid=con.confrelid
    join pg_namespace nc on nc.oid=child.relnamespace and nc.nspname='public'
    join pg_namespace np on np.oid=parent.relnamespace and np.nspname='public'
    join pg_attribute col on col.attrelid=child.oid and col.attnum=con.conkey[1]
    join pg_attribute ref on ref.attrelid=parent.oid and ref.attnum=con.confkey[1] and ref.attname='id'
    where con.contype='f' and array_length(con.conkey,1)=1
      and exists(select 1 from pg_attribute where attrelid=child.oid and attname='org_id' and not attisdropped)
      and exists(select 1 from pg_attribute where attrelid=parent.oid and attname='org_id' and not attisdropped)
  loop
    delete_rule:=case fk.confdeltype when 'c' then 'cascade' when 'r' then 'restrict' when 'n' then format('set null (%I)',fk.column_name) else 'no action' end;
    execute format('alter table public.%I drop constraint %I',fk.child,fk.conname);
    execute format('alter table public.%I add constraint %I foreign key(org_id,%I) references public.%I(org_id,id) on delete %s %s',
      fk.child,fk.conname||'_tenant',fk.column_name,fk.parent,delete_rule,
      case when fk.condeferrable then 'deferrable '||case when fk.condeferred then 'initially deferred' else 'initially immediate' end else '' end);
  end loop;
end $$;

do $$
declare t text; p record; restricted boolean;
begin
  foreach t in array array['clients','contacts','deals','activities','projects','project_tasks','milestones','invoices','invoice_items','costs','quotes','quote_items','time_entries','subscriptions','org_settings','template_categories','automation_templates','accounting_connections','accounting_sync_map','invitations']
  loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    restricted:=t in ('org_settings','template_categories','automation_templates','accounting_connections','accounting_sync_map','invitations','subscriptions','invoices','invoice_items');
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.%s(org_id))',t,
      case when t in ('invitations','accounting_connections','accounting_sync_map') then 'is_org_staff' else 'is_org_member' end);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check(private.%s(org_id))',t,case when restricted then 'is_org_staff' else 'is_org_member' end);
    execute format('create policy tenant_update on public.%I for update to authenticated using(private.%s(org_id)) with check(private.%s(org_id))',t,
      case when restricted then 'is_org_staff' else 'is_org_member' end,case when restricted then 'is_org_staff' else 'is_org_member' end);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using(private.%s(org_id))',t,
      case when restricted or t in ('clients','deals','quotes','costs') then 'is_org_staff' else 'is_org_member' end);
  end loop;
end $$;
create policy organizations_staff_update on public.organizations for update to authenticated using(private.is_org_staff(id)) with check(private.is_org_staff(id));

create or replace function private.guard_invitation_authority()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' then
    if new.role='owner' or (tg_op='UPDATE' and old.role='owner') then
      if not exists(select 1 from public.memberships where org_id=new.org_id and user_id=auth.uid() and role='owner') then
        raise exception 'Only an owner can offer an owner role'; end if;
    end if;
    if new.status not in ('pending','revoked') or new.accepted_by is not null then raise exception 'Invitation acceptance requires the authenticated recipient command'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_invitation_authority before insert or update on public.invitations for each row execute function private.guard_invitation_authority();

create table public.workspace_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  key uuid not null,
  name text not null,
  org_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,key)
);
alter table public.workspace_requests enable row level security;
alter table public.workspace_requests force row level security;
revoke all on public.workspace_requests from authenticated,anon;
create or replace function public.provision_workspace(p_name text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); request public.workspace_requests; target uuid;
begin
  if actor is null or p_key is null or p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid workspace request'; end if;
  insert into public.workspace_requests(user_id,key,name) values(actor,p_key,btrim(p_name)) on conflict do nothing;
  select * into request from public.workspace_requests where user_id=actor and key=p_key for update;
  if request.name<>btrim(p_name) then raise exception 'Idempotency conflict'; end if;
  if request.org_id is not null then return request.org_id; end if;
  target:=gen_random_uuid();
  insert into public.organizations(id,name,slug) values(target,btrim(p_name),'workspace-'||target::text);
  insert into public.memberships(org_id,user_id,role) values(target,actor,'owner');
  insert into public.org_settings(org_id) values(target);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(target,actor,'workspace',target,'workspace_provisioned','Workspace and owner provisioned');
  update public.workspace_requests set org_id=target where user_id=actor and key=p_key;
  return target;
end;
$$;
revoke all on function public.provision_workspace(text,uuid) from public,anon,service_role;
grant execute on function public.provision_workspace(text,uuid) to authenticated;

create or replace function public.accept_workspace_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); email text; invitation public.invitations;
begin
  if actor is null or p_token is null or length(p_token)>200 then raise exception 'Invalid invitation'; end if;
  select lower(u.email) into email from auth.users u where id=actor;
  if email is null or email='' then raise exception 'Verified recipient email required'; end if;
  select * into invitation from public.invitations where token=p_token for update;
  if not found or lower(invitation.email)<>email then raise exception 'Invitation unavailable for this recipient'; end if;
  if invitation.status='accepted' and invitation.accepted_by=actor and private.is_org_member(invitation.org_id) then return invitation.org_id; end if;
  if invitation.status<>'pending' or (invitation.expires_at is not null and invitation.expires_at<=now()) then raise exception 'Invitation expired or revoked'; end if;
  insert into public.memberships(org_id,user_id,role) values(invitation.org_id,actor,invitation.role) on conflict(user_id,org_id) do nothing;
  update public.invitations set status='accepted',accepted_by=actor where id=invitation.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(invitation.org_id,actor,'invitation',invitation.id,'invitation_accepted','Intended recipient accepted invitation');
  return invitation.org_id;
end;
$$;
revoke all on function public.accept_workspace_invitation(text) from public,anon,service_role;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
