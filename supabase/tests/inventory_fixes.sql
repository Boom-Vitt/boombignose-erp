begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('b8300000-0000-4000-8000-000000000001','inventory-fixes@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('b8300000-0000-4000-8000-000000000010','Inventory fix test','inventory-fix-test'),
 ('b8300000-0000-4000-8000-000000000011','Other inventory fix test','inventory-fix-other');
insert into public.memberships(org_id,user_id,role) values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000001','owner');
insert into public.org_settings(org_id) values('b8300000-0000-4000-8000-000000000010');
insert into public.products(id,org_id,name,unit,is_stockable,cost_satang) values
 ('b8300000-0000-4000-8000-000000000030','b8300000-0000-4000-8000-000000000010','Locked unit','piece',true,100),
 ('b8300000-0000-4000-8000-000000000031','b8300000-0000-4000-8000-000000000010','Snapshot goods','piece',true,100),
 ('b8300000-0000-4000-8000-000000000032','b8300000-0000-4000-8000-000000000010','Deficit goods','piece',true,100),
 ('b8300000-0000-4000-8000-000000000034','b8300000-0000-4000-8000-000000000010','Unused goods','piece',true,100);
select set_config('test.fix_warehouse',(select id::text from public.warehouses where org_id='b8300000-0000-4000-8000-000000000010' and is_default),true);
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,'receipt',10,100,'adjustment',gen_random_uuid(),0,0);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8300000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$update public.products set unit='box' where id='b8300000-0000-4000-8000-000000000030'$$,'P0001','Stock unit is locked by stock history','stock history locks the unit');
select is((select unit from public.products where id='b8300000-0000-4000-8000-000000000030'),'piece','failed unit change preserves stock meaning');
select lives_ok($$update public.products set unit='piece',name='Renamed goods' where id='b8300000-0000-4000-8000-000000000030'$$,'unchanged stock unit and ordinary edits remain allowed');
select lives_ok($$update public.products set unit='box' where id='b8300000-0000-4000-8000-000000000034'$$,'a unit can change before stock history exists');
select public.adjust_stock('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,8,'Unconfirmed count','b8300000-0000-4000-8000-000000000070');
reset role;
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,'receipt',2,100,'adjustment',gen_random_uuid(),0,0);
set local role authenticated;
select lives_ok($$select public.adjust_stock('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,8,'Unconfirmed count','b8300000-0000-4000-8000-000000000070')$$,'same pending key recovers an already committed count');
select is((select quantity from public.stock_on_hand where product_id='b8300000-0000-4000-8000-000000000030'),10::numeric,'count retry preserves the intervening receipt');
select is((select count(*)::int from public.stock_moves where source_id='b8300000-0000-4000-8000-000000000070'),1,'one move per count command key');
select throws_ok($$select public.adjust_stock('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000030',current_setting('test.fix_warehouse')::uuid,7,'Unconfirmed count','b8300000-0000-4000-8000-000000000070')$$,'P0001','Adjustment key conflict','same key cannot change the count payload');
reset role;
update public.org_settings set allow_negative_stock=true where org_id='b8300000-0000-4000-8000-000000000010';
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000032',current_setting('test.fix_warehouse')::uuid,'delivery',10,0,'adjustment',gen_random_uuid(),0,0);
update public.org_settings set allow_negative_stock=false where org_id='b8300000-0000-4000-8000-000000000010';
select lives_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000032',current_setting('test.fix_warehouse')::uuid,'receipt',3,100,'adjustment',gen_random_uuid(),0,0)$$,'an incoming receipt can reduce an existing negative balance');
select is((select quantity from public.stock_on_hand where product_id='b8300000-0000-4000-8000-000000000032'),(-7)::numeric,'partial deficit recovery persists');
select throws_ok($$insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values('b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000032',current_setting('test.fix_warehouse')::uuid,'delivery',1,0,'adjustment',gen_random_uuid(),0,0)$$,'P0001','Insufficient stock','outgoing moves cannot deepen a forbidden deficit');
select is((select quantity from public.stock_on_hand where product_id='b8300000-0000-4000-8000-000000000032'),(-7)::numeric,'refused outgoing move preserves the balance');
insert into public.warehouses(org_id,code,name) select 'b8300000-0000-4000-8000-000000000010','W'||i,'Snapshot warehouse '||i from generate_series(1,1000) i;
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
 select 'b8300000-0000-4000-8000-000000000010','b8300000-0000-4000-8000-000000000031',id,'receipt',1,100,'adjustment',gen_random_uuid(),0,0
 from public.warehouses where org_id='b8300000-0000-4000-8000-000000000010' order by id;
set local role authenticated;
select set_config('test.fix_snapshot',public.inventory_snapshot('b8300000-0000-4000-8000-000000000010',null,'b8300000-0000-4000-8000-000000000031')::text,true);
select is((current_setting('test.fix_snapshot')::jsonb->'products'->0->>'quantity')::numeric,1001::numeric,'snapshot totals include every warehouse past the API row cap');
select is((current_setting('test.fix_snapshot')::jsonb->'products'->0->>'value_satang')::bigint,100100::bigint,'snapshot value is aggregated by the database');
select is(jsonb_array_length(current_setting('test.fix_snapshot')::jsonb->'balances'),1001,'one snapshot includes all balance rows');
select is((public.inventory_snapshot('b8300000-0000-4000-8000-000000000010',current_setting('test.fix_warehouse')::uuid,'b8300000-0000-4000-8000-000000000031')->'products'->0->>'quantity')::numeric,1::numeric,'warehouse filter is applied inside the same snapshot');
select throws_ok($$select public.inventory_snapshot('b8300000-0000-4000-8000-000000000011')$$,'P0001','Workspace membership required','snapshot refuses another workspace');
reset role;
select ok((select not prosecdef and provolatile='s' from pg_proc where oid='public.inventory_snapshot(uuid,uuid,uuid)'::regprocedure),'snapshot is stable and invokes caller RLS');
set local role anon;
select throws_ok($$select public.inventory_snapshot('b8300000-0000-4000-8000-000000000010')$$,'42501',null,'anonymous snapshot access denied');
reset role;
select * from finish();
rollback;
