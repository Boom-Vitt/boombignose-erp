create table public.lead_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  enabled boolean not null default true,
  default_owner uuid,
  success_message text not null default 'Thank you. We will be in touch soon.' check (length(btrim(success_message)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique(org_id,id),
  foreign key(default_owner,org_id) references public.memberships(user_id,org_id) on delete set null (default_owner)
);
create table public.lead_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  form_id uuid not null,
  client_id uuid,
  deal_id uuid,
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key(org_id,form_id) references public.lead_forms(org_id,id),
  foreign key(org_id,client_id) references public.clients(org_id,id) on delete set null (client_id),
  foreign key(org_id,deal_id) references public.deals(org_id,id) on delete set null (deal_id)
);
create index lead_forms_org_idx on public.lead_forms(org_id,created_at);
create index lead_submissions_rate_idx on public.lead_submissions(form_id,created_at,ip_hash);
alter table public.lead_forms enable row level security;
alter table public.lead_forms force row level security;
alter table public.lead_submissions enable row level security;
alter table public.lead_submissions force row level security;
revoke all on public.lead_forms,public.lead_submissions from anon,authenticated;
grant select,insert,update on public.lead_forms to authenticated;
grant select on public.lead_submissions to authenticated;
grant all on public.lead_forms,public.lead_submissions to service_role;
create policy lead_forms_read on public.lead_forms for select to authenticated using(private.is_org_staff(org_id));
create policy lead_forms_insert on public.lead_forms for insert to authenticated with check(private.is_org_staff(org_id));
create policy lead_forms_update on public.lead_forms for update to authenticated using(private.is_org_staff(org_id)) with check(private.is_org_staff(org_id));
create policy lead_submissions_read on public.lead_submissions for select to authenticated using(private.is_org_staff(org_id));
create trigger guard_tenant_identity before update on public.lead_forms for each row execute function private.guard_tenant_identity();

create function public.submit_lead_form(p_token text,p_ip_hash text,p_name text,p_company text,p_email text,p_phone text,p_message text,p_website text)
returns text language plpgsql security definer set search_path='' as $$
declare
  form public.lead_forms;
  customer uuid;
  opportunity uuid;
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
  end if;
  insert into public.deals(org_id,client_id,title,stage,source,owner)
    values(form.org_id,customer,'Web form: '||btrim(p_name),'lead','Web form',form.default_owner) returning id into opportunity;
  insert into public.record_notes(org_id,record_type,record_id,author,body)
    values(form.org_id,'deal',opportunity,form.default_owner,
      'Web form submission'||E'\nName: '||btrim(p_name)||E'\nCompany: '||btrim(p_company)||E'\nEmail: '||contact_email||E'\nPhone: '||btrim(p_phone)||E'\n\n'||btrim(p_message));
  insert into public.lead_submissions(org_id,form_id,client_id,deal_id,ip_hash)
    values(form.org_id,form.id,customer,opportunity,p_ip_hash);
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(form.org_id,null,'deal',opportunity,'web_form_submitted','Lead captured from web form',jsonb_build_object('formId',form.id));
  return 'success';
end;
$$;
revoke all on function public.submit_lead_form(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_lead_form(text,text,text,text,text,text,text,text) to service_role;
