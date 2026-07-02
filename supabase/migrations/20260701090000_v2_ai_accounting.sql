-- BoomBigNose Company OS — V2 Batch 2 schema
-- New tables: ai_outputs (cached AI artifacts), accounting_connections +
-- accounting_sync_map (external book-of-record sync scaffold: FlowAccount/PEAK/Xero).
-- Conventions match init_schema: org_id everywhere, RLS enabled + forced,
-- org-scoped policies via private.is_org_member(org_id).

-- ── Enums ───────────────────────────────────────────────────────────────────
create type ai_output_kind         as enum ('deal_summary','followup_draft','meeting_intake');
create type accounting_provider    as enum ('flowaccount','peak','xero');
create type accounting_conn_status as enum ('disconnected','connected','error');
create type accounting_sync_status as enum ('pending','synced','error');

-- ── ai_outputs (cache of generated summaries / drafts / intake) ─────────────
create table ai_outputs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  entity     text not null,           -- 'deal','client', ...
  entity_id  uuid,
  kind       ai_output_kind not null,
  model      text,                    -- e.g. 'claude-...' or null when unconfigured
  content    text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on ai_outputs (org_id, entity, entity_id, created_at desc);
create index on ai_outputs (org_id, kind, created_at desc);

-- ── accounting_connections (one external book-of-record per org) ────────────
create table accounting_connections (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  provider   accounting_provider not null,
  status     accounting_conn_status not null default 'disconnected',
  -- Non-secret settings only (e.g. default ledger, org ref). Real OAuth tokens /
  -- API keys are handled server-side later, never stored here in plaintext.
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

-- ── accounting_sync_map (our record ↔ external id) ──────────────────────────
create table accounting_sync_map (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  provider       accounting_provider not null,
  local_entity   text not null,       -- 'invoice','client'
  local_id       uuid not null,
  external_id    text,
  status         accounting_sync_status not null default 'pending',
  last_error     text,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, provider, local_entity, local_id)
);
create index on accounting_sync_map (org_id, local_entity, local_id);
create index on accounting_sync_map (org_id, status);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create trigger set_updated_at before update on accounting_connections for each row execute function public.set_updated_at();
create trigger set_updated_at before update on accounting_sync_map    for each row execute function public.set_updated_at();

-- ── RLS: enable + force on every new table ──────────────────────────────────
alter table ai_outputs             enable row level security;
alter table ai_outputs             force  row level security;
alter table accounting_connections enable row level security;
alter table accounting_connections force  row level security;
alter table accounting_sync_map    enable row level security;
alter table accounting_sync_map    force  row level security;

-- Org-scoped CRUD. Sensitive writes (connect/disconnect, sync) are additionally
-- gated to owner/admin in the server actions via requireRole().
create policy ai_outputs_rw on ai_outputs
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy accounting_connections_rw on accounting_connections
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy accounting_sync_map_rw on accounting_sync_map
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
