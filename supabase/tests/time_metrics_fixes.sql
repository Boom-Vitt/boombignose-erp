begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4100000-0000-4000-8000-000000000001','time-fix-owner@example.test',now()),
 ('d4100000-0000-4000-8000-000000000002','time-fix-member@example.test',now()),
 ('d4100000-0000-4000-8000-000000000003','time-fix-coworker@example.test',now()),
 ('d4100000-0000-4000-8000-000000000004','time-fix-delete@example.test',now()),
 ('d4100000-0000-4000-8000-000000000005','time-fix-outsider@example.test',now());
insert into public.organizations(id,name,slug) values('d4100000-0000-4000-8000-000000000010','Time fixes','time-fixes-test');
insert into public.memberships(org_id,user_id,role) values
 ('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000001','owner'),
 ('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000002','member'),
 ('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000003','member'),
 ('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000004','member');
insert into public.clients(id,org_id,name) values('d4100000-0000-4000-8000-000000000020','d4100000-0000-4000-8000-000000000010','Time fix buyer');
insert into public.projects(id,org_id,client_id,name) values('d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000020','Time fix project');
insert into public.time_entries(id,org_id,project_id,user_id,minutes,billable,rate_satang) values
 ('d4100000-0000-4000-8000-000000000040','d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000002',11,true,150),
 ('d4100000-0000-4000-8000-000000000041','d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000003',60,false,3000),
 ('d4100000-0000-4000-8000-000000000042','d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000004',30,false,null);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4100000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.set_member_cost_rate('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000002',150);
select public.set_member_cost_rate('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000003',3000);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4100000-0000-4000-8000-000000000002"}',true);
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure('private.time_member_cost_rate(uuid,uuid)'),'execute'),false),'member cannot execute an individual rate getter');
select ok(not exists(select 1 from public.memberships m where to_jsonb(m)?'cost_rate_satang'),'membership rows expose no individual rate, including own');
select results_eq(case when to_regclass('public.member_cost_rates') is null then
 $$select cost_rate_satang from public.memberships where org_id='d4100000-0000-4000-8000-000000000010'$$ else
 $$select cost_rate_satang from public.member_cost_rates where org_id='d4100000-0000-4000-8000-000000000010'$$ end,
 $$select 0::bigint where false$$,'member cannot select any individual cost rate');
select is((select labour_cost_satang from public.project_labour_totals where project_id='d4100000-0000-4000-8000-000000000030'),3028::bigint,'member still sees complete project labour aggregate');
select throws_ok($$update public.time_entries set user_id=null where id='d4100000-0000-4000-8000-000000000040'$$,'P0001','Time author is immutable','member cannot forge author null-out');
select throws_ok($$select public.set_member_cost_rate('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000002',1)$$,'P0001','Only staff may set cost rates','member cannot change even own rate');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4100000-0000-4000-8000-000000000001"}',true);
select results_eq(case when to_regclass('public.member_cost_rates') is null then
 $$select cost_rate_satang from public.memberships where org_id='d4100000-0000-4000-8000-000000000010' and user_id='d4100000-0000-4000-8000-000000000003'$$ else
 $$select cost_rate_satang from public.member_cost_rates where org_id='d4100000-0000-4000-8000-000000000010' and user_id='d4100000-0000-4000-8000-000000000003'$$ end,
 $$select 3000::bigint$$,'staff can read and manage team rates');
select set_config('test.fix_invoice_a',public.bill_project_time('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000050')::text,true);
select public.cancel_draft_invoice('d4100000-0000-4000-8000-000000000010',current_setting('test.fix_invoice_a')::uuid);
select set_config('test.fix_invoice_b',public.bill_project_time('d4100000-0000-4000-8000-000000000010','d4100000-0000-4000-8000-000000000030','d4100000-0000-4000-8000-000000000051')::text,true);
select isnt(current_setting('test.fix_invoice_a'),current_setting('test.fix_invoice_b'),'cancelled time is rebilled into a different draft');
select throws_ok($$update public.invoices set status='draft' where id=current_setting('test.fix_invoice_a')::uuid$$,'P0001','Cancelled draft is final','rebilled source draft cannot reopen through a client write');
select throws_ok($$select public.issue_invoice('d4100000-0000-4000-8000-000000000010',current_setting('test.fix_invoice_a')::uuid,(select version from public.invoices where id=current_setting('test.fix_invoice_a')::uuid),'d4100000-0000-4000-8000-000000000052')$$,'P0001','Draft at expected version required','cancelled original cannot issue retained time lines');
select is((select invoice_id from public.time_entries where id='d4100000-0000-4000-8000-000000000040'),current_setting('test.fix_invoice_b')::uuid,'time remains linked only to the replacement invoice');
reset role;
select throws_ok($$update public.invoices set status='draft' where id=current_setting('test.fix_invoice_a')::uuid$$,'P0001','Cancelled draft is final','database owner cannot bypass final cancellation either');
select lives_ok($$delete from auth.users where id='d4100000-0000-4000-8000-000000000004'$$,'auth user deletion can clean up an unbilled time author');
select ok((select user_id is null from public.time_entries where id='d4100000-0000-4000-8000-000000000042'),'unbilled time survives user deletion with a null author');
select lives_ok($$delete from auth.users where id='d4100000-0000-4000-8000-000000000002'$$,'auth user deletion also retains billed time');
select ok((select user_id is null and invoice_id=current_setting('test.fix_invoice_b')::uuid from public.time_entries where id='d4100000-0000-4000-8000-000000000040'),'referential cleanup preserves the billed invoice link');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4100000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$update public.time_entries set user_id=null where id='d4100000-0000-4000-8000-000000000041'$$,'P0001','Time author is immutable','staff cannot forge referential cleanup while user exists');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4100000-0000-4000-8000-000000000005"}',true);
select is((select count(*) from public.project_labour_totals),0::bigint,'outsider sees no project aggregate');
select is((select count(*) from private.project_labour_totals('d4100000-0000-4000-8000-000000000010')),0::bigint,'aggregate function itself enforces workspace membership');
reset role;
select * from finish();
rollback;
