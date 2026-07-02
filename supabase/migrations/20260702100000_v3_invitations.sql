-- BoomBigNose Company OS — V3 Batch 2: team invitations (multi-org UX).
-- The data model is already multi-tenant (org_id everywhere); this adds the
-- invitation flow so an owner/admin can invite teammates by email, and the
-- invitee accepts by token to gain a membership. Conventions match the rest:
-- org_id on the table, RLS enabled + forced, org-scoped policy via
-- private.is_org_member(org_id). The ACCEPT path runs server-side with the
-- service-role client (the invitee is not yet a member, so RLS would hide the
-- row) — see app/(app)/settings/org-actions.ts.

create type invitation_status as enum ('pending','accepted','revoked','expired');

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        role_enum not null default 'member',
  token       text not null unique,
  status      invitation_status not null default 'pending',
  invited_by  uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One live invite per email per org (re-inviting updates the same row).
  unique (org_id, email)
);

create trigger set_updated_at before update on invitations
  for each row execute function public.set_updated_at();

create index on invitations (org_id);
create index on invitations (org_id, status);
create index on invitations (token);

alter table invitations enable row level security;
alter table invitations force  row level security;

-- Org members can see and manage their org's invitations. Accepting by token is
-- done with the service-role client (bypasses RLS) after validating the token,
-- because the invitee has no membership yet.
create policy invitations_rw on invitations
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
