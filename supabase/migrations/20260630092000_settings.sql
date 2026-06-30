-- Per-org settings: manual cash balance (for runway) and optional burn override.
create table org_settings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null unique references organizations(id) on delete cascade,
  cash_balance_satang bigint not null default 0,
  monthly_burn_satang bigint,            -- optional manual override; null = compute from costs
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on org_settings (org_id);

create trigger set_updated_at before update on org_settings
  for each row execute function public.set_updated_at();

alter table org_settings enable row level security;
alter table org_settings force  row level security;

create policy org_settings_rw on org_settings
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
