-- Scheduled date and source identity, never display names, identify commands.
alter table public.subscriptions drop constraint subscriptions_org_id_name_key;
alter table public.subscriptions add constraint subscriptions_safe_amount check(amount_satang between 1 and 9007199254740991) not valid;
create table public.subscription_occurrences (
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  occurrence_date date not null,
  invoice_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(org_id,subscription_id,occurrence_date), unique(org_id,invoice_id),
  foreign key(org_id,subscription_id) references public.subscriptions(org_id,id) on delete no action deferrable initially deferred,
  foreign key(org_id,invoice_id) references public.invoices(org_id,id) on delete no action deferrable initially deferred
);
alter table public.subscription_occurrences enable row level security;
alter table public.subscription_occurrences force row level security;
create policy occurrence_read on public.subscription_occurrences for select to authenticated using(private.is_org_member(org_id));
revoke insert,update,delete on public.subscription_occurrences from authenticated,anon;
create or replace function private.guard_subscription_schedule()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.organizations where id=old.org_id) and exists(select 1 from public.subscription_occurrences where org_id=old.org_id and subscription_id=old.id) then
      raise exception 'Billed subscription must be retained'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.subscription_occurrences where org_id=old.org_id and subscription_id=old.id)
    and (new.start_date<>old.start_date or new.interval<>old.interval or new.client_id<>old.client_id or new.project_id is distinct from old.project_id) then
    raise exception 'Billed subscription scope and cadence require a new agreement'; end if;
  if current_user in ('authenticated','service_role') and tg_op='UPDATE'
    and (new.next_run_date<>old.next_run_date or new.last_generated_on is distinct from old.last_generated_on) then
    raise exception 'Schedule advancement requires the occurrence command'; end if;
  return new;
end;
$$;
create trigger guard_subscription_schedule before update or delete on public.subscriptions for each row execute function private.guard_subscription_schedule();
create or replace function private.next_subscription_date(anchor date,scheduled date,cadence public.recurring_interval)
returns date language plpgsql immutable set search_path='' as $$
declare months integer; month_start date; last_day integer; anchor_day integer:=extract(day from anchor);
begin
  if cadence='weekly' then return scheduled+7; end if;
  months:=case cadence when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12 end;
  month_start:=(date_trunc('month',scheduled)::date+make_interval(months=>months))::date;
  last_day:=extract(day from (month_start+interval '1 month - 1 day'));
  return month_start+least(anchor_day,last_day)-1;
end;
$$;
create or replace function public.generate_subscription_occurrence(p_org_id uuid,p_subscription_id uuid,p_occurrence date)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; target uuid; next_date date; months integer; wanted date; day_max integer; actor uuid:=auth.uid();
begin
  if coalesce(auth.role(),'')<>'service_role' and not private.is_org_staff(p_org_id) then raise exception 'Only staff may bill subscriptions'; end if;
  if p_occurrence is null then raise exception 'Scheduled occurrence required'; end if;
  -- NO KEY UPDATE permits concurrent FK checks; all occurrence commands serialize.
  select * into s from public.subscriptions where org_id=p_org_id and id=p_subscription_id for no key update;
  if not found then raise exception 'Subscription unavailable'; end if;
  select invoice_id into target from public.subscription_occurrences where org_id=p_org_id and subscription_id=s.id and occurrence_date=p_occurrence;
  if found then return target; end if;
  if s.status<>'active' or p_occurrence<>s.next_run_date or p_occurrence<s.start_date
    or p_occurrence>(now() at time zone 'Asia/Bangkok')::date or s.amount_satang not between 1 and 9007199254740991 then raise exception 'Invalid scheduled billing occurrence'; end if;
  if s.interval='weekly' then
    if (p_occurrence-s.start_date)%7<>0 then raise exception 'Occurrence does not match cadence'; end if;
  else
    months:=(extract(year from p_occurrence)::integer-extract(year from s.start_date)::integer)*12+extract(month from p_occurrence)::integer-extract(month from s.start_date)::integer;
    if months%(case s.interval when 'monthly' then 1 when 'quarterly' then 3 else 12 end)<>0 then raise exception 'Occurrence does not match cadence'; end if;
    wanted:=date_trunc('month',p_occurrence)::date;
    day_max:=extract(day from wanted+interval '1 month - 1 day');
    wanted:=wanted+least(extract(day from s.start_date)::integer,day_max)-1;
    if wanted<>p_occurrence then raise exception 'Occurrence does not match anchor date'; end if;
  end if;
  if s.project_id is not null and not exists(select 1 from public.projects where org_id=p_org_id and id=s.project_id and client_id=s.client_id) then raise exception 'Subscription project customer mismatch'; end if;
  next_date:=private.next_subscription_date(s.start_date,p_occurrence,s.interval);
  insert into public.invoices(org_id,client_id,project_id,number,status,issue_date,due_date,amount_satang,notes)
    values(p_org_id,s.client_id,s.project_id,'SUB-'||s.id::text||'-'||to_char(p_occurrence,'YYYYMMDD'),'draft',p_occurrence,p_occurrence+15,0,'Recurring agreement: '||s.name)
    returning id into target;
  insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position)
    values(p_org_id,target,s.name,1,s.amount_satang,s.amount_satang,0);
  insert into public.subscription_occurrences(org_id,subscription_id,occurrence_date,invoice_id) values(p_org_id,s.id,p_occurrence,target);
  update public.subscriptions set last_generated_on=p_occurrence,next_run_date=next_date where org_id=p_org_id and id=s.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,actor,'subscription',s.id,'subscription_occurrence_generated','Created scheduled draft invoice',jsonb_build_object('invoiceId',target,'occurrence',p_occurrence,'nextRun',next_date));
  return target;
end;
$$;
revoke all on function public.generate_subscription_occurrence(uuid,uuid,date) from public,anon;
grant execute on function public.generate_subscription_occurrence(uuid,uuid,date) to authenticated,service_role;

-- Command-only writes prevent callers from fabricating delivery or losing events.
drop policy reminders_rw on public.reminders;
drop policy outbound_events_rw on public.outbound_events;
create policy reminders_read on public.reminders for select to authenticated using(private.is_org_staff(org_id));
create policy outbound_read on public.outbound_events for select to authenticated using(private.is_org_staff(org_id));
revoke insert,update,delete on public.reminders,public.outbound_events from authenticated,anon;
alter table public.outbound_events add column reminder_id uuid;
alter table public.outbound_events add column lease_token uuid;
alter table public.outbound_events add column lease_expires_at timestamptz;
alter table public.outbound_events add column next_attempt_at timestamptz not null default now();
alter table public.outbound_events add column last_error text;
alter table public.outbound_events add constraint outbound_reminder_tenant foreign key(org_id,reminder_id) references public.reminders(org_id,id) on delete restrict;
create unique index outbound_reminder_once on public.outbound_events(org_id,reminder_id) where reminder_id is not null;
create index outbound_ready on public.outbound_events(next_attempt_at,created_at) where status in ('queued','failed');
create or replace function public.enqueue_reminders(p_org_id uuid,p_specs jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare spec jsonb; source uuid; due date; target uuid; n integer; reminders_created integer:=0; events_created integer:=0; kind text; label text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not private.is_org_staff(p_org_id) then raise exception 'Only staff may enqueue reminders'; end if;
  if p_specs is null or jsonb_typeof(p_specs)<>'array' or jsonb_array_length(p_specs)>1000 then raise exception 'Invalid reminder batch'; end if;
  -- Stable order also prevents reverse-order batches from deadlocking.
  for spec in select value from jsonb_array_elements(p_specs) order by value->>'entity',value->>'entityId',value->>'dueDate' loop
    kind:=spec->>'entity'; source:=(spec->>'entityId')::uuid; due:=(spec->>'dueDate')::date; label:=btrim(spec->>'title');
    if kind is null or kind not in ('deal','activity') or source is null or due is null or label is null or length(label) not between 1 and 500
      or spec->>'dueDate'<>to_char(due,'YYYY-MM-DD') then raise exception 'Invalid reminder source'; end if;
    if kind='deal' then
      if not exists(select 1 from public.deals where org_id=p_org_id and id=source) then raise exception 'Reminder source unavailable'; end if;
    else
      if not exists(select 1 from public.activities where org_id=p_org_id and id=source) then raise exception 'Reminder source unavailable'; end if;
    end if;
    insert into public.reminders(org_id,entity,entity_id,title,due_date) values(p_org_id,kind,source,label,due)
      on conflict(org_id,entity,entity_id,due_date) do nothing returning id into target;
    get diagnostics n=row_count; reminders_created:=reminders_created+n;
    select id into target from public.reminders where org_id=p_org_id and entity=kind and entity_id=source and due_date=due for no key update;
    -- Retain an existing legacy event rather than emitting a duplicate on upgrade.
    if not exists(select 1 from public.outbound_events where org_id=p_org_id and event_type='followup.due' and payload->>'reminderId'=target::text) then
      insert into public.outbound_events(org_id,event_type,reminder_id,payload)
        values(p_org_id,'followup.due',target,jsonb_build_object('version',1,'orgId',p_org_id,'reminderId',target,'entity',kind,'entityId',source,'title',label,'dueDate',due))
        on conflict do nothing;
      get diagnostics n=row_count; events_created:=events_created+n;
    end if;
  end loop;
  return jsonb_build_object('remindersUpserted',reminders_created,'eventsQueued',events_created);
end;
$$;
revoke all on function public.enqueue_reminders(uuid,jsonb) from public,anon;
grant execute on function public.enqueue_reminders(uuid,jsonb) to authenticated,service_role;
create or replace function public.claim_outbound_events(p_limit integer,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service dispatcher required'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'Invalid lease bounds'; end if;
  with picked as (select id from public.outbound_events where status in ('queued','failed') and next_attempt_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now()) order by created_at,id for update skip locked limit p_limit),
    leased as (update public.outbound_events e set lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempts=e.attempts+1
      from picked where e.id=picked.id returning e.id,e.org_id,e.event_type,e.payload,e.attempts,e.lease_token)
  select coalesce(jsonb_agg(to_jsonb(leased)),'[]'::jsonb) into result from leased;
  return result;
end;
$$;
create or replace function public.finish_outbound_event(p_event_id uuid,p_lease_token uuid,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.outbound_events;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service dispatcher required'; end if;
  if p_lease_token is null then return false; end if;
  select * into e from public.outbound_events where id=p_event_id for update;
  if not found or e.status='delivered' or e.lease_token is distinct from p_lease_token or e.lease_expires_at<=now() then return false; end if;
  update public.outbound_events set status=case when p_error is null then 'delivered'::public.outbound_status else 'failed'::public.outbound_status end,
    delivered_at=case when p_error is null then now() else null end,lease_token=null,lease_expires_at=null,
    last_error=case when p_error is null then null else left(p_error,1000) end,
    next_attempt_at=case when p_error is null then next_attempt_at else now()+make_interval(secs=>least(3600,30*power(2,least(e.attempts,7))::integer)) end where id=e.id;
  return true;
end;
$$;
revoke all on function public.claim_outbound_events(integer,integer),public.finish_outbound_event(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_outbound_events(integer,integer),public.finish_outbound_event(uuid,uuid,text) to service_role;

create table public.integration_receipts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null, key uuid not null, payload jsonb not null, created_at timestamptz not null default now(),
  unique(org_id,event_type,key), unique(org_id,id)
);
alter table public.integration_receipts enable row level security;
alter table public.integration_receipts force row level security;
revoke all on public.integration_receipts from authenticated,anon;
create or replace function public.accept_integration_event(p_org_id uuid,p_event_type text,p_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.integration_receipts; inserted integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service integration receiver required'; end if;
  if p_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1048576
    or p_event_type is null or length(btrim(p_event_type)) not between 1 and 100 then raise exception 'Invalid integration event'; end if;
  insert into public.integration_receipts(org_id,event_type,key,payload) values(p_org_id,btrim(p_event_type),p_key,p_payload) on conflict do nothing;
  get diagnostics inserted=row_count;
  select * into result from public.integration_receipts where org_id=p_org_id and event_type=btrim(p_event_type) and key=p_key for update;
  if result.payload<>p_payload then raise exception 'Idempotency conflict'; end if;
  return jsonb_build_object('eventId',result.id,'duplicate',inserted=0);
end;
$$;
revoke all on function public.accept_integration_event(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accept_integration_event(uuid,text,uuid,jsonb) to service_role;
