begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values('b9510000-0000-4000-8000-000000000001','bill-review@example.invalid');
insert into public.organizations(id,name,slug) values('b9510000-0000-4000-8000-000000000010','Bill review','bill-review');
insert into public.memberships(org_id,user_id,role) values('b9510000-0000-4000-8000-000000000010','b9510000-0000-4000-8000-000000000001','owner');
insert into public.vendors(id,org_id,name) values('b9510000-0000-4000-8000-000000000020','b9510000-0000-4000-8000-000000000010','Review supplier');
insert into public.products(id,org_id,name,is_stockable) values('b9510000-0000-4000-8000-000000000040','b9510000-0000-4000-8000-000000000010','Review stock',true);
insert into public.purchase_orders(id,org_id,number,vendor_id,status)
select ('b9510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b9510000-0000-4000-8000-000000000010','REVIEW-'||n,'b9510000-0000-4000-8000-000000000020','confirmed' from generate_series(60,68) n;
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang)
select ('b9510000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'b9510000-0000-4000-8000-000000000010',('b9510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Review service',10,case when n=68 then 0 else 100 end from generate_series(60,68) n;
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang,product_id) values
('b9510000-0000-4000-8000-000000000261','b9510000-0000-4000-8000-000000000010','b9510000-0000-4000-8000-000000000061','Second service',10,100,null),
('b9510000-0000-4000-8000-000000000263','b9510000-0000-4000-8000-000000000010','b9510000-0000-4000-8000-000000000063','Review stock',10,100,'b9510000-0000-4000-8000-000000000040');
create function pg_temp.review_id(n integer) returns uuid language sql immutable as $$select ('b9510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.bill(n integer,ref text,patch jsonb default '{}') returns uuid language sql as $$select public.bill_purchase_order(pg_temp.review_id(10),pg_temp.review_id(n),jsonb_build_object('vendor_reference',ref,'bill_date','2026-10-01','input_vat_rate',7,'input_vat_satang',70,'vendor_total_satang',1070)||patch)$$;
create function pg_temp.credit(n integer,ref text,qty numeric,vat bigint,patch jsonb default '{}') returns uuid language sql as $$select public.link_vendor_credit(pg_temp.review_id(10),(select id from public.costs where purchase_order_id=pg_temp.review_id(n) and purchase_cost_kind='credit' and vendor_bill_match_id is null order by created_at,id limit 1),jsonb_build_object('vendor_reference',ref,'bill_date','2026-10-23','input_vat_rate',7,'input_vat_satang',vat,'original_bill_id',(select id from public.vendor_bill_matches where purchase_order_id=pg_temp.review_id(n) and kind='bill'),'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.review_id(n+100),'quantity',qty)))||patch)$$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9510000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.receive_purchase_order(pg_temp.review_id(10),pg_temp.review_id(n),(select jsonb_agg(jsonb_build_object('id',id,'received_quantity',10,'previous_received_quantity',0)) from public.purchase_order_items where purchase_order_id=pg_temp.review_id(n))) from generate_series(60,68) n;

select throws_ok($$select pg_temp.bill(60,'IMPOSSIBLE','{"input_vat_satang":1000,"vendor_total_satang":1000,"variance_reason":"Approved"}')$$,'P0001','Input VAT contradicts matched base and rate','a reason cannot legitimize implausible VAT');
select throws_ok($$select pg_temp.bill(60,'HIDDEN-BASE','{"vendor_total_satang":2000,"variance_reason":"Approved"}')$$,'P0001','Vendor total must equal matched base plus VAT','total variance must be represented in the billed lines');
select throws_ok($$select pg_temp.bill(60,'ZERO-RATE','{"input_vat_rate":0,"input_vat_satang":1,"vendor_total_satang":1001,"variance_reason":"Approved"}')$$,'P0001','Input VAT contradicts matched base and rate','zero rate cannot carry VAT');
select lives_ok($$select pg_temp.bill(60,'ROUNDING','{"input_vat_satang":73,"vendor_total_satang":1073,"variance_reason":"Vendor rounding"}')$$,'bounded vendor rounding is accepted');
select throws_ok($$select pg_temp.bill(61,'UUID-ALIAS',jsonb_build_object('input_vat_satang',140,'vendor_total_satang',2140,'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.review_id(161),'quantity',10,'expected_quantity',10,'unit_cost_satang',100),jsonb_build_object('id',upper(pg_temp.review_id(161)::text),'quantity',10,'expected_quantity',10,'unit_cost_satang',100))))$$,'P0001','Match every unbilled received line once','UUID case aliases cannot duplicate a bill line');
select is((select sum(billed_quantity) from public.purchase_order_items where purchase_order_id=pg_temp.review_id(61)),0::numeric,'invalid line set consumes no receipt');

select lives_ok($$select pg_temp.bill(62,'MATCHED-PRICE','{"input_vat_satang":140,"vendor_total_satang":2140,"variance_reason":"Accepted price","lines":[{"id":"b9510000-0000-4000-8000-000000000162","quantity":10,"expected_quantity":10,"unit_cost_satang":200}]}')$$,'bill accepts a documented price variance');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(62),'[{"id":"b9510000-0000-4000-8000-000000000162","returned_quantity":4}]');
select lives_ok($$select pg_temp.credit(62,'PRICE-CN-1',4,56)$$,'partial return links at the accepted billed price');
select is((select amount_satang-input_vat_satang from public.costs where vendor_invoice_reference='PRICE-CN-1'),-800::bigint,'credit uses billed unit price rather than PO price');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(62),'[{"id":"b9510000-0000-4000-8000-000000000162","returned_quantity":10}]');
select lives_ok($$select pg_temp.credit(62,'PRICE-CN-2',6,84)$$,'remaining return links without exceeding the bill');
select is((select sum(amount_satang) from public.costs where purchase_order_id=pg_temp.review_id(62)),0::numeric,'full service return leaves no cost or VAT residual');
select is((select sum((line->>'quantity')::numeric) from public.vendor_bill_matches m cross join lateral jsonb_array_elements(m.lines) line where m.purchase_order_id=pg_temp.review_id(62) and m.kind='credit'),10::numeric,'credit evidence retains cumulative per-line returned quantities');
reset role;
insert into public.costs(org_id,vendor_id,purchase_order_id,amount_satang,purchase_cost_kind) values(pg_temp.review_id(10),pg_temp.review_id(20),pg_temp.review_id(62),-100,'credit');
set local role authenticated;
select throws_ok($$select pg_temp.credit(62,'OVER-CREDIT',1,0)$$,'P0001','Credit quantity exceeds original billed or returned quantity','another credit cannot exceed the fully credited bill line');

select lives_ok($$select pg_temp.bill(63,'MIXED-PRICE','{"input_vat_satang":280,"vendor_total_satang":4280,"variance_reason":"Accepted prices","lines":[{"id":"b9510000-0000-4000-8000-000000000163","quantity":10,"expected_quantity":10,"unit_cost_satang":200},{"id":"b9510000-0000-4000-8000-000000000263","quantity":10,"expected_quantity":10,"unit_cost_satang":200}]}')$$,'mixed bill accepts matched inventory and service prices');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(63),'[{"id":"b9510000-0000-4000-8000-000000000163","returned_quantity":10},{"id":"b9510000-0000-4000-8000-000000000263","returned_quantity":10}]');
select lives_ok($$select pg_temp.credit(63,'MIXED-CN',10,280,jsonb_build_object('cost_ids',(select jsonb_agg(id) from public.costs where purchase_order_id=pg_temp.review_id(63) and purchase_cost_kind='credit'),'lines','[{"id":"b9510000-0000-4000-8000-000000000163","quantity":10},{"id":"b9510000-0000-4000-8000-000000000263","quantity":10}]'::jsonb))$$,'one atomic credit note covers all return categories');
select is((select count(distinct vendor_bill_match_id)::int from public.costs where purchase_order_id=pg_temp.review_id(63) and purchase_cost_kind='credit'),1,'mixed category credits share one match');
select is((select sum(input_vat_satang) from public.costs where vendor_invoice_reference='MIXED-CN'),(-280)::numeric,'mixed VAT is allocated once');
select is((select sum(amount_satang-input_vat_satang) from public.costs where purchase_order_id=pg_temp.review_id(63) and category='other'),0::numeric,'mixed service base fully reverses');
select is((select sum(amount_satang-input_vat_satang) from public.costs where purchase_order_id=pg_temp.review_id(63) and category='inventory' and purchase_cost_kind in ('credit','return_adjustment')),(-1000)::numeric,'stock value removed equals signed credit base plus adjustment');
select is((select sum(amount_satang) from public.costs where purchase_order_id=pg_temp.review_id(63) and purchase_cost_kind='return_adjustment'),1000::numeric,'linking posts its own stock price reconciliation');
select is((select value_satang from public.stock_on_hand where org_id=pg_temp.review_id(10) and product_id=pg_temp.review_id(40)),0::bigint,'linking does not repost stock');

select pg_temp.bill(64,'SECOND');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(64),'[{"id":"b9510000-0000-4000-8000-000000000164","returned_quantity":1}]');
select throws_ok($$select pg_temp.credit(64,' mixed-cn ',1,7)$$,'P0001','Duplicate vendor invoice reference','vendor credit reference remains unique across orders');
select throws_ok($$select pg_temp.credit(64,'CREDIT-VAT',1,70,'{"variance_reason":"Approved"}')$$,'P0001','Input VAT contradicts matched base and rate','credit reason cannot hide implausible VAT');
select is((select count(*)::int from public.costs where purchase_order_id=pg_temp.review_id(64) and purchase_cost_kind='credit' and vendor_bill_match_id is not null),0,'rejected credits leave no partial allocation');

select pg_temp.bill(67,'QTY-PRICE','{"input_vat_satang":78,"vendor_total_satang":1189,"variance_reason":"Accepted quantity and price","lines":[{"id":"b9510000-0000-4000-8000-000000000167","quantity":11,"expected_quantity":10,"unit_cost_satang":101}]}');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(67),'[{"id":"b9510000-0000-4000-8000-000000000167","returned_quantity":3}]');
select lives_ok($$select pg_temp.credit(67,'QTY-CN-1',3,23)$$,'quantity variance credit uses the accepted base over the physical quantity');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(67),'[{"id":"b9510000-0000-4000-8000-000000000167","returned_quantity":10}]');
select lives_ok($$select pg_temp.credit(67,'QTY-CN-2',7,55)$$,'final quantity credit consumes the cumulative rounding remainder');
select is((select sum(amount_satang) from public.costs where purchase_order_id=pg_temp.review_id(67)),0::numeric,'quantity variance full return has no rounding residual');
select pg_temp.bill(68,'FREE-PO','{"input_vat_satang":70,"vendor_total_satang":1070,"variance_reason":"Accepted price","lines":[{"id":"b9510000-0000-4000-8000-000000000168","quantity":10,"expected_quantity":10,"unit_cost_satang":100}]}');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(68),'[{"id":"b9510000-0000-4000-8000-000000000168","returned_quantity":10}]');
select lives_ok($$select pg_temp.credit(68,'FREE-PO-CN',10,70)$$,'zero PO price return can reverse an accepted nonzero billed price');
select is((select sum(amount_satang) from public.costs where purchase_order_id=pg_temp.review_id(68)),0::numeric,'zero PO full return has no residual cost');

select pg_temp.bill(65,'LOCK-SOURCE');
select public.return_purchase_order(pg_temp.review_id(10),pg_temp.review_id(65),'[{"id":"b9510000-0000-4000-8000-000000000165","returned_quantity":1}]');
reset role;
update public.costs set incurred_on='2026-09-30',bill_date='2026-09-30' where purchase_order_id=pg_temp.review_id(65) and purchase_cost_kind='credit';
set local role authenticated;
select public.update_finance_lock_date(pg_temp.review_id(10),'2026-09-30');
select throws_ok($$select pg_temp.credit(65,'LOCKED-CREDIT',1,7)$$,'P0001','Finance period is locked','open credit date cannot rewrite an existing locked cost');
select is((select incurred_on from public.costs where purchase_order_id=pg_temp.review_id(65) and purchase_cost_kind='credit'),'2026-09-30'::date,'locked source remains in its original period');
select * from finish();
rollback;
