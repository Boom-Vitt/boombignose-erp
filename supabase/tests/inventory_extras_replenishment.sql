begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('b8100000-0000-4000-8000-000000000001','inventory-owner@example.invalid',now()),
 ('b8100000-0000-4000-8000-000000000002','inventory-member@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('b8100000-0000-4000-8000-000000000010','Inventory test','inventory-test'),
 ('b8100000-0000-4000-8000-000000000011','Other inventory','inventory-other');
insert into public.memberships(org_id,user_id,role) values
 ('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000001','owner'),
 ('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000002','member');
insert into public.org_settings(org_id) values('b8100000-0000-4000-8000-000000000010');
insert into public.vendors(id,org_id,name) values
 ('b8100000-0000-4000-8000-000000000020','b8100000-0000-4000-8000-000000000010','Inventory supplier');
insert into public.products(id,org_id,name,type,is_stockable,cost_satang,reorder_min,reorder_qty,default_vendor_id) values
 ('b8100000-0000-4000-8000-000000000030','b8100000-0000-4000-8000-000000000010','Inventory goods','goods',true,100,5,10,'b8100000-0000-4000-8000-000000000020'),
 ('b8100000-0000-4000-8000-000000000031','b8100000-0000-4000-8000-000000000011','Other goods','goods',true,200,0,0,null),
 ('b8100000-0000-4000-8000-000000000032','b8100000-0000-4000-8000-000000000010','Service','service',false,0,0,0,null);
insert into public.clients(id,org_id,name) values('b8100000-0000-4000-8000-000000000040','b8100000-0000-4000-8000-000000000010','Inventory buyer');
insert into public.invoices(id,org_id,client_id,number) values
 ('b8100000-0000-4000-8000-000000000050','b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000040','INV-STOCK-1'),
 ('b8100000-0000-4000-8000-000000000051','b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000040','INV-STOCK-2');
insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang) values
 ('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050','b8100000-0000-4000-8000-000000000030','Goods',3,'piece',200),
 ('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000051','b8100000-0000-4000-8000-000000000030','Goods',4,'piece',200);
select set_config('test.inventory_warehouse',(select id::text from public.warehouses where org_id='b8100000-0000-4000-8000-000000000010' and is_default),true);
select set_config('test.other_warehouse',(select id::text from public.warehouses where org_id='b8100000-0000-4000-8000-000000000011' and is_default),true);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8100000-0000-4000-8000-000000000011','b8100000-0000-4000-8000-000000000031',current_setting('test.other_warehouse')::uuid,'receipt',50,200,'adjustment',gen_random_uuid(),0,0);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.save_reorder_rule('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030','b8100000-0000-4000-8000-000000000020',5,10,7);
select is((select lead_days from public.replenishment_plan('b8100000-0000-4000-8000-000000000010','2026-10-23')),7,'plan uses product/vendor lead time');
select is((select expected_date::text from public.replenishment_plan('b8100000-0000-4000-8000-000000000010','2026-10-23')),'2026-10-30','preview calculates expected date');
select is((select order_quantity from public.replenishment_plan('b8100000-0000-4000-8000-000000000010','2026-10-23')),10::numeric,'preview calculates forecast order quantity');
select is((select count(*)::int from public.purchase_orders),0,'dry-run plan creates no RFQ');
reset role;
select is((select count(*)::int from public.document_counters where org_id='b8100000-0000-4000-8000-000000000010'),0,'dry-run plan consumes no document number');
set local role authenticated;
reset role;
insert into public.products(id,org_id,name,type,is_stockable) values('b8100000-0000-4000-8000-000000000033','b8100000-0000-4000-8000-000000000010','Slow goods','goods',true);
set local role authenticated;
select public.save_reorder_rule('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000033','b8100000-0000-4000-8000-000000000020',2,2,14);
select throws_ok($$select public.replenishment_plan('b8100000-0000-4000-8000-000000000011','2026-10-23')$$,'P0001','Workspace membership required','cross-workspace preview refused');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.create_replenishment_rfq('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020')$$,'P0001','Only owners and admins may manage inventory','scheduled creation is opt-in');
reset role;
update public.org_settings set scheduled_replenishment_enabled=true where org_id='b8100000-0000-4000-8000-000000000010';
set local role service_role;
select lives_ok($$select public.create_replenishment_rfq('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020')$$,'service role creates opted-in draft RFQ');
select is((select expected_date from public.purchase_orders where org_id='b8100000-0000-4000-8000-000000000010'),(now() at time zone 'Asia/Bangkok')::date+14,'vendor RFQ uses the longest selected lead time');
select is((select status::text from public.purchase_orders where org_id='b8100000-0000-4000-8000-000000000010'),'draft','scheduler leaves RFQ for review');
select throws_ok($$select public.create_replenishment_rfq('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020')$$,'P0001','No products require replenishment','retry sees draft quantities already on order');
select is((select count(*)::int from public.purchase_orders where org_id='b8100000-0000-4000-8000-000000000010'),1,'scheduled retry creates no duplicate RFQ');
select * from finish();rollback;
