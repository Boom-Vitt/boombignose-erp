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
values('b8100000-0000-4000-8000-000000000060','b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'b8100000-0000-4000-8000-000000000030','Retained description',6,100);
update public.org_settings set purchase_approval_threshold_satang=599 where org_id='b8100000-0000-4000-8000-000000000010';
select throws_ok($$select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'confirmed')$$,'P0001','Owner/admin approval required for current purchase content','above-threshold confirmation requires separate approval');
select lives_ok($$select public.approve_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid)$$,'owner explicitly approves');
select is((select approved_by::text from public.purchase_orders where id=current_setting('test.po')::uuid),'b8100000-0000-4000-8000-000000000001','approval retains actor');
delete from public.purchase_order_items where id='b8100000-0000-4000-8000-000000000060';
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang)
values('b8100000-0000-4000-8000-000000000060','b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'b8100000-0000-4000-8000-000000000030','Changed content at same amount',6,100);
select throws_ok($$select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'confirmed')$$,'P0001','Owner/admin approval required for current purchase content','same-total content change invalidates approval');
select public.approve_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid);
select lives_ok($$select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid,'confirmed')$$,'approved current content confirms');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.approve_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po')::uuid)$$,'P0001','Only owners and admins may approve purchases','member cannot approve');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001"}',true);
select set_config('test.po2',public.create_purchase_order('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020','2026-10-23')::text,true);
insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values('b8100000-0000-4000-8000-000000000010',current_setting('test.po2')::uuid,'At threshold',1,599);
select lives_ok($$select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.po2')::uuid,'confirmed')$$,'equal threshold does not require double validation');
select * from finish();rollback;
