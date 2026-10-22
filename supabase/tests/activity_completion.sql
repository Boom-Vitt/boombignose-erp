begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.completion_id(n integer) returns uuid language sql immutable as $$
  select ('a2050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.completion_id(1),'completion-alice@example.invalid',now()),
  (pg_temp.completion_id(2),'completion-bob@example.invalid',now()),
  (pg_temp.completion_id(3),'completion-outsider@example.invalid',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.completion_id(10),'Completion workspace','completion-test-a'),
  (pg_temp.completion_id(20),'Foreign completion workspace','completion-test-b');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.completion_id(10),pg_temp.completion_id(1),'member'),
  (pg_temp.completion_id(10),pg_temp.completion_id(2),'member'),
  (pg_temp.completion_id(20),pg_temp.completion_id(3),'member');
insert into public.clients(id,org_id,name) values(pg_temp.completion_id(100),pg_temp.completion_id(10),'Completion client');
insert into public.activities(id,org_id,client_id,owner) values(pg_temp.completion_id(400),pg_temp.completion_id(10),pg_temp.completion_id(100),pg_temp.completion_id(1));
insert into public.activities(id,org_id,client_id,owner,done) values(pg_temp.completion_id(401),pg_temp.completion_id(10),pg_temp.completion_id(100),pg_temp.completion_id(1),true);
select ok((select completed_by is null and completed_at is null from public.activities where id=pg_temp.completion_id(400)),'open activity has no completion stamp');
select ok((select completed_by is null and completed_at is not null from public.activities where id=pg_temp.completion_id(401)),'system completion does not invent an assignee actor');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.completion_id(2))::text,true);
set local role authenticated;
select lives_ok($$update public.activities set done=true,completed_by=pg_temp.completion_id(1),completed_at='2000-01-01' where id=pg_temp.completion_id(400)$$,'teammate can complete an assigned activity');
select is((select completed_by from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(2),'completion credits Bob rather than assignee Alice or forged actor');
select is((select owner from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(1),'completion preserves original assignee');
select is((select completed_at from public.activities where id=pg_temp.completion_id(400)),now(),'completion uses database time rather than forged timestamp');
select lives_ok($$update public.activities set body='Edited',completed_by=pg_temp.completion_id(1),completed_at='2001-01-01' where id=pg_temp.completion_id(400)$$,'unrelated edits remain supported');
select is((select completed_by from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(2),'unrelated edit cannot rewrite completion actor');
select is((select completed_at from public.activities where id=pg_temp.completion_id(400)),now(),'unrelated edit cannot rewrite completion time');
select lives_ok($$insert into public.activities(id,org_id,client_id,owner,done,completed_by) values(pg_temp.completion_id(402),pg_temp.completion_id(10),pg_temp.completion_id(100),pg_temp.completion_id(1),true,pg_temp.completion_id(1))$$,'legacy completed insert is supported');
select is((select completed_by from public.activities where id=pg_temp.completion_id(402)),pg_temp.completion_id(2),'completed insert records actual actor');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.completion_id(1))::text,true);
set local role authenticated;
select lives_ok($$update public.activities set done=true where id=pg_temp.completion_id(400)$$,'repeated completion remains idempotent');
select is((select completed_by from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(2),'repeated completion preserves Bob attribution');
select lives_ok($$update public.activities set done=false where id=pg_temp.completion_id(400)$$,'legacy reopen is supported');
select ok((select completed_by is null and completed_at is null from public.activities where id=pg_temp.completion_id(400)),'reopen clears actor and time');
select lives_ok($$update public.activities set done=true where id=pg_temp.completion_id(400)$$,'legacy completion path is supported');
select is((select completed_by from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(1),'recompletion credits current actor Alice');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.completion_id(3))::text,true);
set local role authenticated;
select is((select count(*) from public.activities where id=pg_temp.completion_id(400)),0::bigint,'outsider cannot read completion metadata');
select lives_ok($$update public.activities set done=false where id=pg_temp.completion_id(400)$$,'foreign update has no visible rows');
reset role;
select is((select completed_by from public.activities where id=pg_temp.completion_id(400)),pg_temp.completion_id(1),'foreign update cannot change completion metadata');
select * from finish();
rollback;
