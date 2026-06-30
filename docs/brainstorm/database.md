# Database Schema — BoomBigNose Company OS

Implementation-ready schema for Supabase Postgres. Internal operational layer for a Thai AI studio: CRM, project delivery, finance visibility, and reusable templates/automation. Internal-first, multi-tenant-ready.

## Locked conventions

- **Tenancy:** `org_id uuid not null references organizations(id) on delete cascade` on **every business table**. Two deliberate exceptions: `organizations` *is* the tenant (PK only), and `profiles` is keyed to a user who may belong to multiple orgs (user-global, no `org_id`). All other 13 tables carry `org_id`.
- **Money:** integer minor units (**satang**) in `bigint` columns. Never float/numeric for money. `100 satang = 1 THB`.
- **Identity:** Supabase `auth.users`; `profiles.id` equals the auth user id.
- **Every table:** `id uuid default gen_random_uuid() primary key`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (kept current by a shared trigger). **Two id exceptions:** `profiles.id` has **no** default (it must equal `auth.users.id`), and `memberships` adds `unique(user_id, org_id)`.
- **Isolation:** enforced by RLS via `memberships`, never by app code alone.

Below, every table implicitly has `id`, `created_at`, `updated_at`. `FK` means `references … on delete cascade` unless noted.

---

## 1. Table-by-table breakdown

### Org / Auth

**organizations** — `name text not null`, `slug text not null unique`. No `org_id` (it is the tenant root).

**profiles** — `id uuid primary key references auth.users(id) on delete cascade` (no default), `full_name text`, `avatar_url text`, `locale text not null default 'th'`. User-global; no `org_id`.

**memberships** — `org_id` FK, `user_id uuid not null references auth.users(id) on delete cascade`, `role role_enum not null default 'member'`, `unique(user_id, org_id)`. The join table that drives all RLS.

### CRM

**clients** — `org_id` FK, `name text not null`, `industry text`, `source text`, `notes text`, `owner uuid references auth.users(id) on delete set null`.

**contacts** — `org_id` FK, `client_id uuid not null` FK → clients, `name text not null`, `email text`, `phone text`, `role text`.

**deals** — `org_id` FK, `client_id uuid not null` FK → clients, `title text not null`, `stage deal_stage not null default 'lead'`, `value_satang bigint not null default 0`, `currency char(3) not null default 'THB'`, `expected_close_date date`, `next_follow_up_date date`, `source text`, `notes text`, `owner uuid references auth.users(id) on delete set null`.

**activities** — follow-ups/notes/calls. `org_id` FK, `client_id uuid` FK → clients (nullable), `deal_id uuid` FK → deals (nullable), `type activity_type not null default 'note'`, `due_date date`, `done boolean not null default false`, `body text`, `owner uuid references auth.users(id) on delete set null`. At least one of `client_id`/`deal_id` expected (app-enforced).

### Projects

**projects** — `org_id` FK, `deal_id uuid` FK → deals `on delete set null` (optional won-deal link), `client_id uuid` FK → clients (nullable), `name text not null`, `status project_status not null default 'not_started'`, `deadline date`, `budget_satang bigint`, `owner uuid references auth.users(id) on delete set null`.

**project_tasks** — `org_id` FK, `project_id uuid not null` FK → projects, `title text not null`, `status task_status not null default 'todo'`, `assignee uuid references auth.users(id) on delete set null`, `due_date date`, `done boolean not null default false`.

**milestones** — project checklist. `org_id` FK, `project_id uuid not null` FK → projects, `title text not null`, `done boolean not null default false`, `due_date date`. Uses a `done` boolean (no status enum), per spec.

### Finance

**invoices** — `org_id` FK, `client_id uuid not null` FK → clients, `project_id uuid` FK → projects `on delete set null` (optional), `number text not null`, `status invoice_status not null default 'draft'`, `issue_date date not null default current_date`, `due_date date`, `amount_satang bigint not null default 0`, `is_recurring boolean not null default false`, `recurring_interval recurring_interval`, `notes text`, `unique(org_id, number)`.

**payments** — `org_id` FK, `invoice_id uuid not null` FK → invoices, `amount_satang bigint not null`, `paid_at timestamptz not null default now()`, `method payment_method not null default 'transfer'`, `notes text`.

**costs** — `org_id` FK, `project_id uuid` FK → projects `on delete set null` (optional), `category cost_category not null default 'other'`, `amount_satang bigint not null`, `incurred_on date not null default current_date`, `vendor text`, `notes text`.

### Templates

**template_categories** — `org_id` FK, `name text not null`, `slug text not null`, `unique(org_id, slug)`.

**automation_templates** — `org_id` FK, `category_id uuid` FK → template_categories `on delete set null`, `name text not null`, `description text`, `internal_value_satang bigint`, `price_satang bigint`, `reusable_notes text`, `implementation_checklist jsonb not null default '[]'::jsonb`, `tags text[] not null default '{}'`.

---

## 2. Entity-relationship summary

```
auth.users ──1:1── profiles
auth.users ──< memberships >── organizations         (M:N, role per pair)

organizations ──< clients ──< contacts
                       │└──< deals ──< activities
                       │         └──< projects ──< project_tasks
                       │                     │└──< milestones
                       │                     └──< costs
                       └──< invoices ──< payments
                       └──< template_categories ──< automation_templates

deal ──0..1──> project   (won deal may spawn a project)
project ──0..1──> invoice/cost   (optional project link)
```

Every box except `organizations`/`profiles` also carries `org_id` pointing back to the owning organization — the redundant-but-flat tenant key that keeps RLS a single indexed predicate instead of a multi-join.

---

## 3. Enum definitions

```sql
create type role_enum         as enum ('owner','admin','member');
create type deal_stage        as enum ('lead','contacted','discovery','proposal','negotiation','won','lost');
create type project_status    as enum ('not_started','in_progress','review','delivered','support','paused','cancelled');
create type invoice_status    as enum ('draft','sent','partially_paid','paid','overdue','cancelled');
create type task_status       as enum ('todo','in_progress','done');
create type activity_type     as enum ('note','call','email','meeting','follow_up');
create type payment_method    as enum ('transfer','cash','card','promptpay','cheque','other');
create type recurring_interval as enum ('weekly','monthly','quarterly','yearly');
create type cost_category     as enum ('software','contractor','infra','marketing','salary','other');
```

`task_status` applies to `project_tasks`; milestones intentionally use a `done` boolean. `cost_category`, `activity_type`, `payment_method`, and `recurring_interval` are modeled as enums for clean dashboard grouping; widen with `alter type … add value` as needs grow.

---

## 4. Indexes

RLS makes `org_id` the hottest predicate on every table, so it is indexed everywhere. Plus each FK and each common filter/sort column.

```sql
-- org_id on all 13 tenant tables
create index on memberships          (org_id);
create index on clients              (org_id);
create index on contacts             (org_id);
create index on deals                (org_id);
create index on activities           (org_id);
create index on projects             (org_id);
create index on project_tasks        (org_id);
create index on milestones           (org_id);
create index on invoices             (org_id);
create index on payments             (org_id);
create index on costs                (org_id);
create index on template_categories  (org_id);
create index on automation_templates (org_id);

-- membership lookup driving RLS (user → orgs)
create index on memberships (user_id);

-- foreign keys
create index on contacts             (client_id);
create index on deals                (client_id);
create index on activities           (client_id);
create index on activities           (deal_id);
create index on projects             (deal_id);
create index on projects             (client_id);
create index on project_tasks        (project_id);
create index on milestones           (project_id);
create index on invoices             (client_id);
create index on invoices             (project_id);
create index on payments             (invoice_id);
create index on costs                (project_id);
create index on automation_templates (category_id);

-- common filter / sort columns
create index on deals      (org_id, stage);
create index on deals      (org_id, next_follow_up_date);
create index on invoices   (org_id, status);
create index on invoices   (org_id, due_date);
create index on activities (org_id, due_date) where done = false;  -- open follow-ups
create index on project_tasks (org_id, status) where done = false;
create index on projects   (org_id, status);
create index on automation_templates using gin (tags);            -- tag filtering
```

---

## 5. RLS policy patterns

**Helper.** A `SECURITY DEFINER` function in a private schema does the membership check. This is the load-bearing piece: because a `SECURITY DEFINER` function runs as its owner and **bypasses RLS on the tables it reads**, it can query `memberships` from *inside* the `memberships` / `organizations` policies without triggering infinite policy recursion. Wrapping `auth.uid()` in a `select` evaluates it once per query, not per row.

```sql
create schema if not exists private;

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

revoke execute on function private.is_org_member(uuid) from public, anon;
grant  execute on function private.is_org_member(uuid) to authenticated;
```

**Pattern applied per table** (all `to authenticated`; `enable` + `force row level security` on every table):

- **memberships** → `using (user_id = (select auth.uid()))` — a user sees only their own membership rows; avoids recursion by not calling the helper.
- **organizations** → `using (private.is_org_member(id))`.
- **profiles** → `using (id = (select auth.uid()))` for write; `select` may be broadened to co-members later.
- **All 12 other tenant tables** → `using (private.is_org_member(org_id))` for `select/update/delete`, and `with check (private.is_org_member(org_id))` for `insert/update` so rows can never be written into a foreign org.

Reads run under `select`/`using`; writes additionally validate `with check`. For most tables a single `for all` policy covers all four verbs; split per-verb only where `owner`/`admin` should differ (e.g. members read deals but only admins delete).

Concrete examples:

```sql
-- Deals: members of the org get full CRUD, scoped to their org
alter table deals enable row level security;
alter table deals force  row level security;

create policy deals_rw on deals
  for all to authenticated
  using      (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Invoices: everyone in org can read; only owner/admin may delete
create policy invoices_select on invoices
  for select to authenticated
  using (private.is_org_member(org_id));

create policy invoices_delete on invoices
  for delete to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.org_id = invoices.org_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  ));
```

---

## 6. Seed strategy (works under RLS)

RLS would block ordinary seed inserts, so **seed with the service role** (`service_role` bypasses RLS) and use **deterministic, hardcoded UUID literals** so the script re-runs idempotently and every child row points at the same org/user.

1. **Demo org** — insert `organizations` with a fixed literal, e.g. `'00000000-0000-0000-0000-000000000001'`.
2. **Demo auth user** — create via the Auth Admin API / service role (`auth.admin.createUser`, or `supabase auth` in seed), with a fixed id `'00000000-0000-0000-0000-0000000000aa'` and a known email/password (e.g. `demo@boombignose.org`). The `profiles` row (same id) is created by an `on auth.users` trigger or inserted explicitly.
3. **Membership** — insert `memberships(user_id = demo user, org_id = demo org, role = 'owner')`. **This single row is what maps the demo login to the demo org** — without it, RLS returns zero rows and the dashboard renders empty even though data exists.
4. **All demo data** (clients, deals, projects, invoices, templates, …) inserted with the **same `org_id`**, using service role so inserts bypass RLS.

Use `insert … on conflict (id) do nothing` (and `on conflict (user_id, org_id)` for memberships) so the seed is safe to re-run. When QA logs in as `demo@boombignose.org`, their `auth.uid()` resolves through that membership to the demo org and the dashboard populates.

---

## 7. Migration file structure (`supabase/migrations`)

Ordered, timestamp-prefixed; each file is idempotent where practical.

```
supabase/migrations/
  20260630090000_extensions.sql          -- pgcrypto/gen_random_uuid, set_updated_at() trigger fn
  20260630090100_enums.sql               -- all create type … as enum
  20260630090200_org_auth.sql            -- organizations, profiles (+auth.users trigger), memberships
  20260630090300_crm.sql                 -- clients, contacts, deals, activities
  20260630090400_projects.sql            -- projects, project_tasks, milestones
  20260630090500_finance.sql             -- invoices, payments, costs
  20260630090600_templates.sql           -- template_categories, automation_templates
  20260630090700_indexes.sql             -- all indexes (section 4)
  20260630090800_rls.sql                 -- private schema, is_org_member(), enable/force RLS, policies
  20260630090900_seed_helpers.sql        -- optional service-role-only seed routines
supabase/seed.sql                        -- demo org + demo user mapping + demo data (service role)
```

Tables before indexes before RLS; enums first so column types resolve. Keep the `updated_at` trigger function in the first migration and attach it (`create trigger … before update`) inside each table's migration.
