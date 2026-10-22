-- CRM review fixes: atomic deal delete, quote/deal customer match from both sides, an explicit
-- probability survives a stage change, a reused web-form deal stays locked, and a lost move saves
-- its closing note in the same transaction.

-- Activities outlive their deal on its client; one transaction, so a refused delete keeps them on the deal.
create function public.delete_deal(p_org_id uuid,p_deal_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare deleted_title text;
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required' using errcode='42501'; end if;
  -- Locked first, so an activity added meanwhile can't land between the detach and the cascade.
  perform 1 from public.deals where org_id=p_org_id and id=p_deal_id for update;
  update public.activities set deal_id=null where org_id=p_org_id and deal_id=p_deal_id;
  delete from public.deals where org_id=p_org_id and id=p_deal_id returning title into deleted_title;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  return deleted_title;
end;
$$;
revoke all on function public.delete_deal(uuid,uuid) from public,anon;
grant execute on function public.delete_deal(uuid,uuid) to authenticated;

-- A quote's deal belongs to the quote's customer. The composite key also refuses a client change on a
-- deal that has quotes; quotes already left on another customer's deal are unlinked first. The quote
-- guard stays off for that link-only repair, as in the CRM backfill, so no legacy row can abort it.
alter table public.quotes disable trigger guard_quote_record;
alter table public.quotes disable trigger set_updated_at;
update public.quotes q set deal_id=null from public.deals d
  where d.org_id=q.org_id and d.id=q.deal_id and d.client_id<>q.client_id;
alter table public.quotes enable trigger set_updated_at;
alter table public.quotes enable trigger guard_quote_record;
alter table public.deals add constraint deals_org_id_id_client_id_key unique(org_id,id,client_id);
alter table public.quotes drop constraint quotes_deal_tenant_fkey,
  add constraint quotes_deal_client_fkey foreign key(org_id,deal_id,client_id)
    references public.deals(org_id,id,client_id) on delete set null (deal_id);

-- A stage change takes the new stage's default probability unless the same write names one, even one
-- equal to the old value. Only a column-list trigger sees that a write named the column, so it flags
-- the row for apply_deal_stage; its name sorts first because same-event triggers fire in name order.
create function private.flag_deal_probability()
returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_catalog.set_config('crm.deal_probability_named',new.id::text,true);
  return new;
end;
$$;
create trigger apply_deal_probability_flag before update of probability on public.deals
  for each row execute function private.flag_deal_probability();

create or replace function private.apply_deal_stage()
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
    if entering and pg_catalog.current_setting('crm.deal_probability_named',true) is distinct from new.id::text then
      new.probability := null;
    end if;
    perform pg_catalog.set_config('crm.deal_probability_named','',true);
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

-- p_note goes into the deal's history in the same transaction, so a note that can't be saved fails the move.
drop function public.move_deal(uuid,uuid,public.deal_stage,uuid,uuid);
create function public.move_deal(p_org_id uuid,p_deal_id uuid,p_stage public.deal_stage,p_after_id uuid default null,p_lost_reason_id uuid default null,p_note text default null)
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
  if p_note is not null then
    insert into public.record_notes(org_id,record_type,record_id,author,body) values(p_org_id,'deal',p_deal_id,auth.uid(),p_note);
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
revoke all on function public.move_deal(uuid,uuid,public.deal_stage,uuid,uuid,text) from public,anon;
grant execute on function public.move_deal(uuid,uuid,public.deal_stage,uuid,uuid,text) to authenticated;

-- The reused open deal is locked until commit, so it can't close or change customer while the
-- enquiry attaches to it.
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
      order by created_at desc,id desc limit 1 for update;
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
