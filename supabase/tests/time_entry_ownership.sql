-- Members change only their own time entries; owners and admins change any.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
insert into auth.users(id,email,email_confirmed_at) values
  ('b9200000-0000-4000-8000-000000000001','te-owner@example.test',now()),
  ('b9200000-0000-4000-8000-000000000002','te-member@example.test',now());
insert into organizations(id,name,slug) values('b9200000-0000-4000-8000-000000000003','Synthetic time org','synthetic-time-org');
insert into memberships(org_id,user_id,role) values
  ('b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000001','owner'),
  ('b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000002','member');
insert into clients(id,org_id,name) values('b9200000-0000-4000-8000-000000000004','b9200000-0000-4000-8000-000000000003','Synthetic client');
insert into projects(id,org_id,client_id,name) values('b9200000-0000-4000-8000-000000000005','b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000004','Synthetic project');
insert into time_entries(id,org_id,project_id,user_id,minutes) values
  ('b9200000-0000-4000-8000-000000000006','b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000005','b9200000-0000-4000-8000-000000000001',60),
  ('b9200000-0000-4000-8000-000000000007','b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000005','b9200000-0000-4000-8000-000000000002',30),
  ('b9200000-0000-4000-8000-000000000008','b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000005','b9200000-0000-4000-8000-000000000002',45);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9200000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
delete from time_entries where id='b9200000-0000-4000-8000-000000000006';
update time_entries set minutes=1 where id='b9200000-0000-4000-8000-000000000006';
delete from time_entries where id='b9200000-0000-4000-8000-000000000007';
select throws_ok($$insert into time_entries(org_id,project_id,user_id,minutes) values('b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000005','b9200000-0000-4000-8000-000000000001',15)$$,'42501',null,'member cannot log hours in a colleague''s name');
reset role;
select is((select minutes from time_entries where id='b9200000-0000-4000-8000-000000000006'),60,'member cannot delete or rewrite a colleague''s entry');
select is((select count(*) from time_entries where id='b9200000-0000-4000-8000-000000000007'),0::bigint,'member deletes their own entry');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9200000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
update time_entries set minutes=40 where id='b9200000-0000-4000-8000-000000000008';
reset role;
select is((select minutes from time_entries where id='b9200000-0000-4000-8000-000000000008'),40,'owner corrects a member''s entry');
set local role authenticated;
delete from time_entries where id='b9200000-0000-4000-8000-000000000008';
reset role;
select is((select count(*) from time_entries where id='b9200000-0000-4000-8000-000000000008'),0::bigint,'owner deletes a member''s entry');
select * from finish();
rollback;
