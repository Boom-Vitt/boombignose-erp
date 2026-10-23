\connect postgres supabase_admin
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(6);
select extensions.dblink_connect('credit_a','dbname=postgres user=postgres application_name=w5b_credit_a');
select extensions.dblink_connect('credit_b','dbname=postgres user=postgres application_name=w5b_credit_b');
select extensions.dblink_exec('credit_a',$fixture$
do $setup$
begin
  insert into auth.users(id,email) values('b9540000-0000-4000-8000-000000000001','credit-concurrency@example.invalid');
  insert into public.organizations(id,name,slug) values('b9540000-0000-4000-8000-000000000010','Credit concurrency','credit-concurrency');
  insert into public.memberships(org_id,user_id,role) values('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000001','owner');
  insert into public.vendors(id,org_id,name) values('b9540000-0000-4000-8000-000000000020','b9540000-0000-4000-8000-000000000010','Concurrent supplier');
  insert into public.purchase_orders(id,org_id,number,vendor_id,status) values('b9540000-0000-4000-8000-000000000060','b9540000-0000-4000-8000-000000000010','CONCURRENT-60','b9540000-0000-4000-8000-000000000020','confirmed');
  insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang) values('b9540000-0000-4000-8000-000000000160','b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','Concurrent returns',10,100);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"b9540000-0000-4000-8000-000000000001"}',true);
  perform public.receive_purchase_order('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','[{"id":"b9540000-0000-4000-8000-000000000160","received_quantity":5,"previous_received_quantity":0}]');
  perform public.bill_purchase_order('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','{"vendor_reference":"CONCURRENT-A","bill_date":"2026-10-01","input_vat_rate":7,"input_vat_satang":35,"vendor_total_satang":535}');
  perform public.receive_purchase_order('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','[{"id":"b9540000-0000-4000-8000-000000000160","received_quantity":10,"previous_received_quantity":5}]');
  perform public.bill_purchase_order('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','{"vendor_reference":"CONCURRENT-B","bill_date":"2026-10-01","input_vat_rate":7,"input_vat_satang":70,"vendor_total_satang":1070,"variance_reason":"Accepted price","lines":[{"id":"b9540000-0000-4000-8000-000000000160","quantity":5,"expected_quantity":5,"unit_cost_satang":200}]}');
  perform public.return_purchase_order('b9540000-0000-4000-8000-000000000010','b9540000-0000-4000-8000-000000000060','[{"id":"b9540000-0000-4000-8000-000000000160","returned_quantity":10}]');
end
$setup$;
$fixture$);
create temporary table credit_command as
select format('select public.link_vendor_credit(%L,%L,%L::jsonb)',
  'b9540000-0000-4000-8000-000000000010',
  (select id from public.costs where purchase_order_id='b9540000-0000-4000-8000-000000000060' and purchase_cost_kind='credit'),
  jsonb_build_object('vendor_reference','CONCURRENT-CN','bill_date','2026-10-23','input_vat_satang',105,
    'allocations',(select jsonb_agg(jsonb_build_object('original_bill_id',id,'lines','[{"id":"b9540000-0000-4000-8000-000000000160","quantity":5}]'::jsonb) order by id) from public.vendor_bill_matches where purchase_order_id='b9540000-0000-4000-8000-000000000060' and kind='bill'))) as sql;
select extensions.dblink_exec('credit_a',$auth$set request.jwt.claims='{"role":"authenticated","sub":"b9540000-0000-4000-8000-000000000001"}'; set role authenticated; begin$auth$);
select extensions.dblink_exec('credit_b',$auth$set request.jwt.claims='{"role":"authenticated","sub":"b9540000-0000-4000-8000-000000000001"}'; set role authenticated$auth$);
create temporary table credit_results(actor text,id uuid);
insert into credit_results select 'a',id from extensions.dblink('credit_a',(select sql from credit_command)) as result(id uuid);
select extensions.dblink_send_query('credit_b',(select sql from credit_command));
do $$begin
  for attempt in 1..100 loop
    exit when exists(select 1 from pg_stat_activity where application_name='w5b_credit_b' and wait_event_type='Lock');
    perform pg_sleep(0.01);
  end loop;
end$$;
select ok(exists(select 1 from pg_stat_activity where application_name='w5b_credit_b' and wait_event_type='Lock'),'competing credit waits on the purchase-order transaction');
select extensions.dblink_exec('credit_a','commit');
insert into credit_results select 'b',id from extensions.dblink_get_result('credit_b') as result(id uuid);
select * from extensions.dblink_get_result('credit_b') as drained(id uuid);
select is((select id from credit_results where actor='a'),(select id from credit_results where actor='b'),'concurrent identical retries return the same match');
select is((select count(*)::int from public.vendor_bill_matches where vendor_reference='CONCURRENT-CN'),1,'concurrency creates one vendor credit reference');
select is((select sum(amount_satang) from public.costs where vendor_invoice_reference='CONCURRENT-CN'),(-1605)::numeric,'concurrency reverses the matched bases and VAT once');
select is((select sum(amount_satang) from public.costs where purchase_order_id='b9540000-0000-4000-8000-000000000060'),0::numeric,'concurrent full return leaves no residual cost');
select throws_ok(format('select * from extensions.dblink(%L,%L) as changed(id uuid)','credit_b',replace((select sql from credit_command),'CONCURRENT-CN','CONCURRENT-OTHER')),'P0001','Vendor credit already linked with different evidence','another reference cannot consume the same source return');
select extensions.dblink_exec('credit_a',$cleanup$
reset role;
do $$begin
  delete from public.audit_log where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.costs where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.vendor_bill_matches where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.purchase_order_items where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.purchase_orders where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.vendors where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.warehouses where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.org_settings where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.memberships where org_id='b9540000-0000-4000-8000-000000000010';
  delete from public.organizations where id='b9540000-0000-4000-8000-000000000010';
  delete from auth.users where id='b9540000-0000-4000-8000-000000000001';
end$$;
$cleanup$);
select extensions.dblink_disconnect('credit_a');
select extensions.dblink_disconnect('credit_b');
select * from finish();
rollback;
