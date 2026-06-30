-- BoomBigNose Company OS — RLS policies, membership helpers, new-user trigger.
-- Isolation is enforced HERE (not in app code). Every table: enable + force RLS.

-- ── Membership helpers (SECURITY DEFINER → recursion-safe) ──────────────────
create schema if not exists private;

-- Bypasses RLS on memberships (runs as owner), so it can be called from inside
-- the memberships/organizations policies without infinite recursion.
create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
  );
$$;

-- True when the current user shares any org with target_user (for name display).
create or replace function private.shares_org(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = (select auth.uid())
      and m2.user_id = target_user
  );
$$;

revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.shares_org(uuid)    from public, anon;
grant  execute on function private.is_org_member(uuid) to authenticated;
grant  execute on function private.shares_org(uuid)    to authenticated;

-- ── Auto-create a profile when an auth user is created ──────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Enable + force RLS on every table ───────────────────────────────────────
alter table organizations        enable row level security;
alter table organizations        force  row level security;
alter table profiles             enable row level security;
alter table profiles             force  row level security;
alter table memberships          enable row level security;
alter table memberships          force  row level security;
alter table clients              enable row level security;
alter table clients              force  row level security;
alter table contacts             enable row level security;
alter table contacts             force  row level security;
alter table deals                enable row level security;
alter table deals                force  row level security;
alter table activities           enable row level security;
alter table activities           force  row level security;
alter table projects             enable row level security;
alter table projects             force  row level security;
alter table project_tasks        enable row level security;
alter table project_tasks        force  row level security;
alter table milestones           enable row level security;
alter table milestones           force  row level security;
alter table invoices             enable row level security;
alter table invoices             force  row level security;
alter table payments             enable row level security;
alter table payments             force  row level security;
alter table costs                enable row level security;
alter table costs                force  row level security;
alter table template_categories  enable row level security;
alter table template_categories  force  row level security;
alter table automation_templates enable row level security;
alter table automation_templates force  row level security;

-- ── Org / Auth policies ─────────────────────────────────────────────────────
-- A user sees only their own membership rows (no helper → no recursion).
create policy memberships_select_own on memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy organizations_select on organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy profiles_select on profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org(id));

create policy profiles_update_own on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── Business tables: full CRUD scoped to the caller's org ───────────────────
create policy clients_rw on clients
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy contacts_rw on contacts
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy deals_rw on deals
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy activities_rw on activities
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy projects_rw on projects
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy project_tasks_rw on project_tasks
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy milestones_rw on milestones
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy invoices_rw on invoices
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy payments_rw on payments
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy costs_rw on costs
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy template_categories_rw on template_categories
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy automation_templates_rw on automation_templates
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
