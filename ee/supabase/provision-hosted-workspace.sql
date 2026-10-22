-- Install after the shared migrations for licensed Pro deployments only.
create or replace function public.provision_hosted_workspace(p_name text,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); request public.workspace_requests; target uuid;
begin
  if actor is null or p_key is null or p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid workspace request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('boombignose-community-workspace',0));
  insert into public.workspace_requests(user_id,key,name) values(actor,p_key,btrim(p_name)) on conflict do nothing;
  select * into request from public.workspace_requests where user_id=actor and key=p_key for update;
  if request.name<>btrim(p_name) then raise exception 'Idempotency conflict'; end if;
  if request.org_id is not null then
    if not exists(select 1 from public.memberships where user_id=actor and org_id=request.org_id) then raise exception 'Workspace membership unavailable'; end if;
    return request.org_id;
  end if;
  target:=gen_random_uuid();
  insert into public.organizations(id,name,slug) values(target,btrim(p_name),'workspace-'||target::text);
  insert into public.memberships(org_id,user_id,role) values(target,actor,'owner');
  insert into public.org_settings(org_id) values(target);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(target,actor,'workspace',target,'workspace_provisioned','Workspace and owner provisioned');
  update public.workspace_requests set org_id=target where user_id=actor and key=p_key;
  return target;
end;
$$;
revoke all on function public.provision_hosted_workspace(text,uuid) from public,anon,service_role;
grant execute on function public.provision_hosted_workspace(text,uuid) to authenticated;
