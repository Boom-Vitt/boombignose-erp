begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('b7000000-0000-4000-8000-000000000001','expense-owner@example.com',now()),
 ('b7000000-0000-4000-8000-000000000002','expense-admin@example.com',now()),
 ('b7000000-0000-4000-8000-000000000003','expense-member@example.com',now()),
 ('b7000000-0000-4000-8000-000000000004','expense-teammate@example.com',now()),
 ('b7000000-0000-4000-8000-000000000005','expense-outsider@example.com',now());
insert into public.organizations(id,name,slug) values
 ('b7000000-0000-4000-8000-000000000010','Expense test','expense-test'),
 ('b7000000-0000-4000-8000-000000000011','Other expense test','other-expense-test');
insert into public.memberships(org_id,user_id,role) values
 ('b7000000-0000-4000-8000-000000000010','b7000000-0000-4000-8000-000000000001','owner'),
 ('b7000000-0000-4000-8000-000000000010','b7000000-0000-4000-8000-000000000002','admin'),
 ('b7000000-0000-4000-8000-000000000010','b7000000-0000-4000-8000-000000000003','member'),
 ('b7000000-0000-4000-8000-000000000010','b7000000-0000-4000-8000-000000000004','member'),
 ('b7000000-0000-4000-8000-000000000011','b7000000-0000-4000-8000-000000000005','owner');
insert into public.projects(id,org_id,name) values('b7000000-0000-4000-8000-000000000020','b7000000-0000-4000-8000-000000000010','Rebillable project');
create function public.test_fail_expense_approval() returns trigger language plpgsql as $$
begin
  if new.status='approved' then raise exception 'Injected approval failure'; end if;
  return new;
end;
$$;
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.expense_claims'::regclass,'public.expense_lines'::regclass)),'expense tables force RLS');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select set_config('test.claim',public.create_expense_claim('b7000000-0000-4000-8000-000000000010','Client visit')::text,true);
select is((select number from public.expense_claims where id=current_setting('test.claim')::uuid),'EXP-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-001','claim numbered EXP-YYYY-001');
select is((select employee from public.expense_claims where id=current_setting('test.claim')::uuid),'b7000000-0000-4000-8000-000000000003'::uuid,'caller is the claimant');
select lives_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,category,description,amount_satang,project_id,position) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-20','other','Taxi',25050,'b7000000-0000-4000-8000-000000000020',0)$$,'claimant adds a rebillable line');
select lives_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,category,description,amount_satang,position) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-21','software','Domain renewal',49900,1)$$,'claimant adds a second line');
select throws_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,description,amount_satang) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-21','Free',0)$$,'23514',null,'zero amount rejected');
select throws_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,description,amount_satang) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-21','Unsafe',9007199254740991)$$,'P0001','Expense total exceeds safe satang bounds','unsafe claim total rejected');
select throws_ok($$update public.expense_claims set status='approved' where id=current_setting('test.claim')::uuid$$,'42501',null,'status cannot bypass commands');
select throws_ok($$insert into public.costs(org_id,amount_satang,expense_claim_id) values('b7000000-0000-4000-8000-000000000010',100,current_setting('test.claim')::uuid)$$,'P0001','Expense costs follow their claim','claim costs cannot be forged');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'P0001','Only owners and admins may decide expense claims','member cannot approve');
select set_config('test.empty',public.create_expense_claim('b7000000-0000-4000-8000-000000000010','Empty claim')::text,true);
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.empty')::uuid,'submitted')$$,'P0001','Add expense lines first','empty claim cannot be submitted');
select lives_ok($$insert into public.record_notes(org_id,record_type,record_id,author,body) values('b7000000-0000-4000-8000-000000000010','expense_claim',current_setting('test.claim')::uuid,'b7000000-0000-4000-8000-000000000003','Receipt attached')$$,'claimant notes own claim');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'submitted')$$,'claimant submits');
select is((select status::text from public.expense_claims where id=current_setting('test.claim')::uuid),'submitted','claim is submitted');
select throws_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,description,amount_satang) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-21','Late',100)$$,'P0001','Only draft expense lines are editable','submitted lines are frozen');
delete from public.expense_lines where claim_id=current_setting('test.claim')::uuid;
update public.activities set done=true where record_id=current_setting('test.claim')::uuid;
select is((select count(*)::int from public.activities where record_id=current_setting('test.claim')::uuid and not done),2,'claimant sees but cannot complete approver tasks');
select is((select count(*)::int from public.expense_lines where claim_id=current_setting('test.claim')::uuid),2,'submitted lines cannot be deleted');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000004"}',true);
select is((select count(*)::int from public.expense_claims),0,'members cannot see other claims');
select is((select count(*)::int from public.expense_lines),0,'members cannot see other claim lines');
select is((select count(*)::int from public.record_notes where record_type='expense_claim'),0,'members cannot read notes on other claims');
select ok(not private.record_exists('b7000000-0000-4000-8000-000000000010','expense_claim',current_setting('test.claim')::uuid),'record history hides other claims');
select is((select count(*)::int from public.activities where record_type='expense_claim'),0,'members cannot see approval tasks on other claims');
delete from public.activities where record_id=current_setting('test.claim')::uuid;
select throws_ok($$insert into public.expense_lines(org_id,claim_id,spent_on,description,amount_satang) values('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'2026-10-21','Sneaky',100)$$,'P0001','Expense claim unavailable','members cannot add lines to other claims');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'P0001','Expense claim unavailable','members cannot decide other claims');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000001"}',true);
select is((select count(*)::int from public.expense_claims),2,'staff see every claim');
select ok(private.record_exists('b7000000-0000-4000-8000-000000000010','expense_claim',current_setting('test.claim')::uuid),'expense claim history supported');
select is((select count(*)::int from public.activities where record_type='expense_claim' and record_id=current_setting('test.claim')::uuid and not done),2,'submit schedules one activity per approver');
select ok(not exists(select 1 from public.activities where record_id=current_setting('test.claim')::uuid and owner='b7000000-0000-4000-8000-000000000003'),'claimant gets no approval activity');
select set_config('test.own',public.create_expense_claim('b7000000-0000-4000-8000-000000000010','Owner travel')::text,true);
insert into public.expense_lines(org_id,claim_id,spent_on,description,amount_satang) values('b7000000-0000-4000-8000-000000000010',current_setting('test.own')::uuid,'2026-10-22','Train',12000);
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.own')::uuid,'submitted')$$,'owner submits own claim');
select is((select owner from public.activities where record_id=current_setting('test.own')::uuid),'b7000000-0000-4000-8000-000000000002'::uuid,'own claim goes to the other approver');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.own')::uuid,'approved')$$,'P0001','Nobody may decide their own expense claim','no self-approval');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.own')::uuid,'rejected','Mine')$$,'P0001','Nobody may decide their own expense claim','no self-rejection');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.own')::uuid,'draft')$$,'claimant withdraws a submitted claim');
select ok((select status='draft' and submitted_at is null from public.expense_claims where id=current_setting('test.own')::uuid),'withdrawn claim is a draft again');
select is((select count(*)::int from public.activities where record_id=current_setting('test.own')::uuid and not done),0,'withdraw closes approval tasks');

reset role;
create trigger test_fail_expense_approval before update on public.expense_claims for each row execute function public.test_fail_expense_approval();
set local role authenticated;
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'P0001','Injected approval failure','approval failure surfaces');
select is((select count(*)::int from public.costs where expense_claim_id=current_setting('test.claim')::uuid),0,'failed approval leaves no costs');
select is((select status::text from public.expense_claims where id=current_setting('test.claim')::uuid),'submitted','failed approval leaves the claim submitted');
reset role;
drop trigger test_fail_expense_approval on public.expense_claims;
set local role authenticated;

select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'owner approves');
select is((select count(*)::int from public.costs where expense_claim_id=current_setting('test.claim')::uuid),2,'approval creates one cost per line');
select is((select sum(amount_satang)::bigint from public.costs where expense_claim_id=current_setting('test.claim')::uuid),74950::bigint,'costs equal the claim total');
select is((select string_agg(category::text||':'||incurred_on::text||':'||coalesce(project_id::text,'-'),',' order by amount_satang) from public.costs where expense_claim_id=current_setting('test.claim')::uuid),
  'other:2026-10-20:b7000000-0000-4000-8000-000000000020,software:2026-10-21:-','costs keep category, date and project');
select is((select string_agg(distinct vendor||'/'||bill_number||'/'||notes,',') from public.costs where expense_claim_id=current_setting('test.claim')::uuid),
  (select 'Employee expense/'||number||'/Expense claim '||number from public.expense_claims where id=current_setting('test.claim')::uuid),'member-readable costs carry the claim number, not personal details');
select is((select count(*)::int from public.activities where record_id=current_setting('test.claim')::uuid and not done),0,'decision closes approver activities');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'approval retry is a no-op');
select is((select count(*)::int from public.costs where expense_claim_id=current_setting('test.claim')::uuid),2,'retry does not duplicate costs');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,null)$$,'P0001','Invalid expense transition','a null target cannot reopen an approved claim');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000001"}',true);
select is((select status::text from public.expense_claims where id=current_setting('test.claim')::uuid),'approved','claim stays approved');
select throws_ok($$delete from public.costs where expense_claim_id=current_setting('test.claim')::uuid$$,'P0001','Expense costs follow their claim','claim costs cannot be deleted directly');
select throws_ok($$update public.costs set amount_satang=1 where expense_claim_id=current_setting('test.claim')::uuid$$,'P0001','Expense costs follow their claim','claim costs cannot be edited directly');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'rejected','  ')$$,'P0001','Rejection reason required','rejection needs a reason');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'rejected','Missing receipt')$$,'owner rejects the approved claim');
select is((select count(*)::int from public.costs where expense_claim_id=current_setting('test.claim')::uuid),0,'rejection leaves no orphan costs');
select is((select status::text||':'||decision_note from public.expense_claims where id=current_setting('test.claim')::uuid),'rejected:Missing receipt','rejection keeps its reason');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'draft')$$,'P0001','Only the claimant may submit, withdraw or reopen an expense claim','only the claimant reopens');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'draft')$$,'claimant reopens');
select ok((select status='draft' and submitted_at is null and decided_by is null and decision_note is null from public.expense_claims where id=current_setting('test.claim')::uuid),'reopen clears the decision');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'submitted')$$,'claimant resubmits');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'paid')$$,'P0001','Only owners and admins may decide expense claims','member cannot mark paid');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'paid')$$,'P0001','Invalid expense transition','submitted claim cannot skip approval');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'approved')$$,'admin approves');
select lives_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'paid')$$,'admin marks paid');
select ok((select paid_at is not null from public.expense_claims where id=current_setting('test.claim')::uuid),'paid sets paid_at');
select is((select count(*)::int from public.costs where expense_claim_id=current_setting('test.claim')::uuid and paid_at is not null),2,'paid stamps the claim costs');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'rejected','Too late')$$,'P0001','Invalid expense transition','paid claims are final');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000005"}',true);
select is((select count(*)::int from public.expense_claims),0,'other workspace sees no claims');
select throws_ok($$select public.create_expense_claim('b7000000-0000-4000-8000-000000000010','Cross tenant')$$,'P0001','Workspace membership required','cross tenant claim rejected');
select throws_ok($$select public.transition_expense_claim('b7000000-0000-4000-8000-000000000010',current_setting('test.claim')::uuid,'rejected','No')$$,'P0001','Workspace membership required','cross tenant decision rejected');
reset role;
set local role anon;
select throws_ok($$select * from public.expense_claims$$,'42501',null,'anonymous claim access denied');
reset role;
select * from finish();
rollback;
