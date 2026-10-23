begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('be510000-0000-4000-8000-000000000001','transfer-owner@example.invalid',now());
insert into public.organizations(id,name,slug) values('be510000-0000-4000-8000-000000000010','Transfer test','w5d-transfer');
insert into public.memberships(org_id,user_id,role) values('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000001','owner');
insert into public.products(id,org_id,name,type,is_stockable) values('be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000010','Transfer goods','goods',true);
insert into public.warehouses(id,org_id,code,name) values('be510000-0000-4000-8000-000000000040','be510000-0000-4000-8000-000000000010','A','A'),('be510000-0000-4000-8000-000000000041','be510000-0000-4000-8000-000000000010','B','B');
insert into public.stock_moves(org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
values('be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','receipt',3,1,'adjustment',gen_random_uuid(),0,0);
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,balance_after,average_cost_after)
values('be510000-0000-4000-8000-000000000070','be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','delivery',0.5,0,'invoice',gen_random_uuid(),0,0);
insert into public.stock_moves(id,org_id,product_id,warehouse_id,kind,quantity,unit_cost_satang,source_type,source_id,return_of_move_id,balance_after,average_cost_after)
values('be510000-0000-4000-8000-000000000071','be510000-0000-4000-8000-000000000010','be510000-0000-4000-8000-000000000030','be510000-0000-4000-8000-000000000040','customer_return',0.5,0,'invoice',gen_random_uuid(),'be510000-0000-4000-8000-000000000070',0,0);
create or replace temporary view customer_return_valuation_preflight as
with amounts as (
 select id,org_id,product_id,warehouse_id,kind::text as kind,quantity,return_of_move_id,sequence,moved_at,
  round(balance_after*average_cost_after) as value_after,
  lag(round(balance_after*average_cost_after),1,0::numeric) over(partition by org_id,product_id,warehouse_id order by sequence) as value_before
 from public.stock_moves
), returns as (
 select r.*,r.value_after-r.value_before as actual_value_satang,
  d.id as delivery_id,d.kind as delivery_kind,d.product_id as delivery_product_id,d.warehouse_id as delivery_warehouse_id,
  d.quantity as delivered_quantity,d.value_before-d.value_after as delivery_value_satang,
  sum(r.quantity) over(partition by r.org_id,r.return_of_move_id order by r.sequence rows unbounded preceding) as cumulative_returned_quantity
 from amounts r left join amounts d on d.org_id=r.org_id and d.id=r.return_of_move_id
 where r.kind='customer_return'
), allocated as (
 select *,case when delivered_quantity>0 then
  round(cumulative_returned_quantity*delivery_value_satang/delivered_quantity)-round((cumulative_returned_quantity-quantity)*delivery_value_satang/delivered_quantity)
 end as expected_value_satang from returns
), findings as (
 select *,case
  when delivery_kind is distinct from 'delivery' then 'original_delivery_missing_or_invalid'
  when product_id<>delivery_product_id or warehouse_id<>delivery_warehouse_id then 'original_delivery_balance_mismatch'
  when cumulative_returned_quantity>delivered_quantity then 'returned_quantity_exceeds_delivery'
  when actual_value_satang<>expected_value_satang then 'historical_return_value_mismatch'
 end as reconciliation_reason from allocated
)
select org_id,id as return_move_id,return_of_move_id as original_delivery_id,product_id,warehouse_id,sequence,moved_at,
 quantity,cumulative_returned_quantity,delivered_quantity,delivery_value_satang,actual_value_satang,expected_value_satang,
 actual_value_satang-expected_value_satang as difference_satang,reconciliation_reason
from findings where reconciliation_reason is not null;

select * from customer_return_valuation_preflight order by org_id,product_id,warehouse_id,sequence;

select is((select count(*)::int from pg_temp.customer_return_valuation_preflight where org_id='be510000-0000-4000-8000-000000000010'),0,'compatible retained snapshots need no reconciliation');
alter table public.stock_moves disable trigger retain_stock_move;
update public.stock_moves set average_cost_after=4::numeric/3 where id='be510000-0000-4000-8000-000000000071';
alter table public.stock_moves enable trigger retain_stock_move;
select is((select count(*)::int from pg_temp.customer_return_valuation_preflight where org_id='be510000-0000-4000-8000-000000000010'),1,'historical mismatch is reported');
select is((select difference_satang from pg_temp.customer_return_valuation_preflight where return_move_id='be510000-0000-4000-8000-000000000071'),1::numeric,'report retains the exact reconciliation difference');
select is((select reconciliation_reason from pg_temp.customer_return_valuation_preflight where return_move_id='be510000-0000-4000-8000-000000000071'),'historical_return_value_mismatch','report identifies the valuation reason');
alter table public.stock_moves drop column stock_value_satang cascade;
select lives_ok($$select * from pg_temp.customer_return_valuation_preflight$$,'report works before stock_value_satang exists');
select is((select count(*)::int from pg_temp.customer_return_valuation_preflight where org_id='be510000-0000-4000-8000-000000000010'),1,'old-schema report retains its finding');
select * from finish();rollback;
