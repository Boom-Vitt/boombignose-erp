-- BoomBigNose Company OS — initial schema
-- Conventions: money is bigint satang; org_id on every business table;
-- id uuid / created_at / updated_at on every table (two id exceptions noted).

create extension if not exists pgcrypto;

-- Shared trigger to keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Enums ──────────────────────────────────────────────────────────────────
create type role_enum          as enum ('owner','admin','member');
create type deal_stage         as enum ('lead','contacted','discovery','proposal','negotiation','won','lost');
create type project_status     as enum ('not_started','in_progress','review','delivered','support','paused','cancelled');
create type invoice_status     as enum ('draft','sent','partially_paid','paid','overdue','cancelled');
create type task_status        as enum ('todo','in_progress','done');
create type activity_type      as enum ('note','call','email','meeting','follow_up');
create type payment_method     as enum ('transfer','cash','card','promptpay','cheque','other');
create type recurring_interval as enum ('weekly','monthly','quarterly','yearly');
create type cost_category      as enum ('software','contractor','infra','marketing','salary','other');

-- ── Org / Auth ─────────────────────────────────────────────────────────────
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- profiles.id == auth.users.id (no default).
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  avatar_url text,
  locale     text not null default 'th',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       role_enum not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id)
);

-- ── CRM ────────────────────────────────────────────────────────────────────
create table clients (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  industry   text,
  source     text,
  notes      text,
  owner      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  role       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deals (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  client_id           uuid not null references clients(id) on delete cascade,
  title               text not null,
  stage               deal_stage not null default 'lead',
  value_satang        bigint not null default 0,
  currency            char(3) not null default 'THB',
  expected_close_date date,
  next_follow_up_date date,
  source              text,
  notes               text,
  owner               uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  client_id  uuid references clients(id) on delete cascade,
  deal_id    uuid references deals(id) on delete cascade,
  type       activity_type not null default 'note',
  due_date   date,
  done       boolean not null default false,
  body       text,
  owner      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Projects ───────────────────────────────────────────────────────────────
create table projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  deal_id       uuid references deals(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  name          text not null,
  status        project_status not null default 'not_started',
  deadline      date,
  budget_satang bigint,
  owner         uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_tasks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title      text not null,
  status     task_status not null default 'todo',
  assignee   uuid references auth.users(id) on delete set null,
  due_date   date,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table milestones (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  due_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Finance ────────────────────────────────────────────────────────────────
create table invoices (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  client_id          uuid not null references clients(id) on delete cascade,
  project_id         uuid references projects(id) on delete set null,
  number             text not null,
  status             invoice_status not null default 'draft',
  issue_date         date not null default current_date,
  due_date           date,
  amount_satang      bigint not null default 0,
  is_recurring       boolean not null default false,
  recurring_interval recurring_interval,
  notes              text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  invoice_id    uuid not null references invoices(id) on delete cascade,
  amount_satang bigint not null,
  paid_at       timestamptz not null default now(),
  method        payment_method not null default 'transfer',
  notes         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table costs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  project_id    uuid references projects(id) on delete set null,
  category      cost_category not null default 'other',
  amount_satang bigint not null,
  incurred_on   date not null default current_date,
  vendor        text,
  notes         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Templates ──────────────────────────────────────────────────────────────
create table template_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  slug       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table automation_templates (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  category_id              uuid references template_categories(id) on delete set null,
  name                     text not null,
  description              text,
  internal_value_satang    bigint,
  price_satang             bigint,
  reusable_notes           text,
  implementation_checklist jsonb not null default '[]'::jsonb,
  tags                     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create trigger set_updated_at before update on organizations        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on profiles             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on memberships          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on clients              for each row execute function public.set_updated_at();
create trigger set_updated_at before update on contacts             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on deals                for each row execute function public.set_updated_at();
create trigger set_updated_at before update on activities           for each row execute function public.set_updated_at();
create trigger set_updated_at before update on projects             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on project_tasks        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on milestones           for each row execute function public.set_updated_at();
create trigger set_updated_at before update on invoices             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on payments             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on costs                for each row execute function public.set_updated_at();
create trigger set_updated_at before update on template_categories  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on automation_templates for each row execute function public.set_updated_at();

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index on memberships          (org_id);
create index on memberships          (user_id);
create index on clients              (org_id);
create index on contacts             (org_id);
create index on contacts             (client_id);
create index on deals                (org_id);
create index on deals                (client_id);
create index on deals                (org_id, stage);
create index on deals                (org_id, next_follow_up_date);
create index on activities           (org_id);
create index on activities           (client_id);
create index on activities           (deal_id);
create index on activities           (org_id, due_date) where done = false;
create index on projects             (org_id);
create index on projects             (deal_id);
create index on projects             (client_id);
create index on projects             (org_id, status);
create index on project_tasks        (org_id);
create index on project_tasks        (project_id);
create index on project_tasks        (org_id, status) where done = false;
create index on milestones           (org_id);
create index on milestones           (project_id);
create index on invoices             (org_id);
create index on invoices             (client_id);
create index on invoices             (project_id);
create index on invoices             (org_id, status);
create index on invoices             (org_id, due_date);
create index on payments             (org_id);
create index on payments             (invoice_id);
create index on costs                (org_id);
create index on costs                (project_id);
create index on template_categories  (org_id);
create index on automation_templates (org_id);
create index on automation_templates (category_id);
create index on automation_templates using gin (tags);
