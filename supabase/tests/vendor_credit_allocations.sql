begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values('b9530000-0000-4000-8000-000000000001','credit-allocations@example.invalid');
insert into public.organizations(id,name,slug) values('b9530000-0000-4000-8000-000000000010','Credit allocations','credit-allocations');
insert into public.memberships(org_id,user_id,role) values('b9530000-0000-4000-8000-000000000010','b9530000-0000-4000-8000-000000000001','owner');
insert into public.vendors(id,org_id,name) values('b9530000-0000-4000-8000-000000000020','b9530000-0000-4000-8000-000000000010','Allocation supplier');
insert into public.purchase_orders(id,org_id,number,vendor_id,status)
select ('b9530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b9530000-0000-4000-8000-000000000010','ALLOC-'||n,'b9530000-0000-4000-8000-000000000020','confirmed' from generate_series(60,63) n;
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang)
select ('b9530000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'b9530000-0000-4000-8000-000000000010',('b9530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Allocation service',case when n=61 then 0.015 else 10 end,case when n=61 then 333 else 100 end from generate_series(60,63) n;
create function pg_temp.alloc_id(n integer) returns uuid language sql immutable as $$select ('b9530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.alloc_bill(n integer,ref text,rate numeric,vat bigint,price bigint) returns uuid language sql as $$
select public.bill_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(n),jsonb_build_object('vendor_reference',ref,'bill_date','2026-10-01','input_vat_rate',rate,'input_vat_satang',vat,'vendor_total_satang',round((select received_quantity-returned_quantity-billed_quantity from public.purchase_order_items where id=pg_temp.alloc_id(n+100))*price)+vat,'variance_reason','Matched vendor price','lines',jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(n+100),'quantity',(select received_quantity-returned_quantity-billed_quantity from public.purchase_order_items where id=pg_temp.alloc_id(n+100)),'expected_quantity',(select received_quantity-returned_quantity-billed_quantity from public.purchase_order_items where id=pg_temp.alloc_id(n+100)),'unit_cost_satang',price))))$$;
create function pg_temp.alloc_payload(ref text,qty_a numeric default 5,qty_b numeric default 5) returns jsonb language sql as $$
select jsonb_build_object('vendor_reference',ref,'bill_date','2026-10-23','input_vat_satang',220,'cost_ids',jsonb_build_array(current_setting('test.alloc_source')::uuid),'allocations',jsonb_build_array(jsonb_build_object('original_bill_id',(select id from public.vendor_bill_matches where vendor_reference='ORIGINAL-A'),'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(160),'quantity',qty_a))),jsonb_build_object('original_bill_id',(select id from public.vendor_bill_matches where vendor_reference='ORIGINAL-B'),'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(160),'quantity',qty_b)))))$$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9530000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.receive_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(60),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(160),'received_quantity',5,'previous_received_quantity',0)));
select pg_temp.alloc_bill(60,'ORIGINAL-A',7,70,200);
select public.receive_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(60),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(160),'received_quantity',10,'previous_received_quantity',5)));
select pg_temp.alloc_bill(60,'ORIGINAL-B',10,150,300);
select public.return_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(60),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(160),'returned_quantity',10)));
select set_config('test.alloc_source',(select id::text from public.costs where purchase_order_id=pg_temp.alloc_id(60) and purchase_cost_kind='credit'),true);
select throws_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),current_setting('test.alloc_source')::uuid,pg_temp.alloc_payload('OVER-ALLOC',6,4))$$,'P0001','Credit quantity exceeds original billed or returned quantity','one allocation cannot borrow another original bill quantity');
select is((select count(*)::int from public.vendor_bill_matches where kind='credit' and org_id=pg_temp.alloc_id(10)),0,'over-allocation changes no evidence');
select lives_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),current_setting('test.alloc_source')::uuid,pg_temp.alloc_payload('TWO-ORIGINAL-CN'))$$,'one credit covers a ten-unit return across two five-unit originals');
select is((select count(*)::int from public.vendor_bill_matches where vendor_reference='TWO-ORIGINAL-CN'),1,'one vendor reference creates one credit evidence record');
select is((select sum(amount_satang-input_vat_satang) from public.costs where vendor_invoice_reference='TWO-ORIGINAL-CN'),(-2500)::numeric,'credit values every allocation at its original matched price');
select is((select sum(input_vat_satang) from public.costs where vendor_invoice_reference='TWO-ORIGINAL-CN' and input_vat_rate=7),(-70)::numeric,'seven percent original retains its VAT bucket');
select is((select sum(input_vat_satang) from public.costs where vendor_invoice_reference='TWO-ORIGINAL-CN' and input_vat_rate=10),(-150)::numeric,'ten percent original retains its VAT bucket');
select is((select sum(amount_satang) from public.costs where purchase_order_id=pg_temp.alloc_id(60)),0::numeric,'two-original full service return leaves no residual');
select lives_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),current_setting('test.alloc_source')::uuid,pg_temp.alloc_payload(' two-original-cn '))$$,'canonical retry returns the already recorded credit');
select is((select count(*)::int from public.vendor_bill_matches where kind='credit' and purchase_order_id=pg_temp.alloc_id(60)),1,'retry creates no second credit');
select throws_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),current_setting('test.alloc_source')::uuid,pg_temp.alloc_payload('TWO-ORIGINAL-CN',4,6))$$,'P0001','Vendor credit already linked with different evidence','changed retry cannot rewrite allocation evidence');

select public.receive_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(61),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(161),'received_quantity',0.015,'previous_received_quantity',0)));
select pg_temp.alloc_bill(61,'FRACTIONAL-ORIGINAL',0,0,500);
select public.return_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(61),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(161),'returned_quantity',n*0.001))) from generate_series(1,15) n;
select is((select count(*)::int from public.costs where purchase_order_id=pg_temp.alloc_id(61) and purchase_cost_kind='credit' and amount_satang=0),10,'fractional returns create ten whole zero-value source costs');
select lives_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),(select id from public.costs where purchase_order_id=pg_temp.alloc_id(61) and purchase_cost_kind='credit' and amount_satang=0 order by id limit 1),jsonb_build_object('vendor_reference','FRACTIONAL-ZERO-CN','bill_date','2026-10-23','input_vat_satang',0,'cost_ids',(select jsonb_agg(id) from public.costs where purchase_order_id=pg_temp.alloc_id(61) and purchase_cost_kind='credit' and amount_satang=0),'allocations',jsonb_build_array(jsonb_build_object('original_bill_id',(select id from public.vendor_bill_matches where vendor_reference='FRACTIONAL-ORIGINAL'),'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(161),'quantity',0.010))))))$$,'arbitrary grouped fractional sources use exact quantities rather than rounding tolerance');
select is((select sum(amount_satang-input_vat_satang) from public.costs where vendor_invoice_reference='FRACTIONAL-ZERO-CN'),(-5)::numeric,'zero raw costs still reverse their original matched base share');
select is((select count(*)::int from public.costs where purchase_order_id=pg_temp.alloc_id(61) and purchase_cost_kind='credit' and vendor_bill_match_id is null),5,'unselected fractional source costs remain available');

select public.receive_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(62),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(162),'received_quantity',10,'previous_received_quantity',0)));
select pg_temp.alloc_bill(62,'LOCK-ORIGINAL',7,70,100);
select public.return_purchase_order(pg_temp.alloc_id(10),pg_temp.alloc_id(62),jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(162),'returned_quantity',10)));
reset role;
update public.costs set incurred_on='2026-09-30',bill_date='2026-09-30' where purchase_order_id=pg_temp.alloc_id(62) and purchase_cost_kind='credit';
set local role authenticated;
select public.update_finance_lock_date(pg_temp.alloc_id(10),'2026-09-30');
select throws_ok($$select public.link_vendor_credit(pg_temp.alloc_id(10),(select id from public.costs where purchase_order_id=pg_temp.alloc_id(62) and purchase_cost_kind='credit'),jsonb_build_object('vendor_reference','LOCK-CN','bill_date','2026-10-23','input_vat_satang',70,'allocations',jsonb_build_array(jsonb_build_object('original_bill_id',(select id from public.vendor_bill_matches where vendor_reference='LOCK-ORIGINAL'),'lines',jsonb_build_array(jsonb_build_object('id',pg_temp.alloc_id(162),'quantity',10))))))$$,'P0001','Finance period is locked','an open multi-allocation credit date cannot rewrite a locked source');
select is((select amount_satang from public.costs where purchase_order_id=pg_temp.alloc_id(62) and purchase_cost_kind='credit'),(-1000)::bigint,'locked source is unchanged after rejected allocation');
select * from finish();
rollback;
