-- CRM: lost reasons, won/lost dates, per-deal probability, persisted board order,
-- quote-to-deal links, and web-form repeats attached to the client's open deal.

create table public.deal_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(org_id,id)
);
create unique index deal_lost_reasons_org_name_key on public.deal_lost_reasons(org_id,lower(name));
alter table public.deal_lost_reasons enable row level security;
alter table public.deal_lost_reasons force row level security;
revoke all on public.deal_lost_reasons from anon,authenticated;
-- Reasons are archived (active=false), never deleted, so lost deals keep their reason.
grant select,insert,update on public.deal_lost_reasons to authenticated;
grant all on public.deal_lost_reasons to service_role;
create policy tenant_read on public.deal_lost_reasons for select to authenticated using(private.is_org_member(org_id));
create policy tenant_insert on public.deal_lost_reasons for insert to authenticated with check(private.is_org_staff(org_id));
create policy tenant_update on public.deal_lost_reasons for update to authenticated using(private.is_org_staff(org_id)) with check(private.is_org_staff(org_id));
create trigger guard_tenant_identity before update on public.deal_lost_reasons for each row execute function private.guard_tenant_identity();

create function private.seed_deal_lost_reasons()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.deal_lost_reasons(org_id,name)
    select new.id,reason from unnest(array['Too expensive','Chose a competitor','No budget','No response','Not a fit']) reason;
  return new;
end;
$$;
revoke all on function private.seed_deal_lost_reasons() from public,anon,authenticated;
create trigger seed_deal_lost_reasons after insert on public.organizations for each row execute function private.seed_deal_lost_reasons();
insert into public.deal_lost_reasons(org_id,name)
  select o.id,reason from public.organizations o
  cross join unnest(array['Too expensive','Chose a competitor','No budget','No response','Not a fit']) reason;

-- Mirrors STAGE_PROBABILITY in lib/metrics/pipeline.ts.
create function private.deal_stage_probability(p_stage public.deal_stage)
returns smallint language sql immutable set search_path='' as $$
  select case p_stage
    when 'lead' then 10 when 'contacted' then 20 when 'discovery' then 30
    when 'proposal' then 50 when 'negotiation' then 70 when 'won' then 100 else 0 end::smallint;
$$;

alter table public.deals
  add column probability smallint check (probability between 0 and 100),
  add column lost_reason_id uuid,
  add column won_at timestamptz,
  add column lost_at timestamptz,
  add column sequence integer not null default 0,
  add constraint deals_lost_reason_tenant_fkey foreign key(org_id,lost_reason_id) references public.deal_lost_reasons(org_id,id);

-- Backfill from the stage history the deal actions already audit; updated_at when there is none.
alter table public.deals disable trigger set_updated_at;
update public.deals d set
  probability=private.deal_stage_probability(d.stage),
  won_at=case when d.stage='won' then coalesce((select max(a.created_at) from public.audit_log a
    where a.org_id=d.org_id and a.entity='deal' and a.entity_id=d.id and a.action='stage_changed' and a.meta->>'to'='won'),d.updated_at) end,
  lost_at=case when d.stage='lost' then coalesce((select max(a.created_at) from public.audit_log a
    where a.org_id=d.org_id and a.entity='deal' and a.entity_id=d.id and a.action='stage_changed' and a.meta->>'to'='lost'),d.updated_at) end,
  -- Keep today's board order (newest first) as the starting card order.
  sequence=o.n
from (select id,row_number() over(partition by org_id,stage order by created_at desc,id)::integer as n from public.deals) o
where o.id=d.id;
alter table public.deals enable trigger set_updated_at;
alter table public.deals alter column probability set not null;
create index deals_board_order_idx on public.deals(org_id,stage,sequence);

-- Stage-owned fields stay consistent on every write path (forms, board, web forms):
-- a stage change resets probability unless the same write sets it, won and lost pin it,
-- won_at/lost_at track the current closed state, lost needs an active reason, and a deal
-- entering a column goes to its top unless the write places it.
create function private.apply_deal_stage()
returns trigger language plpgsql set search_path='' as $$
declare
  entering boolean := true;
  reason_changed boolean := false;
  placed boolean := false;
  closed_at timestamptz;
begin
  if tg_op='UPDATE' then
    entering := new.stage<>old.stage;
    reason_changed := new.lost_reason_id is distinct from old.lost_reason_id;
    placed := new.sequence<>old.sequence;
    if entering and new.probability=old.probability then new.probability := null; end if;
    if not entering then closed_at := coalesce(old.won_at,old.lost_at); end if;
  end if;
  new.probability := case new.stage when 'won' then 100 when 'lost' then 0
    else coalesce(new.probability,private.deal_stage_probability(new.stage)) end;
  new.won_at := case when new.stage='won' then coalesce(closed_at,now()) end;
  new.lost_at := case when new.stage='lost' then coalesce(closed_at,now()) end;

  if new.stage<>'lost' then
    new.lost_reason_id := null;
  elsif entering or reason_changed then
    if not exists(select 1 from public.deal_lost_reasons where org_id=new.org_id and id=new.lost_reason_id and active) then
      raise exception 'Pick a lost reason' using errcode='23514';
    end if;
  end if;

  if entering and not placed then
    select coalesce(min(sequence),1)-1 into new.sequence from public.deals where org_id=new.org_id and stage=new.stage and id<>new.id;
  end if;
  return new;
end;
$$;
grant execute on function private.deal_stage_probability(public.deal_stage) to authenticated,service_role;
create trigger apply_deal_stage before insert or update on public.deals for each row execute function private.apply_deal_stage();

-- Board move: the deal goes right after p_after_id in column p_stage (top when null or when that
-- card left the column), and the column is renumbered. Runs as the caller, so deals RLS applies.
create function public.move_deal(p_org_id uuid,p_deal_id uuid,p_stage public.deal_stage,p_after_id uuid default null,p_lost_reason_id uuid default null)
returns public.deal_stage language plpgsql security invoker set search_path='' as $$
declare
  moving public.deals;
  ordered uuid[];
  pos integer;
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required' using errcode='42501'; end if;
  -- One move per board at a time: per-column locks deadlock when two cards swap columns.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':deal_board',0));
  select * into moving from public.deals where org_id=p_org_id and id=p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;

  if moving.stage<>p_stage or (p_stage='lost' and p_lost_reason_id is not null and p_lost_reason_id is distinct from moving.lost_reason_id) then
    update public.deals set stage=p_stage,lost_reason_id=coalesce(p_lost_reason_id,lost_reason_id)
      where org_id=p_org_id and id=p_deal_id;
  end if;

  select coalesce(array_agg(id order by sequence,created_at desc,id),'{}') into ordered
    from public.deals where org_id=p_org_id and stage=p_stage and id<>p_deal_id;
  pos := coalesce(pg_catalog.array_position(ordered,p_after_id),0);
  ordered := ordered[1:pos] || p_deal_id || ordered[pos+1:];
  update public.deals d set sequence=o.n::integer
    from unnest(ordered) with ordinality o(id,n)
    where d.org_id=p_org_id and d.id=o.id and d.stage=p_stage and d.sequence is distinct from o.n::integer;
  return moving.stage;
end;
$$;
revoke all on function public.move_deal(uuid,uuid,public.deal_stage,uuid,uuid) from public,anon;
grant execute on function public.move_deal(uuid,uuid,public.deal_stage,uuid,uuid) to authenticated;

alter table public.quotes
  add column deal_id uuid,
  add constraint quotes_deal_tenant_fkey foreign key(org_id,deal_id) references public.deals(org_id,id) on delete set null (deal_id);
create index quotes_deal_idx on public.quotes(org_id,deal_id) where deal_id is not null;

-- A new quote for a project takes that project's deal, so a project-only pick still links it.
create function private.guard_quote_deal()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and new.deal_id is null and new.project_id is not null then
    select p.deal_id into new.deal_id from public.projects p join public.deals d on d.org_id=p.org_id and d.id=p.deal_id
      where p.org_id=new.org_id and p.id=new.project_id and d.client_id=new.client_id;
  end if;
  if new.deal_id is not null and not exists(
    select 1 from public.deals where org_id=new.org_id and id=new.deal_id and client_id=new.client_id
  ) then raise exception 'Deal and quote customer must match'; end if;
  return new;
end;
$$;
create trigger guard_quote_deal before insert or update of deal_id,client_id on public.quotes for each row execute function private.guard_quote_deal();

-- Quotes reached their deal through a project until now. The quote guard recomputes totals and
-- rejects edits to expired accepted quotes, so it stays off for this link-only backfill.
alter table public.quotes disable trigger guard_quote_record;
alter table public.quotes disable trigger set_updated_at;
update public.quotes q set deal_id=p.deal_id
  from public.projects p join public.deals d on d.org_id=p.org_id and d.id=p.deal_id
  where p.org_id=q.org_id and p.id=q.project_id and d.client_id=q.client_id and q.deal_id is null;
alter table public.quotes enable trigger set_updated_at;
alter table public.quotes enable trigger guard_quote_record;

-- A repeat enquiry from a known email lands on that client's newest open deal as a note plus a
-- follow-up activity, instead of opening a duplicate deal.
create or replace function public.submit_lead_form(p_token text,p_ip_hash text,p_name text,p_company text,p_email text,p_phone text,p_message text,p_website text)
returns text language plpgsql security definer set search_path='' as $$
declare
  form public.lead_forms;
  customer uuid;
  opportunity uuid;
  opportunity_owner uuid;
  attached boolean;
  recent_count integer;
  ip_count integer;
  contact_email text := lower(btrim(p_email));
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return 'unavailable'; end if;
  select * into form from public.lead_forms where token=p_token for update;
  if not found or not form.enabled or form.default_owner is null then return 'unavailable'; end if;
  if p_website is distinct from '' or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
    or p_name is null or length(btrim(p_name)) not between 1 and 120
    or p_company is null or length(p_company)>200
    or contact_email is null or length(contact_email)>254 or contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_phone is null or length(p_phone)>50
    or p_message is null or length(btrim(p_message)) not between 1 and 4000 then return 'invalid'; end if;
  select count(*),count(*) filter(where ip_hash=p_ip_hash) into recent_count,ip_count
    from public.lead_submissions where form_id=form.id and created_at>now()-interval '10 minutes';
  if recent_count>=50 or ip_count>=5 then return 'rate_limited'; end if;

  -- Serialize email reuse across different forms in the same workspace.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(form.org_id::text||':'||contact_email,0));
  select client_id into customer from public.contacts
    where org_id=form.org_id and lower(btrim(contacts.email))=contact_email order by created_at,id limit 1;
  if customer is null then
    insert into public.clients(org_id,name,source,owner)
      values(form.org_id,coalesce(nullif(btrim(p_company),''),btrim(p_name)),'Web form',form.default_owner) returning id into customer;
    insert into public.contacts(org_id,client_id,name,email,phone)
      values(form.org_id,customer,btrim(p_name),contact_email,nullif(btrim(p_phone),''));
  else
    select id,owner into opportunity,opportunity_owner from public.deals
      where org_id=form.org_id and client_id=customer and stage not in ('won','lost')
      order by created_at desc,id desc limit 1;
  end if;
  attached := opportunity is not null;
  if not attached then
    insert into public.deals(org_id,client_id,title,stage,source,owner)
      values(form.org_id,customer,'Web form: '||btrim(p_name),'lead','Web form',form.default_owner) returning id into opportunity;
  else
    -- A deal owner who has left the workspace can't be assigned; the form's owner follows up instead.
    insert into public.activities(org_id,record_type,record_id,type,due_date,body,owner)
      values(form.org_id,'deal',opportunity,'follow_up',(now() at time zone 'Asia/Bangkok')::date,
        'Reply to the new web form enquiry from '||btrim(p_name),
        coalesce((select user_id from public.memberships where org_id=form.org_id and user_id=opportunity_owner),form.default_owner));
  end if;
  insert into public.record_notes(org_id,record_type,record_id,author,body)
    values(form.org_id,'deal',opportunity,form.default_owner,
      'Web form submission'||E'\nName: '||btrim(p_name)||E'\nCompany: '||btrim(p_company)||E'\nEmail: '||contact_email||E'\nPhone: '||btrim(p_phone)||E'\n\n'||btrim(p_message));
  insert into public.lead_submissions(org_id,form_id,client_id,deal_id,ip_hash)
    values(form.org_id,form.id,customer,opportunity,p_ip_hash);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(form.org_id,null,'deal',opportunity,'web_form_submitted',
      case when attached then 'Web form enquiry added to open deal' else 'Lead captured from web form' end,
      jsonb_build_object('formId',form.id,'attached',attached));
  return 'success';
end;
$$;
