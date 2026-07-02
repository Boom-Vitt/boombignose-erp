-- BoomBigNose Company OS — V3 Batch 1 schema (Odoo feature-gap closers)
-- New: quotations/sales-orders (quotes + quote_items), invoice line items
-- (invoice_items), timesheets (time_entries), and recurring billing
-- (subscriptions). Conventions match init_schema: money is bigint satang,
-- org_id on every table, RLS enabled + forced, org-scoped policies via
-- private.is_org_member(org_id), and an updated_at trigger per table.

-- ── Enums ───────────────────────────────────────────────────────────────────
create type quote_status        as enum ('draft','sent','accepted','declined','expired','converted');
create type subscription_status as enum ('active','paused','cancelled');

-- ── Quotations / Sales Orders ───────────────────────────────────────────────
-- A quote is a priced proposal that a client accepts; on acceptance it converts
-- into an invoice (converted_invoice_id). Money is derived from quote_items:
-- subtotal = Σ item amounts; total = subtotal − discount.
create table quotes (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  client_id            uuid not null references clients(id) on delete cascade,
  project_id           uuid references projects(id) on delete set null,
  number               text not null,
  status               quote_status not null default 'draft',
  issue_date           date not null default current_date,
  valid_until          date,
  subtotal_satang      bigint not null default 0,
  discount_satang      bigint not null default 0,
  total_satang         bigint not null default 0,
  notes                text,
  converted_invoice_id uuid references invoices(id) on delete set null,
  owner                uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);

create table quote_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  quote_id         uuid not null references quotes(id) on delete cascade,
  description      text not null,
  quantity         numeric(12,3) not null default 1,
  unit_price_satang bigint not null default 0,
  amount_satang    bigint not null default 0,   -- round(quantity * unit_price_satang), computed in app
  position         int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Invoice line items ──────────────────────────────────────────────────────
-- invoices.amount_satang stays authoritative and is recomputed to Σ item amounts
-- whenever an invoice's items change (in the server action).
create table invoice_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  invoice_id       uuid not null references invoices(id) on delete cascade,
  description      text not null,
  quantity         numeric(12,3) not null default 1,
  unit_price_satang bigint not null default 0,
  amount_satang    bigint not null default 0,
  position         int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Timesheets ──────────────────────────────────────────────────────────────
-- Hours logged against a project (optionally a task). `minutes` keeps it integer;
-- `billable` + `rate_satang` feed utilization and billable-value metrics.
create table time_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  task_id     uuid references project_tasks(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  work_date   date not null default current_date,
  minutes     int not null check (minutes >= 0),
  billable    boolean not null default true,
  rate_satang bigint,                 -- per-hour rate; null = non-billable / unset
  notes       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Recurring billing (subscriptions) ───────────────────────────────────────
-- A subscription generates invoices on a cadence. The cron endpoint scans for
-- rows whose next_run_date <= today and status = 'active', creates an invoice,
-- and advances next_run_date. This is the engine behind the MRR metric.
create table subscriptions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  project_id        uuid references projects(id) on delete set null,
  name              text not null,
  amount_satang     bigint not null default 0,
  interval          recurring_interval not null default 'monthly',
  status            subscription_status not null default 'active',
  start_date        date not null default current_date,
  next_run_date     date not null default current_date,
  last_generated_on date,
  auto_generate     boolean not null default true,
  notes             text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create trigger set_updated_at before update on quotes        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on quote_items   for each row execute function public.set_updated_at();
create trigger set_updated_at before update on invoice_items for each row execute function public.set_updated_at();
create trigger set_updated_at before update on time_entries  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on subscriptions for each row execute function public.set_updated_at();

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index on quotes        (org_id);
create index on quotes        (client_id);
create index on quotes        (org_id, status);
create index on quotes        (project_id);
create index on quote_items   (org_id);
create index on quote_items   (quote_id);
create index on invoice_items (org_id);
create index on invoice_items (invoice_id);
create index on time_entries  (org_id);
create index on time_entries  (project_id);
create index on time_entries  (org_id, user_id, work_date);
create index on time_entries  (task_id);
create index on subscriptions (org_id);
create index on subscriptions (client_id);
create index on subscriptions (org_id, status, next_run_date);

-- ── RLS: enable + force on every new table ──────────────────────────────────
alter table quotes        enable row level security;
alter table quotes        force  row level security;
alter table quote_items   enable row level security;
alter table quote_items   force  row level security;
alter table invoice_items enable row level security;
alter table invoice_items force  row level security;
alter table time_entries  enable row level security;
alter table time_entries  force  row level security;
alter table subscriptions enable row level security;
alter table subscriptions force  row level security;

-- ── Org-scoped CRUD policies ────────────────────────────────────────────────
create policy quotes_rw on quotes
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy quote_items_rw on quote_items
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy invoice_items_rw on invoice_items
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy time_entries_rw on time_entries
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

create policy subscriptions_rw on subscriptions
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
