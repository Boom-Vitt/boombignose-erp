begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('be510000-0000-4000-8000-000000000001','transfer-owner@example.invalid',now());
insert into public.organizations(id,name,slug) values('be510000-0000-4000-8000-000000000010','Transfer test','w5d-transfer');
insert into public.memberships(org_id,user_id,role) values('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000001','owner');
insert into public.products(id,org_id,name,type,is_stockable) values('be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000010','Transfer goods','goods',true);
insert into public.warehouses(id,org_id,code,name) values('be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000010','A','A'),('be510000-0000-4000-8000-000000000041','be510000-0000-4000-8000-000000000010','B','B');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after) values
('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','receipt',2,1,'adjustment',gen_random_uuid(),0,0),
('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','receipt',1,3,'adjustment',gen_random_uuid(),0,0);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"be510000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select has_function('public','transfer_stock',array['uuid','uuid','uuid','uuid','numeric','text','uuid'],'atomic transfer command exists');
select lives_ok($$select public.transfer_stock('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000041',1,'Relocate','be510000-0000-4000-8000-000000000060')$$,'transfer posts both legs');
select is((select sum(quantity) from public.stock_on_hand),3::numeric,'transfer conserves total quantity');
select is((select sum(value_satang) from public.stock_on_hand),5::numeric,'transfer conserves weighted source value');
select is((select stock_value_satang from public.stock_moves where kind='transfer_in'),2::bigint,'incoming retains actual outgoing two satang');
select public.transfer_stock('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000041',1,'Relocate','be510000-0000-4000-8000-000000000060');
select is((select count(*)::int from public.stock_moves where source_type='transfer'),2,'matching retry produces one pair');
select throws_ok($$select public.transfer_stock('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000041',2,'Relocate','be510000-0000-4000-8000-000000000060')$$,'P0001','Transfer key conflict','changed retry rejected');
select throws_ok($$select public.transfer_stock('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000041',3,'Too many',gen_random_uuid())$$,'P0001','Insufficient stock for transfer','over-transfer rolls back');
select is((select count(*)::int from public.stock_moves where source_type='transfer'),2,'failed transfer leaves no leg');
select throws_ok($$update public.stock_balances set quantity=100$$,'42501',null,'direct balance edits refused');
reset role;
insert into public.org_settings(org_id,allow_negative_stock) values('be510000-0000-4000-8000-000000000010',true) on conflict(org_id) do update set allow_negative_stock=true;
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
values('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000041','delivery',2,0,'adjustment',gen_random_uuid(),0,0);
set local role authenticated;
select throws_ok($$select public.transfer_stock('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000041',1,'Incompatible target','be510000-0000-4000-8000-000000000061')$$,'P0001','Transfer value incompatible with stock balance','failure in incoming valuation rolls back outgoing transfer');
select is((select quantity from public.stock_on_hand where warehouse_id='be510000-0000-4000-8000-000000000040'),2::numeric,'second-leg failure restores source quantity');
select is((select count(*)::int from public.stock_moves where source_type='transfer'),2,'second-leg failure retains neither new leg');
select is((select count(*)::int from public.stock_transfers),1,'second-leg failure also rolls back its command header');
select * from finish();
rollback;
