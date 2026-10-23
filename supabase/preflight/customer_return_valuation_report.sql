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
