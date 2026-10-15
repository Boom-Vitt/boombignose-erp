-- Two-factor was enforced only by the Next.js proxy, so a password-only (aal1)
-- session could read and write org data straight through the REST API. The
-- database now requires aal2 from every user who has a verified factor.

create or replace function private.mfa_satisfied()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal'), '') = 'aal2'
    or not exists(select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified');
$$;
revoke all on function private.mfa_satisfied() from public, anon;
grant execute on function private.mfa_satisfied() to authenticated;

-- Restrictive policies AND with every permissive one, covering tables whose
-- policies check auth.uid() directly instead of the membership helpers.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format(
      'create policy mfa_assurance on public.%I as restrictive to authenticated '
      'using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))',
      t.tablename);
  end loop;
end $$;

-- Security-definer RPCs bypass RLS; most authorize through these two helpers.
create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
  ) and private.mfa_satisfied();
$$;

create or replace function private.is_org_staff(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where org_id=target_org
    and user_id=(select auth.uid()) and role in ('owner','admin'))
    and private.mfa_satisfied();
$$;

create or replace function private.shares_org(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = (select auth.uid())
      and m2.user_id = target_user
  ) and private.mfa_satisfied();
$$;

-- The two RPCs that check auth.uid() themselves: unchanged except the aal guard.
create or replace function public.accept_workspace_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); email text; invitation public.invitations;
begin
  if actor is null or p_token is null or length(p_token)>200 then raise exception 'Invalid invitation'; end if;
  if not private.mfa_satisfied() then raise exception 'Two-factor verification required'; end if;
  select lower(u.email) into email from auth.users u where id=actor and u.email_confirmed_at is not null;
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

create or replace function public.provision_workspace(p_name text, p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); request public.workspace_requests; target uuid;
begin
  if actor is null or p_key is null or p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid workspace request'; end if;
  if not private.mfa_satisfied() then raise exception 'Two-factor verification required'; end if;
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
