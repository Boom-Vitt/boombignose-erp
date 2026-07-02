-- BoomBigNose Company OS — V3 Batch 4 (P3): product catalog, expense approval,
-- quote e-signature, and web-to-lead capture. Conventions unchanged: money is
-- bigint satang, org_id on business tables, RLS enabled + forced, org-scoped
-- policy via private.is_org_member(org_id).

-- ── Enums ───────────────────────────────────────────────────────────────────
create type product_kind         as enum ('service','good');
create type cost_approval_status as enum ('pending','approved','rejected');

-- ── Product / service catalog (speeds up line-item entry) ───────────────────
create table products (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  description       text,
  kind              product_kind not null default 'service',
  unit_price_satang bigint not null default 0,
  active            boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on products
  for each row execute function public.set_updated_at();

create index on products (org_id);
create index on products (org_id, active);

alter table products enable row level security;
alter table products force  row level security;

create policy products_rw on products
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ── Expense approval on costs ───────────────────────────────────────────────
-- Existing costs default to 'pending' (still counted toward burn — only
-- 'rejected' costs are excluded by the metrics layer), so behavior is unchanged
-- until someone rejects a cost.
alter table costs add column approval_status cost_approval_status not null default 'pending';
alter table costs add column approved_by     uuid references auth.users(id) on delete set null;
alter table costs add column approved_at      timestamptz;

create index on costs (org_id, approval_status);

-- ── Quote e-signature ───────────────────────────────────────────────────────
-- Captured when a quote is accepted (internally or via the client portal).
alter table quotes add column signed_name text;
alter table quotes add column signed_at   timestamptz;

-- ── Web-to-lead capture ─────────────────────────────────────────────────────
-- Opt-in per org; the public lead form lives at /lead/[slug] and creates a
-- client + a 'lead'-stage deal via the service-role client.
alter table organizations add column lead_capture_enabled boolean not null default false;
