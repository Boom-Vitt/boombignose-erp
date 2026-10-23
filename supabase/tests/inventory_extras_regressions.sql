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
select public.update_business_profile('b8100000-0000-4000-8000-000000000010','Inventory seller','Inventory address',null,'unknown');
set local role authenticated;
select set_config('test.po',public.create_purchase_order('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020','2026-10-23')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang)
values('b8100000-0000-4000-8000-000000000060','b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'b8100000-0000-4000-8000-000000000032','Retained description',6,100);
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,0,'No-op count','b8100000-0000-4000-8000-000000000090');
select public.save_warehouse('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_warehouse')::uuid,'MAIN','Inactive warehouse',null,false,false);
select lives_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,0,'No-op count','b8100000-0000-4000-8000-000000000090')$$,'matching saved count acknowledges after warehouse deactivation');
select is((select count(*)::int from public.stock_moves where org_id='b8100000-0000-4000-8000-000000000010'),0,'count retry creates no stock move');
select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'confirmed');
select lives_ok($$select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000060","previous_received_quantity":0,"received_quantity":3}]')$$,'service-only PO receives without an active/default warehouse');
select is((select count(*)::int from public.stock_documents),1,'service receipt retains a GRN');
select ok((select warehouse_id is null from public.stock_documents),'service GRN permits no warehouse');
select is((select count(*)::int from public.stock_moves where org_id='b8100000-0000-4000-8000-000000000010'),0,'service receipt creates no stock move');
select set_config('test.po2',public.create_purchase_order('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020','2026-10-23')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang) values('b8100000-0000-4000-8000-000000000061','b8100000-0000-4000-8000-000000000010',current_setting('test.po2')::uuid,'b8100000-0000-4000-8000-000000000030','Needs warehouse',1,100);
select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po2')::uuid,'confirmed');
select throws_ok($$select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po2')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000061","previous_received_quantity":0,"received_quantity":1}]')$$,'P0001','Active workspace warehouse required','stockable receipt still requires an active warehouse');
select * from finish();rollback;
