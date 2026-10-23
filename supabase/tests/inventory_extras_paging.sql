begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('be510000-0000-4000-8000-000000000001','transfer-owner@example.invalid',now());
insert into public.organizations(id,name,slug) values('be510000-0000-4000-8000-000000000010','Transfer test','w5d-transfer');
insert into public.memberships(org_id,user_id,role) values('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000001','owner');
insert into public.products(id,org_id,name,type,is_stockable) values('be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000010','Transfer goods','goods',true);
insert into public.warehouses(id,org_id,code,name) values('be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000010','A','A'),('be510000-0000-4000-8000-000000000041','be510000-0000-4000-8000-000000000010','B','B');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,note,balance_after,average_cost_after)
select 'be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','receipt',0.001,100,'adjustment',gen_random_uuid(),case when n=1 then 'Only matching needle' else 'Unrelated row' end,0,0 from generate_series(1,1005) n;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"be510000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from public.stock_moves_page('be510000-0000-4000-8000-000000000010')),101,'SQL limits the ledger to one page plus lookahead beyond 1,000 moves');
select is((select count(*)::int from public.stock_moves_page('be510000-0000-4000-8000-000000000010',p_query=>'needle')),1,'text search filters before limiting');
select is((select count(*)::int from public.stock_moves_page('be510000-0000-4000-8000-000000000010',p_kinds=>array['delivery'])),0,'kind filter runs in SQL');
select is((select count(*)::int from public.stock_moves_page('be510000-0000-4000-8000-000000000010',p_before=>(select min(sequence) from public.stock_moves_page('be510000-0000-4000-8000-000000000010')))),101,'older keyset pages are SQL-limited');
select is((select quantity from public.stock_on_hand),1.005::numeric,'all postings update one balance past API row caps');
select is((select count(*)::int from public.stock_moves_page('a0000000-0000-0000-0000-000000000001')),0,'ledger RPC respects tenant RLS');
select * from finish();rollback;
