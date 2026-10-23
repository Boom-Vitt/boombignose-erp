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
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.warehouses'::regclass),'warehouse RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.stock_moves'::regclass),'ledger RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.stock_counts'::regclass),'count command RLS forced');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.stock_on_hand'::regclass),'balances invoke caller RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.inventory_totals'::regclass),'totals invoke caller RLS');
select is((select count(*)::int from public.warehouses where org_id='b8100000-0000-4000-8000-000000000010' and is_default),1,'new workspace has one default');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001"}',true);
select public.update_business_profile('b8100000-0000-4000-8000-000000000010','Inventory seller','Inventory address',null,'unknown');
set local role authenticated;
select is((select count(*)::int from public.warehouses),1,'other workspace warehouses hidden');
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,'receipt',100,100,'adjustment',gen_random_uuid(),0,0)$$,'42501',null,'direct insert cannot bypass posting validation');
select throws_ok($$update public.stock_moves set quantity=1$$,'42501',null,'ledger cannot update');
select throws_ok($$delete from public.stock_moves$$,'42501',null,'ledger cannot delete');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000011','b8100000-0000-4000-8000-000000000031',current_setting('test.other_warehouse')::uuid,2,'cross tenant',gen_random_uuid())$$,'P0001','Only owners and admins may manage inventory','cross workspace command denied');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000031',current_setting('test.inventory_warehouse')::uuid,2,'cross product',gen_random_uuid())$$,'P0001','Stockable workspace product required','cross workspace product denied');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.other_warehouse')::uuid,2,'cross warehouse',gen_random_uuid())$$,'P0001','Active workspace warehouse required','cross workspace warehouse denied');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000032',current_setting('test.inventory_warehouse')::uuid,2,'service',gen_random_uuid())$$,'P0001','Stockable workspace product required','service cannot receive stock');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,2,'',gen_random_uuid())$$,'P0001','Valid count and reason required','count requires reason');
select throws_ok($$select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050')$$,'P0001','Issued invoice required','draft invoice cannot deliver');

select set_config('test.inventory_po',public.create_purchase_order('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020','2026-10-24')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang)
 values('b8100000-0000-4000-8000-000000000060','b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'b8100000-0000-4000-8000-000000000030','Stock goods',6,100);
select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'confirmed');
select lives_ok($$select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000060","previous_received_quantity":0,"received_quantity":2}]')$$,'partial receipt posts');
select is((select quantity from public.stock_on_hand),2::numeric,'partial receipt increases stock');
select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000060","previous_received_quantity":2,"received_quantity":2}]');
select is((select count(*)::int from public.stock_moves),1,'identical receipt does not double post');
select throws_ok($$select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000060","previous_received_quantity":2,"received_quantity":6},{"id":"b8100000-0000-4000-8000-000000000099","received_quantity":1}]')$$,'P0001','Receipt line unavailable','invalid later line rolls transaction back');
select is((select quantity from public.stock_on_hand),2::numeric,'failed receipt leaves no stock');
select is((select received_quantity from public.purchase_order_items where id='b8100000-0000-4000-8000-000000000060'),2::numeric,'failed receipt leaves received total');
select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000060","previous_received_quantity":2,"received_quantity":6}]');
select is((select quantity from public.stock_on_hand),6::numeric,'incremental receipt posts delta only');
select is((select value_satang from public.stock_on_hand),600::bigint,'receipt value in satang');

select public.issue_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050',(select version from public.invoices where id='b8100000-0000-4000-8000-000000000050'),gen_random_uuid());
select public.issue_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000051',(select version from public.invoices where id='b8100000-0000-4000-8000-000000000051'),gen_random_uuid());
select lives_ok($$select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050')$$,'issued invoice delivers');
select is((select quantity from public.stock_on_hand),3::numeric,'delivery decreases on hand');
select is((select value_satang from public.stock_on_hand),300::bigint,'delivery retains moving average');
select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050');
select is((select count(*)::int from public.stock_moves where kind='delivery'),1,'repeat delivery is idempotent');
select throws_ok($$select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000051')$$,'P0001','Insufficient stock','second invoice cannot spend the same stock');
select is((select quantity from public.stock_on_hand),3::numeric,'refused delivery preserves stock');
select is((select count(*)::int from public.stock_moves where source_id='b8100000-0000-4000-8000-000000000051'),0,'failed delivery has no partial posting');
select ok((select prosrc like '%private.lock_stock_balances%' from pg_proc where oid='public.deliver_invoice(uuid,uuid,uuid,jsonb,date)'::regprocedure),'multi-product deliveries prelock balance rows');
reset role;
select ok((select prosrc like '%private.lock_stock_balances%' and prosrc like '%from public.stock_balances%' from pg_proc where oid='private.value_stock_move()'::regprocedure),'posting locks balance before reading its committed quantity');
set local role authenticated;
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,1,'Physical count','b8100000-0000-4000-8000-000000000070');
select is((select quantity from public.stock_on_hand),1::numeric,'count posts adjustment delta');
select is((select quantity from public.stock_moves where source_id='b8100000-0000-4000-8000-000000000070'),2::numeric,'count stores positive magnitude');
select is((select kind::text from public.stock_moves where source_id='b8100000-0000-4000-8000-000000000070'),'adjustment_out','count derives outgoing kind');
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,1,'Physical count','b8100000-0000-4000-8000-000000000070');
select is((select count(*)::int from public.stock_moves where source_id='b8100000-0000-4000-8000-000000000070'),1,'count retry does not duplicate');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,2,'Physical count','b8100000-0000-4000-8000-000000000070')$$,'P0001','Adjustment key conflict','count retry cannot change its payload');
select throws_ok($$update public.products set is_stockable=false where id='b8100000-0000-4000-8000-000000000030'$$,'P0001','Products with stock history must remain stockable','stock history cannot be hidden by catalog edits');
select set_config('test.replenishment',public.create_replenishment_rfq('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020')::text,true);
select is((select status::text from public.purchase_orders where id=current_setting('test.replenishment')::uuid),'draft','replenishment creates draft RFQ');
select is((select quantity from public.purchase_order_items where purchase_order_id=current_setting('test.replenishment')::uuid),10::numeric,'replenishment uses configured reorder quantity');
select throws_ok($$select public.create_replenishment_rfq('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020')$$,'P0001','No products require replenishment','repeat RFQ does not duplicate buying');
select throws_ok($$select public.delete_warehouse('b8100000-0000-4000-8000-000000000010',current_setting('test.inventory_warehouse')::uuid)$$,'23503',null,'warehouse with evidence retained');
update public.org_settings set allow_negative_stock=true where org_id='b8100000-0000-4000-8000-000000000010';
select lives_ok($$select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000051')$$,'explicit negative-stock policy permits delivery');
select is((select quantity from public.stock_on_hand),(-3)::numeric,'allowed negative balance remains visible');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000002"}',true);
select is((select count(*)::int from public.stock_on_hand),1,'members can view inventory');
select throws_ok($$select public.deliver_invoice('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000050')$$,'P0001','Only owners and admins may manage inventory','members cannot deliver');
select throws_ok($$select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,1,'member count',gen_random_uuid())$$,'P0001','Only owners and admins may manage inventory','members cannot count');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001"}',true);
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,2,'Restore count',gen_random_uuid(),100);
select set_config('test.cost_po',public.create_purchase_order('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000020','2026-10-24')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang)
 values('b8100000-0000-4000-8000-000000000061','b8100000-0000-4000-8000-000000000010',current_setting('test.cost_po')::uuid,'b8100000-0000-4000-8000-000000000030','Higher cost goods',2,300);
select public.transition_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.cost_po')::uuid,'confirmed');
select public.receive_purchase_order('b8100000-0000-4000-8000-000000000010',current_setting('test.cost_po')::uuid,'[{"id":"b8100000-0000-4000-8000-000000000061","previous_received_quantity":0,"received_quantity":2}]');
select is((select average_cost_satang from public.stock_on_hand),200::bigint,'new receipt weights remaining cost');
select is((select value_satang from public.stock_on_hand),800::bigint,'weighted average preserves stock value');
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,4,'No difference','b8100000-0000-4000-8000-000000000071');
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,3,'Later count',gen_random_uuid());
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000030',current_setting('test.inventory_warehouse')::uuid,4,'No difference','b8100000-0000-4000-8000-000000000071');
select is((select quantity from public.stock_on_hand),3::numeric,'a no-op count retry cannot undo a later stock move');
reset role;
insert into public.products(id,org_id,name,is_stockable,cost_satang) values('b8100000-0000-4000-8000-000000000033','b8100000-0000-4000-8000-000000000010','Fractional average',true,100);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000033',current_setting('test.inventory_warehouse')::uuid,'receipt',1,100,'adjustment',gen_random_uuid(),0,0);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000033',current_setting('test.inventory_warehouse')::uuid,'receipt',2,101,'adjustment',gen_random_uuid(),0,0);
set local role authenticated;
select public.adjust_stock('b8100000-0000-4000-8000-000000000010','b8100000-0000-4000-8000-000000000033',current_setting('test.inventory_warehouse')::uuid,100,'Count preserves cost',gen_random_uuid());
select is((select value_satang from public.stock_on_hand where product_id='b8100000-0000-4000-8000-000000000033'),10067::bigint,'count preserves unrounded moving average');
reset role;
set local role anon;
select throws_ok($$select * from public.stock_moves$$,'42501',null,'anonymous ledger denied');
reset role;
select * from finish();
rollback;
