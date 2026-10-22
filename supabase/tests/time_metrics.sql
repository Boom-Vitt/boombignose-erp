begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4000000-0000-4000-8000-000000000001','time-owner@example.test',now()),
 ('d4000000-0000-4000-8000-000000000002','time-member@example.test',now()),
 ('d4000000-0000-4000-8000-000000000003','time-other@example.test',now()),
 ('d4000000-0000-4000-8000-000000000004','time-outsider@example.test',now());
insert into public.organizations(id,name,slug) values('d4000000-0000-4000-8000-000000000010','Time metrics','time-metrics-test');
insert into public.memberships(org_id,user_id,role) values
 ('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000001','owner'),
 ('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000002','member'),
 ('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000003','member');
insert into public.clients(id,org_id,name) values('d4000000-0000-4000-8000-000000000020','d4000000-0000-4000-8000-000000000010','Time client');
insert into public.projects(id,org_id,client_id,name) values('d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000020','Time project');
insert into public.time_entries(id,org_id,project_id,user_id,minutes,billable,rate_satang) values
 ('d4000000-0000-4000-8000-000000000040','d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000002',11,true,150),
 ('d4000000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000003',60,false,3000),
 ('d4000000-0000-4000-8000-000000000042','d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000002',60,true,null);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$update public.time_entries set notes='Own edit' where id='d4000000-0000-4000-8000-000000000040'$$,'member edits own unbilled entry');
update public.time_entries set minutes=999 where id='d4000000-0000-4000-8000-000000000041';
delete from public.time_entries where id='d4000000-0000-4000-8000-000000000041';
select is((select minutes from public.time_entries where id='d4000000-0000-4000-8000-000000000041'),60,'member cannot edit or delete another entry');
select throws_ok($$update public.time_entries set user_id='d4000000-0000-4000-8000-000000000003' where id='d4000000-0000-4000-8000-000000000040'$$,'P0001','Time author is immutable','cannot reassign authorship');
select throws_ok($$select public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000050')$$,'P0001','Only staff may bill time','member cannot bill');
select throws_ok($$select public.set_member_cost_rate('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000002',150)$$,'P0001','Only staff may set cost rates','member cannot set cost rate');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$update public.time_entries set notes='Staff edit' where id='d4000000-0000-4000-8000-000000000041'$$,'staff edits any unbilled entry');
select lives_ok($$select public.set_member_cost_rate('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000002',150)$$,'staff sets cost rate');
select lives_ok($$select public.set_member_cost_rate('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000003',3000)$$,'staff sets another member rate');
select is((select labour_cost_satang from public.project_labour_totals where project_id='d4000000-0000-4000-8000-000000000030'),3178::bigint,'labour includes non-billable and unrated time');
select is((select count(*) from public.memberships where org_id='d4000000-0000-4000-8000-000000000010'),3::bigint,'staff can read all team cost rates');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-4000-8000-000000000002"}',true);
select is((select count(*) from public.project_labour_totals where project_id='d4000000-0000-4000-8000-000000000030'),0::bigint,'member reads no labour total; it is staff-only');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-4000-8000-000000000001"}',true);
select set_config('test.time_invoice',public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000050')::text,true);
select is((select status::text from public.invoices where id=current_setting('test.time_invoice')::uuid),'draft','billing inserts a draft through existing guards');
select is((select amount_satang from public.invoices where id=current_setting('test.time_invoice')::uuid),28::bigint,'exact half satang rounds up on invoice');
select is((select count(*) from public.invoice_items where invoice_id=current_setting('test.time_invoice')::uuid),1::bigint,'only rated billable entry is billed');
select ok((select invoice_id=current_setting('test.time_invoice')::uuid and invoice_item_id is not null from public.time_entries where id='d4000000-0000-4000-8000-000000000040'),'entry links to invoice and its line');
select is(public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000050'),current_setting('test.time_invoice')::uuid,'retry returns same draft');
select throws_ok($$select public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000051')$$,'P0001','No billable unbilled time','another command cannot double bill');
update public.time_entries set minutes=888 where id='d4000000-0000-4000-8000-000000000040';
delete from public.time_entries where id='d4000000-0000-4000-8000-000000000040';
select is((select minutes from public.time_entries where id='d4000000-0000-4000-8000-000000000040'),11,'even staff cannot change or delete billed draft time');
select throws_ok($$update public.time_entries set invoice_id=current_setting('test.time_invoice')::uuid where id='d4000000-0000-4000-8000-000000000041'$$,'P0001','Time billing links require the billing command','direct attachment changes are blocked');
select public.cancel_draft_invoice('d4000000-0000-4000-8000-000000000010',current_setting('test.time_invoice')::uuid);
select lives_ok($$update public.time_entries set notes='Corrected after cancellation' where id='d4000000-0000-4000-8000-000000000040'$$,'cancelled invoice unlocks time');
select set_config('test.time_rebill',public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000052')::text,true);
select isnt(current_setting('test.time_rebill'),current_setting('test.time_invoice'),'cancelled time may be rebilled to a new draft');
reset role;
insert into public.time_entries(org_id,project_id,user_id,minutes,billable,rate_satang)
select 'd4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000002',60,true,100 from generate_series(1,1001);
set local role authenticated;
select set_config('test.time_bulk',public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030','d4000000-0000-4000-8000-000000000053')::text,true);
select is((select count(*) from public.invoice_items where invoice_id=current_setting('test.time_bulk')::uuid),1001::bigint,'billing processes more than the API row cap');
select is((select amount_satang from public.invoices where id=current_setting('test.time_bulk')::uuid),100100::bigint,'billing total includes every entry');
reset role;
insert into public.projects(id,org_id,client_id,name) values('d4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000020','Rollback project');
insert into public.time_entries(org_id,project_id,user_id,minutes,billable,rate_satang,notes)
values('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000002',60,true,100,'INJECT-FAIL');
create function public.test_fail_time_billing() returns trigger language plpgsql as $$
begin
  if new.description like '%INJECT-FAIL%' then raise exception 'Injected time billing failure';end if;
  return new;
end;
$$;
create trigger zz_fail_time_billing before insert on public.invoice_items for each row execute function public.test_fail_time_billing();
set local role authenticated;
select throws_ok($$select public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000054')$$,'P0001','Injected time billing failure','line failure aborts the whole billing command');
select is((select count(*) from public.invoices where project_id='d4000000-0000-4000-8000-000000000031'),0::bigint,'failed billing leaves no orphan draft');
select is((select count(*) from public.time_billing_requests where key='d4000000-0000-4000-8000-000000000054'),0::bigint,'failed billing leaves no idempotency result');
select is((select count(*) from public.time_entries where project_id='d4000000-0000-4000-8000-000000000031' and invoice_id is null),1::bigint,'failed billing leaves source time unbilled');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-4000-8000-000000000004"}',true);
select is((select count(*) from public.time_entries),0::bigint,'outsider sees no time');
select is((select count(*) from public.project_labour_totals),0::bigint,'outsider sees no labour totals');
select throws_ok($$select public.bill_project_time('d4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000030',gen_random_uuid())$$,'P0001','Only staff may bill time','outsider cannot bill');
reset role;
select * from finish();
rollback;
