-- Creates the first workspace for a newly confirmed ANY ERP user.
--
-- A user may only create a workspace for their own authenticated identity.
-- The function runs with elevated database privileges because normal members
-- cannot create organizations or memberships through the public Data API.

create or replace function public.create_workspace_for_current_user(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := btrim(workspace_name);
  existing_org_id uuid;
  new_org_id uuid;
  base_slug text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select org_id
    into existing_org_id
    from public.memberships
   where user_id = current_user_id
   order by created_at asc
   limit 1;

  if existing_org_id is not null then
    return existing_org_id;
  end if;

  if char_length(normalized_name) < 2 or char_length(normalized_name) > 80 then
    raise exception 'Workspace name must be between 2 and 80 characters.';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(normalized_name), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then
    base_slug := 'workspace';
  end if;

  insert into public.organizations (name, slug)
  values (
    normalized_name,
    left(base_slug, 48) || '-' || left(current_user_id::text, 8)
  )
  returning id into new_org_id;

  insert into public.memberships (org_id, user_id, role)
  values (new_org_id, current_user_id, 'owner');

  insert into public.org_settings (org_id)
  values (new_org_id)
  on conflict (org_id) do nothing;

  return new_org_id;
end;
$$;

revoke all on function public.create_workspace_for_current_user(text) from public, anon;
grant execute on function public.create_workspace_for_current_user(text) to authenticated;
