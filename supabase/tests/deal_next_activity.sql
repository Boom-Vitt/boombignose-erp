begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
create function pg_temp.kanban_id(n integer) returns uuid language sql immutable as $$
  select ('d3a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.kanban_id(1),'kanban-member@example.test',now()),
  (pg_temp.kanban_id(2),'kanban-outsider@example.test',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.kanban_id(10),'Kanban workspace','kanban-test-a'),
  (pg_temp.kanban_id(20),'Other kanban workspace','kanban-test-b');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.kanban_id(10),pg_temp.kanban_id(1),'member'),
  (pg_temp.kanban_id(20),pg_temp.kanban_id(2),'owner');
insert into public.clients(id,org_id,name) values(pg_temp.kanban_id(100),pg_temp.kanban_id(10),'Kanban client');
insert into public.deals(id,org_id,client_id,title) values
  (pg_temp.kanban_id(101),pg_temp.kanban_id(10),pg_temp.kanban_id(100),'Busy deal'),
  (pg_temp.kanban_id(102),pg_temp.kanban_id(10),pg_temp.kanban_id(100),'Overdue deal'),
  (pg_temp.kanban_id(103),pg_temp.kanban_id(10),pg_temp.kanban_id(100),'Polymorphic deal'),
  (pg_temp.kanban_id(104),pg_temp.kanban_id(10),pg_temp.kanban_id(100),'Undated deal');
insert into public.projects(id,org_id,name) values(pg_temp.kanban_id(105),pg_temp.kanban_id(10),'Kanban project');

select ok((select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.deal_next_activity'::regclass),'view applies the caller''s activities RLS');
select ok(not has_table_privilege('anon','public.deal_next_activity','select'),'anon cannot read the view');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.kanban_id(1))::text,true);
set local role authenticated;
-- The review's repro: 1,000 earlier activities on one deal filled a capped list before the other deal's overdue one.
insert into public.activities(org_id,deal_id,due_date)
  select pg_temp.kanban_id(10),pg_temp.kanban_id(101),date '2020-01-01'+g from generate_series(0,999) g;
insert into public.activities(org_id,deal_id,due_date,done) values(pg_temp.kanban_id(10),pg_temp.kanban_id(101),date '2019-01-01',true);
insert into public.activities(org_id,deal_id,due_date) values(pg_temp.kanban_id(10),pg_temp.kanban_id(102),date '2023-01-01');
insert into public.activities(org_id,record_type,record_id,due_date) values(pg_temp.kanban_id(10),'deal',pg_temp.kanban_id(103),date '2026-11-01');
insert into public.activities(org_id,deal_id) values(pg_temp.kanban_id(10),pg_temp.kanban_id(104));
select is((select count(*) from public.deal_next_activity where org_id=pg_temp.kanban_id(10)),4::bigint,'one row per deal with open activities');
select is((select next_due_date from public.deal_next_activity where deal_id=pg_temp.kanban_id(102)),date '2023-01-01','a deal behind 1,000 earlier activities keeps its earliest due date');
select is((select next_due_date from public.deal_next_activity where deal_id=pg_temp.kanban_id(101)),date '2020-01-01','done activities are ignored');
select is((select open_count from public.deal_next_activity where deal_id=pg_temp.kanban_id(101)),1000,'open count covers every open activity');
select is((select next_due_date from public.deal_next_activity where deal_id=pg_temp.kanban_id(103)),date '2026-11-01','record_type/record_id deal links are included');
select ok((select next_due_date is null and open_count=1 from public.deal_next_activity where deal_id=pg_temp.kanban_id(104)),'undated open activities count without a due date');
select lives_ok($$update public.projects set status='in_progress' where id=pg_temp.kanban_id(105)$$,'a member moves a project on the board');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.kanban_id(2))::text,true);
set local role authenticated;
select is((select count(*) from public.deal_next_activity where org_id=pg_temp.kanban_id(10)),0::bigint,'outsiders see no rows from another workspace');
reset role;

select is((select count(*) from public.audit_log where entity='project' and entity_id=pg_temp.kanban_id(105) and action='record_status_changed' and actor_id=pg_temp.kanban_id(1) and meta->>'to'='in_progress'),1::bigint,'a board status move writes exactly one audit entry');
select * from finish();
rollback;
