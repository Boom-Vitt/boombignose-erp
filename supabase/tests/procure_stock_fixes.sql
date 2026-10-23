begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.bill_purchase_order(p_org_id uuid,p_order_id uuid) returns uuid language sql as $$
select public.bill_purchase_order(p_org_id,p_order_id,jsonb_build_object(
  'vendor_reference',p_order_id::text||'-'||(select count(*)+1 from public.costs where org_id=p_org_id and purchase_order_id=p_order_id),
  'bill_date','2026-10-26','input_vat_rate',0,'input_vat_satang',0,
  'vendor_total_satang',(select coalesce(sum(round((received_quantity-returned_quantity)*unit_cost_satang)-round(billed_quantity*unit_cost_satang)),0) from public.purchase_order_items where org_id=p_org_id and purchase_order_id=p_order_id and received_quantity-returned_quantity>billed_quantity)));
$$;
insert into auth.users(id,email,email_confirmed_at) values
 ('b8450000-0000-4000-8000-000000000001','stock-fix-owner@example.invalid',now()),
 ('b8450000-0000-4000-8000-000000000002','stock-fix-member@example.invalid',now()),
 ('b8450000-0000-4000-8000-000000000003','stock-fix-outsider@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('b8450000-0000-4000-8000-000000000010','Stock fixes','stock-fixes'),
 ('b8450000-0000-4000-8000-000000000011','Foreign stock fixes','foreign-stock-fixes');
insert into public.memberships(org_id,user_id,role) values
 ('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000001','owner'),
 ('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000002','member');
insert into public.org_settings(org_id,legal_name,business_address) values('b8450000-0000-4000-8000-000000000010','Stock fixes seller','Seller address');
insert into public.clients(id,org_id,name) values('b8450000-0000-4000-8000-000000000020','b8450000-0000-4000-8000-000000000010','Stock fixes buyer');
insert into public.vendors(id,org_id,name) values('b8450000-0000-4000-8000-000000000021','b8450000-0000-4000-8000-000000000010','Stock fixes vendor');
insert into public.products(id,org_id,name,unit,is_stockable) values
 ('b8450000-0000-4000-8000-000000000030','b8450000-0000-4000-8000-000000000010','Half-unit goods','piece',true),
 ('b8450000-0000-4000-8000-000000000031','b8450000-0000-4000-8000-000000000010','Weighted goods','piece',true),
 ('b8450000-0000-4000-8000-000000000032','b8450000-0000-4000-8000-000000000010','Vendor half-unit goods','piece',true),
 ('b8450000-0000-4000-8000-000000000033','b8450000-0000-4000-8000-000000000011','Foreign goods','piece',true);
insert into public.quotes(id,org_id,client_id,number) values('b8450000-0000-4000-8000-000000000040','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000020','STOCK-FIX-Q');
insert into public.invoices(id,org_id,client_id,number,issue_date,due_date) values
 ('b8450000-0000-4000-8000-000000000050','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000020','STOCK-FIX-HALF','2026-10-25','2026-11-25'),
 ('b8450000-0000-4000-8000-000000000051','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000020','STOCK-FIX-AVERAGE','2026-10-25','2026-11-25');
insert into public.invoice_items(id,org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values
 ('b8450000-0000-4000-8000-000000000060','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050','b8450000-0000-4000-8000-000000000030','Half-unit goods',1,'piece',100,100),
 ('b8450000-0000-4000-8000-000000000061','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000051','b8450000-0000-4000-8000-000000000031','Weighted goods',3,'piece',100,300);
select set_config('test.fix_warehouse',(select id::text from public.warehouses where org_id='b8450000-0000-4000-8000-000000000010' and is_default),true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8450000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$insert into public.quote_items(id,org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8450000-0000-4000-8000-000000000062','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000040','b8450000-0000-4000-8000-000000000030','Matching unit',1,'piece',100,100)$$,'member can add a product quote line with the catalog unit');
select throws_ok($$insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000040','b8450000-0000-4000-8000-000000000030','Mismatched unit',1,'box',100,100)$$,'P0001','Product line unit must match product unit','member insert cannot bypass product unit validation');
select throws_ok($$update public.quote_items set unit='box' where id='b8450000-0000-4000-8000-000000000062'$$,'P0001','Product line unit must match product unit','member update cannot bypass product unit validation');
select throws_ok($$insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000040','b8450000-0000-4000-8000-000000000099','Missing product',1,'piece',100,100)$$,'P0001','Workspace product unavailable','missing product fails closed before FK validation');
select throws_ok($$insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit,unit_price_satang,amount_satang) values('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000040','b8450000-0000-4000-8000-000000000033','Foreign product',1,'piece',100,100)$$,'P0001','Workspace product unavailable','foreign product fails closed without exposing its unit');
select is(private.lock_product_line_unit('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000030'),'piece','member lookup holds catalog validation independently of update policy');
select throws_ok($$select private.lock_product_line_unit('b8450000-0000-4000-8000-000000000011','b8450000-0000-4000-8000-000000000033')$$,'P0001','Workspace product unavailable','definer lookup explicitly rejects a nonmember organization');
reset role;
select ok(not has_function_privilege('anon','private.lock_product_line_unit(uuid,uuid)','execute'),'anonymous catalog lookup denied');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values
 ('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,'receipt',1,1,'adjustment',gen_random_uuid(),0,0),
 ('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000031',current_setting('test.fix_warehouse')::uuid,'receipt',1,1,'adjustment',gen_random_uuid(),0,0),
 ('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000031',current_setting('test.fix_warehouse')::uuid,'receipt',2,2,'adjustment',gen_random_uuid(),0,0);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8450000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.issue_invoice('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050',(select version from public.invoices where id='b8450000-0000-4000-8000-000000000050'),gen_random_uuid());
select public.issue_invoice('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000051',(select version from public.invoices where id='b8450000-0000-4000-8000-000000000051'),gen_random_uuid());
select public.deliver_invoice('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050',null,'[{"id":"b8450000-0000-4000-8000-000000000060","previous_delivered_quantity":0,"delivered_quantity":0.5}]');
select is((select sum(amount_satang) from public.monthly_inventory_cogs),0::numeric,'first half delivery costs zero when rounded inventory value stays one');
select public.deliver_invoice('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050',null,'[{"id":"b8450000-0000-4000-8000-000000000060","previous_delivered_quantity":0.5,"delivered_quantity":1}]');
select is((select sum(amount_satang) from public.monthly_inventory_cogs),1::numeric,'two half deliveries consume exactly one satang');
select is((select value_satang from public.stock_on_hand where product_id='b8450000-0000-4000-8000-000000000030'),0::bigint,'half deliveries deplete the one-satang stock');
select is((select array_agg(stock_value_satang order by sequence) from public.stock_moves where source_id='b8450000-0000-4000-8000-000000000050' and kind='delivery'),array[0,1]::bigint[],'each half delivery retains its integer stock-value reduction');
select set_config('test.fix_delivery_zero',(select id::text from public.stock_moves where source_id='b8450000-0000-4000-8000-000000000050' and kind='delivery' order by sequence limit 1),true);
select set_config('test.fix_delivery_one',(select id::text from public.stock_moves where source_id='b8450000-0000-4000-8000-000000000050' and kind='delivery' order by sequence desc limit 1),true);
select public.return_invoice_delivery('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050',current_setting('test.fix_delivery_zero')::uuid,0.5);
select is((select sum(amount_satang) from public.monthly_inventory_cogs),1::numeric,'return of zero-value half delivery reverses no COGS');
select is((select value_satang from public.stock_on_hand where product_id='b8450000-0000-4000-8000-000000000030'),0::bigint,'zero-value half delivery returns zero inventory value');
select public.return_invoice_delivery('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000050',current_setting('test.fix_delivery_one')::uuid,0.5);
select is((select sum(amount_satang) from public.monthly_inventory_cogs),0::numeric,'full half-delivery returns reverse exactly original COGS');
select is((select value_satang from public.stock_on_hand where product_id='b8450000-0000-4000-8000-000000000030'),1::bigint,'full half-delivery returns restore exactly original stock value');
select public.deliver_invoice('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000051');
select is((select sum(amount_satang) from public.monthly_inventory_cogs),5::numeric,'weighted average delivery costs actual five satang rather than rounded-unit six');
select set_config('test.fix_weighted_delivery',(select id::text from public.stock_moves where source_id='b8450000-0000-4000-8000-000000000051' and kind='delivery'),true);
select public.return_invoice_delivery('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000051',current_setting('test.fix_weighted_delivery')::uuid,1.5);
select is((select sum(amount_satang) from public.monthly_inventory_cogs),2::numeric,'partial weighted return allocates three of five source satang');
select is((select value_satang from public.stock_on_hand where product_id='b8450000-0000-4000-8000-000000000031'),3::bigint,'partial weighted return restores allocated source value');
select public.return_invoice_delivery('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000051',current_setting('test.fix_weighted_delivery')::uuid,3);
select is((select sum(amount_satang) from public.monthly_inventory_cogs),0::numeric,'full weighted return reverses five source satang without unit-rounding drift');
select is((select value_satang from public.stock_on_hand where product_id='b8450000-0000-4000-8000-000000000031'),5::bigint,'full weighted return restores five source satang');
select set_config('test.fix_po',public.create_purchase_order('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000021','2026-10-25')::text,true);
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang) values('b8450000-0000-4000-8000-000000000070','b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid,'b8450000-0000-4000-8000-000000000032','Vendor fractional goods',1,'piece',1);
select public.transition_purchase_order('b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid,'confirmed');
select public.receive_purchase_order('b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid,'[{"id":"b8450000-0000-4000-8000-000000000070","previous_received_quantity":0,"received_quantity":1}]');
select pg_temp.bill_purchase_order('b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid);
select public.return_purchase_order('b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid,'[{"id":"b8450000-0000-4000-8000-000000000070","returned_quantity":0.5}]');
select is((select sum(amount_satang) from public.costs where purchase_order_id=current_setting('test.fix_po')::uuid and purchase_cost_kind='credit'),0::numeric,'first half vendor return creates zero rounded credit');
select is((select coalesce(sum(amount_satang),0) from public.costs where purchase_order_id=current_setting('test.fix_po')::uuid and purchase_cost_kind='return_adjustment'),0::numeric,'zero-credit zero-stock-value half return creates no phantom adjustment');
select public.return_purchase_order('b8450000-0000-4000-8000-000000000010',current_setting('test.fix_po')::uuid,'[{"id":"b8450000-0000-4000-8000-000000000070","returned_quantity":1}]');
select is((select sum(amount_satang) from public.costs where purchase_order_id=current_setting('test.fix_po')::uuid and purchase_cost_kind='credit'),(-1)::numeric,'second half vendor return credits the one remaining satang');
select is((select count(*)::int from public.costs where purchase_order_id=current_setting('test.fix_po')::uuid and purchase_cost_kind='return_adjustment'),0,'neither half vendor return posts a rounding-only adjustment');
select is((select sum(amount_satang) from public.costs where purchase_order_id=current_setting('test.fix_po')::uuid),0::numeric,'vendor full return reconciles all bill credit and adjustment amounts');
reset role;
insert into public.products(id,org_id,name,unit,is_stockable) values('b8450000-0000-4000-8000-000000000034','b8450000-0000-4000-8000-000000000010','Large zero-cost balance','piece',true);
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values
 ('b8450000-0000-4000-8000-000000000080','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000034',current_setting('test.fix_warehouse')::uuid,'receipt',1,1,'adjustment',gen_random_uuid(),0,0),
 ('b8450000-0000-4000-8000-000000000081','b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000034',current_setting('test.fix_warehouse')::uuid,'delivery',1,0,'adjustment',gen_random_uuid(),0,0);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
select 'b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000034',current_setting('test.fix_warehouse')::uuid,'receipt',999999999,0,'adjustment',gen_random_uuid(),0,0 from generate_series(1,20);
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8450000-0000-4000-8000-000000000010','b8450000-0000-4000-8000-000000000034',current_setting('test.fix_warehouse')::uuid,'customer_return',1,1,'adjustment',gen_random_uuid(),'b8450000-0000-4000-8000-000000000081',0,0)$$,'P0001','Return value exceeds stock precision','unrepresentable average fails atomically instead of silently adding a satang');
select is((select count(*)::int from public.stock_moves where return_of_move_id='b8450000-0000-4000-8000-000000000081'),0,'failed precision validation retains no return evidence');
insert into public.organizations(id,name,slug) values('b8470000-0000-4000-8000-000000000010','Negative returns','negative-returns');
insert into public.org_settings(org_id,allow_negative_stock) values('b8470000-0000-4000-8000-000000000010',true);
insert into public.products(id,org_id,name,is_stockable) values('b8470000-0000-4000-8000-000000000030','b8470000-0000-4000-8000-000000000010','Negative return goods',true);
select set_config('test.negative_warehouse',(select id::text from public.warehouses where org_id='b8470000-0000-4000-8000-000000000010' and is_default),true);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'receipt',1,1,'adjustment',gen_random_uuid(),0,0);
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000081','b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'delivery',2,0,'invoice',gen_random_uuid(),0,0);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',0.5,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000081',0,0);
select is((select value_satang from public.stock_on_hand where product_id='b8470000-0000-4000-8000-000000000030'),0::bigint,'negative partial return restores exactly its one-satang COGS reversal');
select is((select sum(amount_satang) from public.monthly_inventory_cogs where org_id='b8470000-0000-4000-8000-000000000010'),1::numeric,'negative partial return reverses one source satang');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',0.5,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000081',0,0);
select is((select value_satang from public.stock_on_hand where product_id='b8470000-0000-4000-8000-000000000030'),0::bigint,'return reaching zero quantity also reaches zero value');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',1,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000081',0,0);
select is((select value_satang from public.stock_on_hand where product_id='b8470000-0000-4000-8000-000000000030'),1::bigint,'full deficit recovery restores original receipt value');
select is((select sum(amount_satang) from public.monthly_inventory_cogs where org_id='b8470000-0000-4000-8000-000000000010'),0::numeric,'full deficit recovery reverses exactly delivery cost');
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000082','b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'delivery',2,0,'adjustment',gen_random_uuid(),0,0);
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',1,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000081',0,0)$$,'P0001','Invalid cumulative customer return quantity','full delivery cannot be returned twice even from a stock deficit');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'receipt',0.5,4,'adjustment',gen_random_uuid(),0,0);
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',0.5,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000082',0,0)$$,'P0001','Return value incompatible with stock balance','return cannot erase nonzero target value at zero quantity');
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after) values('b8470000-0000-4000-8000-000000000010','b8470000-0000-4000-8000-000000000030',current_setting('test.negative_warehouse')::uuid,'customer_return',1,1,'invoice',gen_random_uuid(),'b8470000-0000-4000-8000-000000000082',0,0)$$,'P0001','Return value incompatible with stock balance','return cannot create a negative average cost across a deficit');
select is((select count(*)::int from public.stock_moves where return_of_move_id='b8470000-0000-4000-8000-000000000082'),0,'incompatible returns retain no ledger evidence');
select * from finish();
rollback;
