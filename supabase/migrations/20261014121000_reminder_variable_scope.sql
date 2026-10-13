-- Forward repair: avoid ambiguity with deals.source.
create or replace function public.enqueue_reminders(p_org_id uuid,p_specs jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare spec jsonb; source_id uuid; due date; target uuid; n integer; reminders_created integer:=0; events_created integer:=0; kind text; label text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not private.is_org_staff(p_org_id) then raise exception 'Only staff may enqueue reminders'; end if;
  if p_specs is null or jsonb_typeof(p_specs)<>'array' or jsonb_array_length(p_specs)>1000 then raise exception 'Invalid reminder batch'; end if;
  -- Stable order also prevents reverse-order batches from deadlocking.
  for spec in select value from jsonb_array_elements(p_specs) order by value->>'entity',value->>'entityId',value->>'dueDate' loop
    kind:=spec->>'entity'; source_id:=(spec->>'entityId')::uuid; due:=(spec->>'dueDate')::date; label:=btrim(spec->>'title');
    if kind is null or kind not in ('deal','activity') or source_id is null or due is null or label is null or length(label) not between 1 and 500
      or spec->>'dueDate'<>to_char(due,'YYYY-MM-DD') then raise exception 'Invalid reminder source_id'; end if;
    if kind='deal' then
      if not exists(select 1 from public.deals where org_id=p_org_id and id=source_id) then raise exception 'Reminder source_id unavailable'; end if;
    else
      if not exists(select 1 from public.activities where org_id=p_org_id and id=source_id) then raise exception 'Reminder source_id unavailable'; end if;
    end if;
    insert into public.reminders(org_id,entity,entity_id,title,due_date) values(p_org_id,kind,source_id,label,due)
      on conflict(org_id,entity,entity_id,due_date) do nothing returning id into target;
    get diagnostics n=row_count; reminders_created:=reminders_created+n;
    select id into target from public.reminders where org_id=p_org_id and entity=kind and entity_id=source_id and due_date=due for no key update;
    -- Retain an existing legacy event rather than emitting a duplicate on upgrade.
    if not exists(select 1 from public.outbound_events where org_id=p_org_id and event_type='followup.due' and payload->>'reminderId'=target::text) then
      insert into public.outbound_events(org_id,event_type,reminder_id,payload)
        values(p_org_id,'followup.due',target,jsonb_build_object('version',1,'orgId',p_org_id,'reminderId',target,'entity',kind,'entityId',source_id,'title',label,'dueDate',due))
        on conflict do nothing;
      get diagnostics n=row_count; events_created:=events_created+n;
    end if;
  end loop;
  return jsonb_build_object('remindersUpserted',reminders_created,'eventsQueued',events_created);
end;
$$;
