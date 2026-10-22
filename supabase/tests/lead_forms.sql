begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users(id,email,email_confirmed_at) values
  ('b6000000-0000-4000-8000-000000000001','synthetic-form-owner@example.invalid',now()),
  ('b6000000-0000-4000-8000-000000000002','synthetic-form-member@example.invalid',now()),
  ('b6000000-0000-4000-8000-000000000003','synthetic-other-owner@example.invalid',now());
insert into public.organizations(id,name,slug) values
  ('b6000000-0000-4000-8000-000000000010','Synthetic lead workspace','synthetic-leads'),
  ('b6000000-0000-4000-8000-000000000011','Other lead workspace','synthetic-other-leads');
insert into public.memberships(org_id,user_id,role) values
  ('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000001','owner'),
  ('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000002','member'),
  ('b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000003','owner');
insert into public.lead_forms(id,org_id,token,name,default_owner) values
  ('b6000000-0000-4000-8000-000000000020','b6000000-0000-4000-8000-000000000010',repeat('a',43),'Sales','b6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000021','b6000000-0000-4000-8000-000000000011',repeat('b',43),'Other sales','b6000000-0000-4000-8000-000000000003');
insert into public.clients(id,org_id,name) values
  ('b6000000-0000-4000-8000-000000000030','b6000000-0000-4000-8000-000000000011','Other tenant visitor');
insert into public.contacts(org_id,client_id,name,email) values
  ('b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000030','Other visitor','visitor@example.invalid');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.lead_forms'::regclass),'form RLS enabled and forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.lead_submissions'::regclass),'submission RLS enabled and forced');
set local role anon;
select throws_ok($$select * from public.lead_forms$$,'42501',null,'anonymous users cannot read form tokens');
select throws_ok($$select * from public.lead_submissions$$,'42501',null,'anonymous users cannot read submissions');
select throws_ok($$insert into public.lead_forms(org_id,token,name) values('b6000000-0000-4000-8000-000000000011',repeat('c',43),'Forged')$$,'42501',null,'anonymous users cannot write forms in any org');
select throws_ok($$select public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello','')$$,'42501',null,'anonymous users cannot call the privileged submission boundary');
select throws_ok($$insert into public.lead_submissions(org_id,form_id,client_id,deal_id,ip_hash) values('b6000000-0000-4000-8000-000000000011',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('c',64))$$,'42501',null,'anonymous users cannot forge submission orgs');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from public.lead_forms),1,'owners see only forms in their workspace');
select is((select count(*)::int from public.memberships where org_id='b6000000-0000-4000-8000-000000000010' and user_id='b6000000-0000-4000-8000-000000000002'),0,'direct membership reads cannot validate a teammate under own-only RLS');
select ok(exists(select 1 from public.record_activity_assignees('b6000000-0000-4000-8000-000000000010') where user_id='b6000000-0000-4000-8000-000000000002'),'org-scoped assignees RPC exposes the selected teammate');
select lives_ok($$insert into public.lead_forms(org_id,token,name,default_owner) values('b6000000-0000-4000-8000-000000000010',repeat('t',43),'Teammate form','b6000000-0000-4000-8000-000000000002')$$,'owner can assign a form to a teammate while the tenant FK remains enforced');
select throws_ok($$insert into public.lead_forms(org_id,token,name) values('b6000000-0000-4000-8000-000000000011',repeat('c',43),'Forged')$$,'42501',null,'owners cannot create forms in other workspaces');
select throws_ok($$update public.lead_forms set default_owner='b6000000-0000-4000-8000-000000000003' where token=repeat('a',43)$$,'23503',null,'default owner must belong to the form workspace');
select throws_ok($$select public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello','')$$,'42501',null,'authenticated clients cannot bypass server validation');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000002"}',true);
select is((select count(*)::int from public.lead_forms),0,'members cannot read secret form tokens');
select throws_ok($$insert into public.lead_forms(org_id,token,name) values('b6000000-0000-4000-8000-000000000010',repeat('c',43),'Member form')$$,'42501',null,'members cannot manage forms');
reset role;

set local role service_role;
select is(public.submit_lead_form(repeat('z',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello',''),'unavailable','unknown token writes nothing');
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello','bot'),'invalid','honeypot rejected by the database too');
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','invalid','','Hello',''),'invalid','invalid email rejected');
select is((select count(*)::int from public.lead_submissions),0,'rejected requests leave no submissions');
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','Example','VISITOR@example.invalid','123','Please call',''),'success','token authorized submission succeeds');
select is((select count(*)::int from public.deals where org_id='b6000000-0000-4000-8000-000000000011'),0,'token cannot write a deal to another org');
select is((select count(*)::int from public.clients where org_id='b6000000-0000-4000-8000-000000000010'),1,'email in another org never reuses its client');
select is((select stage::text||':'||source||':'||owner::text from public.deals where org_id='b6000000-0000-4000-8000-000000000010'),'lead:Web form:b6000000-0000-4000-8000-000000000001','lead stage source and default owner retained');
select ok((select body like '%Please call%' from public.record_notes where org_id='b6000000-0000-4000-8000-000000000010'),'message is visible in RecordHistory');
select is((select count(*)::int from public.audit_log where org_id='b6000000-0000-4000-8000-000000000010' and action='web_form_submitted'),1,'submission has an audit entry');
select is((select ip_hash from public.lead_submissions where form_id='b6000000-0000-4000-8000-000000000020'),repeat('c',64),'submission stores only the provided keyed hash');
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor again','Other company','visitor@example.invalid','','New message',''),'success','same email can submit another enquiry');
select is((select count(*)::int from public.clients where org_id='b6000000-0000-4000-8000-000000000010'),1,'same tenant email reuses existing client');
select is((select count(*)::int from public.deals where org_id='b6000000-0000-4000-8000-000000000010'),2,'each enquiry creates a deal');
select public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello','') from generate_series(1,3);
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello',''),'rate_limited','sixth request from one IP is limited');
select is((select count(*)::int from public.lead_submissions where form_id='b6000000-0000-4000-8000-000000000020'),5,'rate limited request creates no partial submission');
select is(public.submit_lead_form(repeat('a',43),repeat('d',64),'Visitor','','visitor@example.invalid','','Hello',''),'success','other IP has independent allowance');
reset role;
update public.lead_submissions set created_at=now()-interval '11 minutes' where form_id='b6000000-0000-4000-8000-000000000020';
set local role service_role;
select is(public.submit_lead_form(repeat('a',43),repeat('c',64),'Visitor','','visitor@example.invalid','','Hello',''),'success','expired submissions release rate limit');
select public.submit_lead_form(repeat('a',43),lpad(to_hex(i),64,'0'),'Visitor','','visitor@example.invalid','','Hello','') from generate_series(1,49) i;
select is(public.submit_lead_form(repeat('a',43),repeat('e',64),'Visitor','','visitor@example.invalid','','Hello',''),'rate_limited','form-wide limit applies across different IPs');
update public.lead_forms set enabled=false where token=repeat('a',43);
select is(public.submit_lead_form(repeat('a',43),repeat('e',64),'Visitor','','visitor@example.invalid','','Hello',''),'unavailable','disabled forms reject submission');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from public.lead_submissions),0,'other workspace owner cannot read submissions');
select is((select count(*)::int from public.lead_forms),1,'other workspace owner cannot see first workspace token');
reset role;
set local role service_role;
delete from public.deals where org_id='b6000000-0000-4000-8000-000000000010';
select ok((select bool_and(deal_id is null) from public.lead_submissions where org_id='b6000000-0000-4000-8000-000000000010'),'deal deletion preserves submission audit and rate history');
delete from public.clients where org_id='b6000000-0000-4000-8000-000000000010';
select ok((select bool_and(client_id is null) from public.lead_submissions where org_id='b6000000-0000-4000-8000-000000000010'),'client deletion preserves submission audit and rate history');
reset role;
create function pg_temp.reject_lead_note() returns trigger language plpgsql as $$
begin raise exception 'Synthetic note failure'; end;
$$;
create trigger reject_lead_note before insert on public.record_notes for each row execute function pg_temp.reject_lead_note();
set local role service_role;
select throws_ok($$select public.submit_lead_form(repeat('b',43),repeat('f',64),'Rollback','','rollback@example.invalid','','Hello','')$$,'P0001','Synthetic note failure','note failure aborts the whole lead transaction');
select is((select count(*)::int from public.deals where org_id='b6000000-0000-4000-8000-000000000011'),0,'failed note leaves no partial deal');
select is((select count(*)::int from public.clients where org_id='b6000000-0000-4000-8000-000000000011'),1,'failed note leaves no partial customer');
reset role;
select * from finish();
rollback;
