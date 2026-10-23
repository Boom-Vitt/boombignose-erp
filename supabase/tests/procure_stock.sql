begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.bill_purchase_order(p_org_id uuid,p_order_id uuid) returns uuid language sql as $$
select public.bill_purchase_order(p_org_id,p_order_id,jsonb_build_object(
  'vendor_reference',p_order_id::text||'-'||(select count(*)+1 from public.costs where org_id=p_org_id and purchase_order_id=p_order_id),
  'bill_date','2026-10-26','input_vat_rate',0,'input_vat_satang',0,
  'vendor_total_satang',(select coalesce(sum(round((received_quantity-returned_quantity)*unit_cost_satang)-round(billed_quantity*unit_cost_satang)),0) from public.purchase_order_items where org_id=p_org_id and purchase_order_id=p_order_id and received_quantity-returned_quantity>billed_quantity)));
$$;
insert into auth.users(id,email,email_confirmed_at) values('b8400000-0000-4000-8000-000000000001','procure-stock@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('b8400000-0000-4000-8000-000000000010','Procure stock test','procure-stock-test'),
 ('b8400000-0000-4000-8000-000000000011','Other procure stock','procure-stock-other');
insert into public.memberships(org_id,user_id,role) values('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000001','owner');
insert into public.org_settings(org_id,legal_name,business_address) values('b8400000-0000-4000-8000-000000000010','Stock seller','Seller address');
insert into public.vendors(id,org_id,name) values('b8400000-0000-4000-8000-000000000020','b8400000-0000-4000-8000-000000000010','Stock vendor');
insert into public.products(id,org_id,name,unit,is_stockable,cost_satang,reorder_min,reorder_qty,default_vendor_id) values
 ('b8400000-0000-4000-8000-000000000030','b8400000-0000-4000-8000-000000000010','Goods','piece',true,100,10,2,'b8400000-0000-4000-8000-000000000020'),
 ('b8400000-0000-4000-8000-000000000031','b8400000-0000-4000-8000-000000000010','Unconfigured','piece',true,999,10,0,'b8400000-0000-4000-8000-000000000020'),
 ('b8400000-0000-4000-8000-000000000032','b8400000-0000-4000-8000-000000000010','Service','hour',false,0,0,0,null);
insert into public.clients(id,org_id,name) values('b8400000-0000-4000-8000-000000000040','b8400000-0000-4000-8000-000000000010','Stock buyer');
insert into public.invoices(id,org_id,client_id,number,issue_date,due_date) values('b8400000-0000-4000-8000-000000000050','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000040','PROCURE-DRAFT','2026-10-25','2026-11-25');
insert into public.invoice_items(id,org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8400000-0000-4000-8000-000000000060','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050','b8400000-0000-4000-8000-000000000030','Goods',4,'piece',200,800);
insert into public.quotes(id,org_id,client_id,number,issue_date) values('b8400000-0000-4000-8000-000000000051','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000040','PROCURE-Q','2026-10-25');
select set_config('test.ps_warehouse',(select id::text from public.warehouses where org_id='b8400000-0000-4000-8000-000000000010' and is_default),true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select set_config('test.ps_po',public.create_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000020','2026-10-25')::text,true);
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang) values('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'b8400000-0000-4000-8000-000000000030','Bad unit',1,'box',100)$$,'P0001','Product line unit must match product unit','B1 purchase unit mismatch refused');
select throws_ok($$insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050','b8400000-0000-4000-8000-000000000030','Bad unit',1,'box',100,100)$$,'P0001','Product line unit must match product unit','B1 invoice unit mismatch refused');
select throws_ok($$insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000051','b8400000-0000-4000-8000-000000000030','Bad unit',1,'box',100,100)$$,'P0001','Product line unit must match product unit','B1 quote unit mismatch refused');
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang) values('b8400000-0000-4000-8000-000000000070','b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'b8400000-0000-4000-8000-000000000030','Goods',6,'piece',100);
select public.transition_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'confirmed');
select throws_ok($$select public.transition_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'closed')$$,'P0001','Invalid purchase transition','B2 cannot close before receiving');
select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","previous_received_quantity":0,"received_quantity":4}]');
select throws_ok($$select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","previous_received_quantity":0,"received_quantity":4}]')$$,'P0001','Receipt changed, reload','S10 stale equal-total receipt refused');
select throws_ok($$select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","received_quantity":5}]')$$,'P0001','Receipt changed, reload','S10 missing displayed previous total refused');
select public.issue_invoice('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',(select version from public.invoices where id='b8400000-0000-4000-8000-000000000050'),gen_random_uuid());
select is((public.inventory_snapshot('b8400000-0000-4000-8000-000000000010')->'products'->0->>'reserved_quantity')::numeric,4::numeric,'S7 issued demand shown before delivery');
select public.deliver_invoice('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',null,'[{"id":"b8400000-0000-4000-8000-000000000060","previous_delivered_quantity":0,"delivered_quantity":1}]');
select is((select delivered_quantity from public.invoice_line_stock where line_id='b8400000-0000-4000-8000-000000000060'),1::numeric,'S7 partial delivery records chosen line quantity');
select is((select quantity from public.stock_on_hand where product_id='b8400000-0000-4000-8000-000000000030'),3::numeric,'S7 partial delivery leaves stock');
select throws_ok($$select public.deliver_invoice('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',null,'[{"id":"b8400000-0000-4000-8000-000000000060","previous_delivered_quantity":0,"delivered_quantity":2}]')$$,'P0001','Delivery changed, reload','S7 stale delivery refused');
select throws_ok($$update public.invoice_items set quantity=5 where id='b8400000-0000-4000-8000-000000000060'$$,'P0001','Issued or payment evidence locks invoice lines','S7 fulfillment preserves immutable invoice lines');
select set_config('test.ps_delivery',(select id::text from public.stock_moves where source_id='b8400000-0000-4000-8000-000000000050' and kind='delivery'),true);
select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000030',current_setting('test.ps_warehouse')::uuid,0,'Empty stock',gen_random_uuid());
select throws_ok($$select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000030',current_setting('test.ps_warehouse')::uuid,2,'Opening count',gen_random_uuid())$$,'P0001','Unit cost required when raising stock from zero or below','S9 cannot raise zero stock at silent default cost');
select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000030',current_setting('test.ps_warehouse')::uuid,2,'Opening count','b8400000-0000-4000-8000-000000000090',300);
select is((select cost_satang from public.products where id='b8400000-0000-4000-8000-000000000030'),300::bigint,'S9 counted opening average updates product cost');
select throws_ok($$select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000030',current_setting('test.ps_warehouse')::uuid,2,'Opening count','b8400000-0000-4000-8000-000000000090',301)$$,'P0001','Adjustment key conflict','S9 count retry freezes explicit cost');
select public.return_invoice_delivery('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',current_setting('test.ps_delivery')::uuid,1);
select is((select unit_cost_satang from public.stock_moves where kind='customer_return'),100::bigint,'S7 return uses original delivery cost after average changes');
select is((select value_satang from public.stock_on_hand where product_id='b8400000-0000-4000-8000-000000000030'),700::bigint,'S7 return blends original delivery cost with current stock');
select public.return_invoice_delivery('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',current_setting('test.ps_delivery')::uuid,1);
select is((select count(*)::int from public.stock_moves where kind='customer_return'),1,'S7 return retry idempotent');
select throws_ok($$select public.return_invoice_delivery('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000050',current_setting('test.ps_delivery')::uuid,2)$$,'P0001','Invalid cumulative customer return quantity','S7 cannot return more than original delivery');
select throws_ok($$select public.save_warehouse('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_warehouse')::uuid,'MAIN','Main',null,false,false)$$,'P0001','Warehouse has a non-zero stock balance','S8 warehouse with stock cannot deactivate');
select public.transition_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'closed');
select is((select status::text from public.purchase_orders where id=current_setting('test.ps_po')::uuid),'closed','B2 short receipt closes');
select throws_ok($$select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","previous_received_quantity":4,"received_quantity":6}]')$$,'P0001','Confirmed purchase order required','B2 closure freezes remainder');
select pg_temp.bill_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid);
select is((select category::text from public.costs where purchase_order_id=current_setting('test.ps_po')::uuid),'inventory','S11 stock bills classified as inventory');
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","returned_quantity":1}]');
select is((select unit_cost_satang from public.stock_moves where kind='vendor_return'),233::bigint,'S5 vendor return uses current average per coordinator policy');
select is((select amount_satang from public.costs where purchase_order_id=current_setting('test.ps_po')::uuid and purchase_cost_kind='credit'),(-100)::bigint,'S5 vendor credit retains original PO cost');
select is((select amount_satang from public.costs where purchase_order_id=current_setting('test.ps_po')::uuid and purchase_cost_kind='return_adjustment'),(-133)::bigint,'S5 inventory adjustment reconciles original credit to removed current stock value');
select is((select returned_quantity from public.purchase_order_items where id='b8400000-0000-4000-8000-000000000070'),1::numeric,'S5 returned quantity retained per line');
select is((select sum(amount_satang) from public.costs where purchase_order_id=current_setting('test.ps_po')::uuid and purchase_cost_kind in ('bill','credit')),300::numeric,'S5 billed return creates negative cost credit');
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_po')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000070","returned_quantity":1}]');
select is((select count(*)::int from public.costs where purchase_order_id=current_setting('test.ps_po')::uuid),3,'S5 repeated return cannot duplicate credit');
select set_config('test.ps_rfq',public.create_replenishment_rfq('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000020')::text,true);
select is((select quantity from public.purchase_order_items where purchase_order_id=current_setting('test.ps_rfq')::uuid),8::numeric,'S3 replenish covers forecast shortfall above configured reorder quantity');
select throws_ok($$select public.create_replenishment_rfq('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000020')$$,'P0001','No products require replenishment','S3 existing open remainder prevents duplicate RFQ without notes matching');
select is((select count(*)::int from public.purchase_order_items where product_id='b8400000-0000-4000-8000-000000000031'),0,'S3 zero reorder rule never creates a line');
select is((select sum(amount_satang) from public.monthly_inventory_cogs where org_id='b8400000-0000-4000-8000-000000000010'),0::numeric,'S11 COGS nets original delivery and customer return');
reset role;
update public.purchase_orders set notes='Changed replenishment notes' where id=current_setting('test.ps_rfq')::uuid;
set local role authenticated;
select throws_ok($$select public.create_replenishment_rfq('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000020')$$,'P0001','No products require replenishment','S3 forecast does not depend on notes text');
select set_config('test.ps_unbilled',public.create_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000020','2026-10-25')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang) values('b8400000-0000-4000-8000-000000000071','b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'b8400000-0000-4000-8000-000000000031','Unbilled goods',2,'piece',1);
select public.transition_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'confirmed');
select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000071","previous_received_quantity":0,"received_quantity":1}]');
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000071","returned_quantity":1}]');
select is((select count(*)::int from public.costs where purchase_order_id=current_setting('test.ps_unbilled')::uuid),0,'S5 unbilled returns create no credit');
select public.receive_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000071","previous_received_quantity":1,"received_quantity":2}]');
select pg_temp.bill_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid);
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000071","returned_quantity":1.5}]');
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010',current_setting('test.ps_unbilled')::uuid,'[{"id":"b8400000-0000-4000-8000-000000000071","returned_quantity":2}]');
select is((select sum(amount_satang) from public.costs where purchase_order_id=current_setting('test.ps_unbilled')::uuid),0::numeric,'S5 fractional cumulative credits exactly reverse billed value');
reset role;
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,moved_at,balance_after,average_cost_after) values
 ('b8400000-0000-4000-8000-000000000080','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000031',current_setting('test.ps_warehouse')::uuid,'receipt',1,1,'adjustment',gen_random_uuid(),'2026-01-30T00:00:00Z',0,0),
 ('b8400000-0000-4000-8000-000000000081','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000031',current_setting('test.ps_warehouse')::uuid,'delivery',1,0,'invoice','b8400000-0000-4000-8000-000000000050','2026-01-31T00:00:00Z',0,0);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,moved_at,balance_after,average_cost_after) values
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000031',current_setting('test.ps_warehouse')::uuid,'customer_return',0.5,1,'invoice','b8400000-0000-4000-8000-000000000050','b8400000-0000-4000-8000-000000000081','2026-02-01T00:00:00Z',0,0),
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000031',current_setting('test.ps_warehouse')::uuid,'customer_return',0.5,1,'invoice','b8400000-0000-4000-8000-000000000050','b8400000-0000-4000-8000-000000000081','2026-03-01T00:00:00Z',0,0);
set local role authenticated;
select is((select amount_satang from public.monthly_inventory_cogs where month='2026-01-01'),1::numeric,'S11 original fractional cost enters delivery month');
select is((select amount_satang from public.monthly_inventory_cogs where month='2026-02-01'),(-1)::numeric,'S11 first partial return posts rounded cumulative credit');
select is((select amount_satang from public.monthly_inventory_cogs where month='2026-03-01'),0::numeric,'S11 later partial return does not duplicate rounded satang');
select is((select sum(amount_satang) from public.monthly_inventory_cogs),0::numeric,'S11 full return reverses original COGS across months');
reset role;
insert into public.products(id,org_id,name,is_stockable,cost_satang) values('b8400000-0000-4000-8000-000000000033','b8400000-0000-4000-8000-000000000010','Legacy shared receipt',true,100);
insert into public.warehouses(id,org_id,code,name) values('b8400000-0000-4000-8000-000000000100','b8400000-0000-4000-8000-000000000010','OTHER','Other warehouse');
insert into public.purchase_orders(id,org_id,number,vendor_id,status) values('b8400000-0000-4000-8000-000000000090','b8400000-0000-4000-8000-000000000010','LEGACY-RETURN','b8400000-0000-4000-8000-000000000020','confirmed');
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,received_quantity) values
 ('b8400000-0000-4000-8000-000000000091','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000090','b8400000-0000-4000-8000-000000000033','Legacy line A',2,'piece',100,2),
 ('b8400000-0000-4000-8000-000000000092','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000090','b8400000-0000-4000-8000-000000000033','Legacy line B',2,'piece',100,2);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033',current_setting('test.ps_warehouse')::uuid,'receipt',2,100,'purchase_order','b8400000-0000-4000-8000-000000000090',0,0),
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033','b8400000-0000-4000-8000-000000000100','receipt',2,100,'purchase_order','b8400000-0000-4000-8000-000000000090',0,0),
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033',current_setting('test.ps_warehouse')::uuid,'receipt',10,100,'adjustment',gen_random_uuid(),0,0);
set local role authenticated;
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000090','[{"id":"b8400000-0000-4000-8000-000000000091","returned_quantity":2}]');
select throws_ok($$select public.return_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000090','[{"id":"b8400000-0000-4000-8000-000000000092","returned_quantity":2}]')$$,'P0001','Return exceeds receipts in this warehouse','S5 legacy duplicate-product lines cannot share warehouse return allowance twice');
reset role;
update public.org_settings set allow_negative_stock=true where org_id='b8400000-0000-4000-8000-000000000010';
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033','b8400000-0000-4000-8000-000000000100','delivery',3,0,'adjustment',gen_random_uuid(),0,0);
update public.org_settings set allow_negative_stock=false where org_id='b8400000-0000-4000-8000-000000000010';
set local role authenticated;
select throws_ok($$select public.save_warehouse('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000100','OTHER','Other',null,false,false)$$,'P0001','Warehouse has a non-zero stock balance','S8 negative balance also prevents deactivation');
select throws_ok($$select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033','b8400000-0000-4000-8000-000000000100',2,'Deficit count',gen_random_uuid())$$,'P0001','Unit cost required when raising stock from zero or below','S9 deficit recovery count requires explicit cost');
select public.adjust_stock('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000033','b8400000-0000-4000-8000-000000000100',2,'Deficit count',gen_random_uuid(),200);
select is((select cost_satang from public.products where id='b8400000-0000-4000-8000-000000000033'),200::bigint,'S9 deficit count writes supplied opening average');
reset role;
insert into public.products(id,org_id,name,is_stockable,cost_satang) values('b8400000-0000-4000-8000-000000000034','b8400000-0000-4000-8000-000000000010','Consumed expensive receipt',true,1000);
insert into public.purchase_orders(id,org_id,number,vendor_id,status) values('b8400000-0000-4000-8000-000000000093','b8400000-0000-4000-8000-000000000010','VALUE-RETURN','b8400000-0000-4000-8000-000000000020','billed');
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,received_quantity,billed_quantity) values('b8400000-0000-4000-8000-000000000094','b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000093','b8400000-0000-4000-8000-000000000034','Expensive goods',10,'piece',1000,10,10);
insert into public.costs(org_id,purchase_order_id,vendor_id,category,amount_satang,bill_number,purchase_cost_kind) values('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000093','b8400000-0000-4000-8000-000000000020','inventory',10000,'VALUE-RETURN-B1','bill');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,source_line_id,balance_after,average_cost_after) values
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000034',current_setting('test.ps_warehouse')::uuid,'receipt',10,1000,'purchase_order','b8400000-0000-4000-8000-000000000093','b8400000-0000-4000-8000-000000000094',0,0),
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000034',current_setting('test.ps_warehouse')::uuid,'delivery',10,0,'adjustment',gen_random_uuid(),null,0,0),
 ('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000034',current_setting('test.ps_warehouse')::uuid,'receipt',10,50,'adjustment',gen_random_uuid(),null,0,0);
set local role authenticated;
select lives_ok($$select public.return_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000093','[{"id":"b8400000-0000-4000-8000-000000000094","returned_quantity":1}]')$$,'S5 legitimate expensive return does not underflow current inventory value');
select is((select value_satang from public.stock_on_hand where product_id='b8400000-0000-4000-8000-000000000034'),450::bigint,'S5 current average removes 50 from value500');
select is((select unit_cost_satang from public.stock_moves where product_id='b8400000-0000-4000-8000-000000000034' and kind='vendor_return'),50::bigint,'S5 outgoing return stock uses current average');
select is((select amount_satang from public.costs where purchase_order_id='b8400000-0000-4000-8000-000000000093' and purchase_cost_kind='credit'),(-1000)::bigint,'S5 original PO price determines vendor credit');
select is((select amount_satang from public.costs where purchase_order_id='b8400000-0000-4000-8000-000000000093' and purchase_cost_kind='return_adjustment'),950::bigint,'S5 inventory adjustment reconciles expensive PO credit with current average');
select ok((select vendor_id is null and due_date is null and category='inventory' from public.costs where purchase_order_id='b8400000-0000-4000-8000-000000000093' and purchase_cost_kind='return_adjustment'),'S5 valuation adjustment is not a vendor payable');
select public.return_purchase_order('b8400000-0000-4000-8000-000000000010','b8400000-0000-4000-8000-000000000093','[{"id":"b8400000-0000-4000-8000-000000000094","returned_quantity":10}]');
select is((select value_satang from public.stock_on_hand where product_id='b8400000-0000-4000-8000-000000000034'),0::bigint,'S5 full depletion removes exactly all remaining stock value');
select is((select sum(amount_satang) from public.costs where purchase_order_id='b8400000-0000-4000-8000-000000000093' and purchase_cost_kind='credit'),(-10000)::numeric,'S5 full return credits original PO total');
select is((select sum(amount_satang) from public.costs where purchase_order_id='b8400000-0000-4000-8000-000000000093' and purchase_cost_kind='return_adjustment'),9500::numeric,'S5 full depletion records all original/current valuation difference');
reset role;
insert into public.clients(id,org_id,name) values('b8400000-0000-4000-8000-000000000041','b8400000-0000-4000-8000-000000000011','Other buyer');
insert into public.invoices(id,org_id,client_id,number) values('b8400000-0000-4000-8000-000000000052','b8400000-0000-4000-8000-000000000011','b8400000-0000-4000-8000-000000000041','OTHER-STOCK');
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang) values('b8400000-0000-4000-8000-000000000062','b8400000-0000-4000-8000-000000000011','b8400000-0000-4000-8000-000000000052','Other stock line',1,100);
insert into public.invoice_line_stock(org_id,line_id,invoice_id,delivered_quantity) values('b8400000-0000-4000-8000-000000000011','b8400000-0000-4000-8000-000000000062','b8400000-0000-4000-8000-000000000052',1);
set local role authenticated;
select is((select count(*)::int from public.invoice_line_stock where org_id='b8400000-0000-4000-8000-000000000011'),0,'fulfillment rows tenant scoped');
select throws_ok($$update public.invoice_line_stock set delivered_quantity=0$$,'42501',null,'direct fulfillment edits denied');
reset role;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.invoice_line_stock'::regclass),'fulfillment RLS enabled and forced');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.invoice_stock_lines'::regclass),'fulfillment view invokes caller RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.monthly_inventory_cogs'::regclass),'COGS view invokes caller RLS');
set local role anon;
select throws_ok($$select * from public.invoice_line_stock$$,'42501',null,'anonymous fulfillment denied');
reset role;
select * from finish();
rollback;
