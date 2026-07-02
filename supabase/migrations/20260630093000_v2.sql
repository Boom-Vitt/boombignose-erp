-- BoomBigNose Company OS — V2 Batch 1 schema
-- New tables: audit_log, saved_views, reminders, outbound_events.
-- Conventions match init_schema: bigint satang (n/a here), org_id on every table,
-- id uuid / created_at / updated_at, RLS enabled + forced, org-scoped policies via
-- private.is_org_member(org_id). audit_log is append-only (no update/delete policy).

-- ── Enums ───────────────────────────────────────────────────────────────────
create type reminder_status  as enum ('pending','sent','cancelled');
create type reminder_channel as enum ('line','email','inapp');
create type outbound_status  as enum ('queued','delivered','failed');

-- ── audit_log (append-only activity history) ────────────────────────────────
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  entity      text not null,          -- 'deal','invoice','payment','settings',...
  entity_id   uuid,
  action      text not null,          -- 'created','updated','deleted','stage_changed',...
  summary     text not null,          -- human sentence, rendered in the feed
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);
create index on audit_log (org_id, entity, entity_id);

-- ── saved_views (per-user saved filters per module) ─────────────────────────
create table saved_views (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  module     text not null,           -- 'deals','finance','clients'
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on saved_views (org_id, module);
create index on saved_views (org_id, user_id, module);

-- ── reminders (follow-up reminders; cron scan upserts via dedup) ────────────
create table reminders (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  entity     text not null,           -- 'deal','activity'
  entity_id  uuid,
  title      text not null,
  due_date   date not null,
  channel    reminder_channel not null default 'inapp',
  status     reminder_status not null default 'pending',
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index on reminders (org_id, due_date);
create index on reminders (org_id, status) where status = 'pending';
-- One reminder per source entity per due date — lets the scan upsert idempotently.
create unique index reminders_dedup_idx on reminders (org_id, entity, entity_id, due_date);

-- ── outbound_events (queue consumed by n8n / Hermes) ────────────────────────
create table outbound_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  event_type   text not null,         -- 'followup.due','deal.stalled','invoice.overdue'
  payload      jsonb not null default '{}'::jsonb,
  status       outbound_status not null default 'queued',
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index on outbound_events (org_id, status, created_at);

-- ── updated_at triggers (tables that carry updated_at) ──────────────────────
create trigger set_updated_at before update on saved_views for each row execute function public.set_updated_at();
create trigger set_updated_at before update on reminders   for each row execute function public.set_updated_at();

-- ── RLS: enable + force on every new table ──────────────────────────────────
alter table audit_log       enable row level security;
alter table audit_log       force  row level security;
alter table saved_views     enable row level security;
alter table saved_views     force  row level security;
alter table reminders       enable row level security;
alter table reminders       force  row level security;
alter table outbound_events enable row level security;
alter table outbound_events force  row level security;

-- audit_log: org members may read and append, but never mutate or delete.
create policy audit_log_select on audit_log
  for select to authenticated
  using (private.is_org_member(org_id));
create policy audit_log_insert on audit_log
  for insert to authenticated
  with check (private.is_org_member(org_id));

-- saved_views / reminders / outbound_events: full CRUD scoped to the caller's org.
create policy saved_views_rw on saved_views
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy reminders_rw on reminders
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy outbound_events_rw on outbound_events
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
