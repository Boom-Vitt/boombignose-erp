begin;
create extension if not exists pgtap with schema extensions;
select plan(39);
create function pg_temp.crm_id(n integer) returns uuid language sql immutable as $$
  select ('c4e00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.crm_id(1),'crm-owner@example.test',now()),
  (pg_temp.crm_id(2),'crm-member@example.test',now()),
  (pg_temp.crm_id(3),'crm-other@example.test',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.crm_id(10),'CRM workspace','crm-test-a'),
  (pg_temp.crm_id(20),'Other CRM workspace','crm-test-b');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.crm_id(10),pg_temp.crm_id(1),'owner'),
  (pg_temp.crm_id(10),pg_temp.crm_id(2),'member'),
  (pg_temp.crm_id(20),pg_temp.crm_id(3),'owner');
insert into public.clients(id,org_id,name) values
  (pg_temp.crm_id(100),pg_temp.crm_id(10),'CRM client'),
  (pg_temp.crm_id(101),pg_temp.crm_id(10),'Second CRM client');
insert into public.deals(id,org_id,client_id,title,created_at) values
  (pg_temp.crm_id(201),pg_temp.crm_id(10),pg_temp.crm_id(100),'First',now()-interval '3 days'),
  (pg_temp.crm_id(202),pg_temp.crm_id(10),pg_temp.crm_id(100),'Second',now()-interval '2 days'),
  (pg_temp.crm_id(203),pg_temp.crm_id(10),pg_temp.crm_id(100),'Third',now()-interval '1 day');
create function pg_temp.lead_column() returns text language sql as $$
  select string_agg(title,',' order by sequence,created_at desc,id) from public.deals where org_id=pg_temp.crm_id(10) and stage='lead';
$$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.deal_lost_reasons'::regclass),'lost reason RLS enabled and forced');
select is((select count(*)::int from public.deal_lost_reasons where org_id=pg_temp.crm_id(10)),5,'a new workspace starts with the default lost reasons');
select is(pg_temp.lead_column(),'Third,Second,First','each new deal enters the top of its column');
select is((select probability::int from public.deals where id=pg_temp.crm_id(201)),10,'a new deal takes its stage default probability');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.crm_id(2))::text,true);
set local role authenticated;
select is((select count(*)::int from public.deal_lost_reasons),5,'members read their workspace reasons only');
select throws_ok($$insert into public.deal_lost_reasons(org_id,name) values(pg_temp.crm_id(10),'Member reason')$$,'42501',null,'members cannot add lost reasons');
update public.deal_lost_reasons set active=false where name='Too expensive';
select is((select count(*)::int from public.deal_lost_reasons where not active),0,'members cannot archive lost reasons');

reset role;
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.crm_id(1))::text,true);
set local role authenticated;
select lives_ok($$insert into public.deal_lost_reasons(org_id,name) values(pg_temp.crm_id(10),'Timing')$$,'owners add lost reasons');
select throws_ok($$insert into public.deal_lost_reasons(org_id,name) values(pg_temp.crm_id(10),'timing')$$,'23505',null,'reason names are unique per workspace, ignoring case');
update public.deal_lost_reasons set active=false where name='Timing';
select is((select count(*)::int from public.deal_lost_reasons where not active),1,'owners archive lost reasons');
select throws_ok($$update public.deals set stage='lost',lost_reason_id=(select id from public.deal_lost_reasons where name='Timing') where id=pg_temp.crm_id(202)$$,'23514','Pick a lost reason','an archived reason cannot be picked');
reset role;
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.crm_id(2))::text,true);
set local role authenticated;

-- Stage-owned fields.
update public.deals set stage='proposal' where id=pg_temp.crm_id(201);
select is((select probability::int from public.deals where id=pg_temp.crm_id(201)),50,'a stage change resets probability to the new stage default');
update public.deals set probability=65 where id=pg_temp.crm_id(201);
select is((select probability::int from public.deals where id=pg_temp.crm_id(201)),65,'probability is editable within a stage');
update public.deals set stage='negotiation',probability=40 where id=pg_temp.crm_id(201);
select is((select probability::int from public.deals where id=pg_temp.crm_id(201)),40,'a probability set in the same write as the stage change is kept');
update public.deals set stage='won' where id=pg_temp.crm_id(201);
select ok((select probability=100 and won_at is not null and lost_at is null from public.deals where id=pg_temp.crm_id(201)),'won pins probability to 100 and stamps won_at');
update public.deals set probability=30 where id=pg_temp.crm_id(201);
select is((select probability::int from public.deals where id=pg_temp.crm_id(201)),100,'won deals stay at 100 percent');
update public.deals set stage='negotiation' where id=pg_temp.crm_id(201);
select ok((select won_at is null and probability=70 from public.deals where id=pg_temp.crm_id(201)),'reopening clears won_at');

select throws_ok($$update public.deals set stage='lost' where id=pg_temp.crm_id(202)$$,'23514','Pick a lost reason','marking lost needs a reason');
select throws_ok($$insert into public.deals(org_id,client_id,title,stage) values(pg_temp.crm_id(10),pg_temp.crm_id(100),'Born lost','lost')$$,'23514','Pick a lost reason','creating a lost deal needs a reason');
update public.deals set stage='lost',lost_reason_id=(select id from public.deal_lost_reasons where name='No budget') where id=pg_temp.crm_id(202);
select ok((select probability=0 and lost_at is not null and lost_reason_id is not null from public.deals where id=pg_temp.crm_id(202)),'lost stores the reason, pins probability to 0 and stamps lost_at');
update public.deals set title='Second renamed' where id=pg_temp.crm_id(202);
select ok((select lost_reason_id is not null and lost_at is not null from public.deals where id=pg_temp.crm_id(202)),'editing a lost deal keeps its reason and date');
select throws_ok($$update public.deals set lost_reason_id=null where id=pg_temp.crm_id(202)$$,'23514','Pick a lost reason','a lost deal cannot drop its reason');
update public.deals set stage='lead' where id=pg_temp.crm_id(202);
select ok((select lost_reason_id is null and lost_at is null from public.deals where id=pg_temp.crm_id(202)),'reopening clears the reason and lost_at');
select is(pg_temp.lead_column(),'Second renamed,Third','a reopened deal goes to the top of its column');

-- Board moves.
select is(public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(202),'lead',pg_temp.crm_id(203))::text,'lead','move_deal returns the previous stage');
select is(pg_temp.lead_column(),'Third,Second, renamed','a drop after a card reorders the column');
select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(201),'lead',pg_temp.crm_id(203));
select is(pg_temp.lead_column(),'Third,First,Second, renamed','a drop from another column lands after the given card');
select ok((select probability=10 from public.deals where id=pg_temp.crm_id(201)),'a board move to another stage resets probability');
select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(202),'lead',null);
select is(pg_temp.lead_column(),'Second renamed,Third,First','no anchor puts the card on top');
select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(203),'lead',gen_random_uuid());
select is(pg_temp.lead_column(),'Third,Second, renamed,First','an anchor that left the column falls back to the top');
select is((select string_agg(sequence::text,',' order by sequence) from public.deals where org_id=pg_temp.crm_id(10) and stage='lead'),'1,2,3','the column is renumbered densely');
select throws_ok($$select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(203),'lost',null)$$,'23514','Pick a lost reason','a board move to lost needs a reason');
select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(203),'lost',null,(select id from public.deal_lost_reasons where name='No response'));
select ok((select stage='lost' and lost_reason_id is not null from public.deals where id=pg_temp.crm_id(203)),'a board move to lost stores the reason');
select throws_ok($$select public.move_deal(pg_temp.crm_id(10),gen_random_uuid(),'lead',null)$$,'P0002','Deal not found','moving a deal that no longer exists fails');
select throws_ok($$select public.move_deal(pg_temp.crm_id(20),pg_temp.crm_id(201),'lead',null)$$,'42501',null,'members cannot move deals in another workspace');
reset role;

-- Quote links.
insert into public.quotes(id,org_id,client_id,number,status,deal_id) values
  (pg_temp.crm_id(301),pg_temp.crm_id(10),pg_temp.crm_id(100),'CRM-Q-1','draft',pg_temp.crm_id(201));
select is((select deal_id from public.quotes where id=pg_temp.crm_id(301)),pg_temp.crm_id(201),'a quote links to a deal of the same client');
select throws_ok($$insert into public.quotes(org_id,client_id,number,status,deal_id) values(pg_temp.crm_id(10),pg_temp.crm_id(101),'CRM-Q-2','draft',pg_temp.crm_id(201))$$,null,'Deal and quote customer must match','a quote cannot link to another client''s deal');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.crm_id(3))::text,true);
set local role authenticated;
select is((select count(*)::int from public.deal_lost_reasons),5,'other workspace owners see only their own reasons');
select throws_ok($$select public.move_deal(pg_temp.crm_id(10),pg_temp.crm_id(201),'lead',null)$$,'42501',null,'outsiders cannot move deals');
reset role;

select * from finish();
rollback;
