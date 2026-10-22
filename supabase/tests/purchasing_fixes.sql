begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.purchase_fix_id(n integer) returns uuid language sql immutable as $$
  select ('b6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.purchase_fix_id(1),'purchase-fix-owner@example.invalid',now()),
  (pg_temp.purchase_fix_id(2),'purchase-fix-member@example.invalid',now()),
  (pg_temp.purchase_fix_id(3),'purchase-fix-admin@example.invalid',now()),
  (pg_temp.purchase_fix_id(4),'purchase-fix-outsider@example.invalid',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.purchase_fix_id(10),'Purchasing fixes','purchasing-fixes'),
  (pg_temp.purchase_fix_id(20),'Foreign purchasing fixes','foreign-purchasing-fixes'),
  (pg_temp.purchase_fix_id(30),'Purchasing cascade','purchasing-cascade');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1),'owner'),
  (pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(2),'member'),
  (pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(3),'admin'),
  (pg_temp.purchase_fix_id(20),pg_temp.purchase_fix_id(4),'owner');
insert into public.vendors(id,org_id,name,email) values
  (pg_temp.purchase_fix_id(100),pg_temp.purchase_fix_id(10),'Original supplier','original@example.invalid'),
  (pg_temp.purchase_fix_id(101),pg_temp.purchase_fix_id(10),'Missing email supplier',null),
  (pg_temp.purchase_fix_id(200),pg_temp.purchase_fix_id(20),'Foreign supplier','foreign@example.invalid'),
  (pg_temp.purchase_fix_id(300),pg_temp.purchase_fix_id(30),'Cascade supplier','cascade@example.invalid');
insert into public.purchase_orders(id,org_id,number,vendor_id,order_date,expected_date,notes) values
  (pg_temp.purchase_fix_id(1000),pg_temp.purchase_fix_id(10),'RFQ-MAIN',pg_temp.purchase_fix_id(100),'2026-10-24','2026-11-01','Agreed terms'),
  (pg_temp.purchase_fix_id(1001),pg_temp.purchase_fix_id(10),'RFQ-EMPTY',pg_temp.purchase_fix_id(100),'2026-10-24',null,null),
  (pg_temp.purchase_fix_id(1002),pg_temp.purchase_fix_id(10),'RFQ-INVALID',pg_temp.purchase_fix_id(101),'2026-10-24',null,null),
  (pg_temp.purchase_fix_id(1003),pg_temp.purchase_fix_id(10),'RFQ-LARGE',pg_temp.purchase_fix_id(100),'2026-10-24',null,null),
  (pg_temp.purchase_fix_id(1004),pg_temp.purchase_fix_id(10),'PO-MAINTENANCE',pg_temp.purchase_fix_id(100),'2026-10-24',null,null),
  (pg_temp.purchase_fix_id(2000),pg_temp.purchase_fix_id(20),'RFQ-FOREIGN',pg_temp.purchase_fix_id(200),'2026-10-24',null,null),
  (pg_temp.purchase_fix_id(3000),pg_temp.purchase_fix_id(30),'PO-CASCADE',pg_temp.purchase_fix_id(300),'2026-10-24',null,null);
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit,unit_cost_satang,position) values
  (pg_temp.purchase_fix_id(1101),pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),'Second line',2.5,'day',101,1),
  (pg_temp.purchase_fix_id(1100),pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),'First line',3,'piece',200,0),
  (pg_temp.purchase_fix_id(1102),pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),'Third line',1,'hour',300,1),
  (pg_temp.purchase_fix_id(1200),pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002),'Invalid recipient line',1,'piece',100,0),
  (pg_temp.purchase_fix_id(1400),pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1004),'Maintenance line',1,'piece',100,0),
  (pg_temp.purchase_fix_id(2100),pg_temp.purchase_fix_id(20),pg_temp.purchase_fix_id(2000),'Foreign line',1,'piece',100,0),
  (pg_temp.purchase_fix_id(3100),pg_temp.purchase_fix_id(30),pg_temp.purchase_fix_id(3000),'Cascade line',1,'piece',100,0);
insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang,position)
  select pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1003),'Bulk line '||n,1,1,n from generate_series(1,1001) n;

select lives_ok($$delete from public.purchase_orders where id=pg_temp.purchase_fix_id(1004)$$,'privileged maintenance can delete a PO with lines');
select is((select count(*) from public.purchase_order_items where purchase_order_id=pg_temp.purchase_fix_id(1004)),0::bigint,'PO deletion cascades to its lines');
select lives_ok($$delete from public.organizations where id=pg_temp.purchase_fix_id(30)$$,'organization cascade can delete purchase lines after their parent');
select is((select count(*) from public.purchase_orders where org_id=pg_temp.purchase_fix_id(30)),0::bigint,'organization cascade removes purchase orders');
select is((select count(*) from public.purchase_order_items where org_id=pg_temp.purchase_fix_id(30)),0::bigint,'organization cascade removes purchase lines');
select is((select count(*) from public.vendors where org_id=pg_temp.purchase_fix_id(30)),0::bigint,'organization cascade removes vendors');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(9999),'Orphan',1,100)$$,'P0001','Purchase order unavailable','parentless inserts remain rejected');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.purchase_fix_id(1))::text,true);
set local role authenticated;
select throws_ok($$update public.purchase_orders set rfq_snapshot='{}' where id=pg_temp.purchase_fix_id(1000)$$,'42501',null,'authenticated PO update remains revoked');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(2000),'Foreign parent',1,100)$$,'P0001','Purchase order unavailable','line guard still scopes the parent by tenant');
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(20),pg_temp.purchase_fix_id(2000))$$,'P0001','Only owners and admins may manage purchases','RFQ claim rejects a foreign workspace');
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(2000))$$,'P0001','Purchase order unavailable','RFQ claim rejects a foreign PO in a permitted workspace');
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1001))$$,'P0001','Add purchase lines first','empty RFQ cannot be claimed');
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002))$$,'P0001','Valid vendor email required','missing vendor email cannot be frozen');
update public.vendors set email='  ' where id=pg_temp.purchase_fix_id(101);
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002))$$,'P0001','Valid vendor email required','blank vendor email cannot be frozen');
update public.vendors set email='bad-address' where id=pg_temp.purchase_fix_id(101);
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002))$$,'P0001','Valid vendor email required','malformed vendor email cannot be frozen');
update public.vendors set email='.bad@example.invalid' where id=pg_temp.purchase_fix_id(101);
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002))$$,'P0001','Valid vendor email required','leading-dot email cannot be frozen');
update public.vendors set email='bad..address@example.invalid' where id=pg_temp.purchase_fix_id(101);
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1002))$$,'P0001','Valid vendor email required','double-dot email cannot be frozen');
select is((select status::text from public.purchase_orders where id=pg_temp.purchase_fix_id(1002)),'draft','failed email validation preserves draft state');
select ok((select rfq_snapshot is null and rfq_delivery_key is null from public.purchase_orders where id=pg_temp.purchase_fix_id(1002)),'failed claims leave no delivery authorization');

select set_config('test.rfq_claim',public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000))::text,true);
select is((select status::text from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),'sent','claim atomically marks RFQ sent');
select ok((select rfq_delivery_key is not null and rfq_delivered_at is null from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),'claim records one key before external delivery');
select is((select rfq_delivery_key::text from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),current_setting('test.rfq_claim')::jsonb->>'delivery_key','returned delivery key matches persistent authorization');
select is((select rfq_snapshot from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),current_setting('test.rfq_claim')::jsonb->'snapshot','returned snapshot matches persistent snapshot');
select is((select rfq_snapshot from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),jsonb_build_object(
  'to','original@example.invalid','number','RFQ-MAIN','vendorName','Original supplier','orderDate','2026-10-24','expectedDate','2026-11-01','notes','Agreed terms',
  'lines',jsonb_build_array(
    jsonb_build_object('description','First line','quantity',3,'unit','piece','unit_cost_satang',200),
    jsonb_build_object('description','Second line','quantity',2.5,'unit','day','unit_cost_satang',101),
    jsonb_build_object('description','Third line','quantity',1,'unit','hour','unit_cost_satang',300))),
  'snapshot contains the recipient, header and all lines in stable order');
select is(public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000)),null::jsonb,'second claim grants no delivery authorization');
select is((select count(*) from public.audit_log where entity_id=pg_temp.purchase_fix_id(1000) and action='rfq_claimed'),1::bigint,'only the first claim is audited');
select is((select count(*) from public.audit_log where entity_id=pg_temp.purchase_fix_id(1000) and action='record_status_changed' and meta->>'to'='sent'),1::bigint,'claim records the sent status transition');
update public.vendors set name='Edited supplier',email='edited@example.invalid' where id=pg_temp.purchase_fix_id(100);
select is((select rfq_snapshot from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),current_setting('test.rfq_claim')::jsonb->'snapshot','later vendor edits preserve the delivery snapshot');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),'Late line',1,100)$$,'P0001','Only draft purchase lines are editable','claimed RFQ rejects new lines');
select throws_ok($$delete from public.purchase_order_items where id=pg_temp.purchase_fix_id(1100)$$,'P0001','Only draft purchase lines are editable','claimed RFQ lines cannot be deleted');

select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(20),pg_temp.purchase_fix_id(2000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid)$$,'P0001','Only owners and admins may manage purchases','finish rejects a foreign workspace');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(2000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid)$$,'P0001','RFQ delivery unavailable','finish scopes the PO to the authorized workspace');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),pg_temp.purchase_fix_id(9999))$$,'P0001','RFQ delivery unavailable','finish rejects a different delivery key');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),null)$$,'P0001','RFQ delivery unavailable','finish rejects a missing delivery key');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1001),null)$$,'P0001','RFQ delivery unavailable','unclaimed RFQ cannot be marked delivered');
select lives_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid,repeat('x',5000))$$,'failed external delivery can be recorded');
select is((select length(rfq_delivery_error) from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),4000,'provider delivery errors are bounded');
select ok((select rfq_delivered_at is null and status='sent' from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),'failed delivery keeps the claimed snapshot frozen');
select is(public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000)),null::jsonb,'failed delivery does not grant a second send');
select lives_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid)$$,'successful delivery can be recorded');
select ok((select rfq_delivered_at is not null and rfq_delivery_error is null from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),'successful delivery records completion and clears failure');
select lives_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid,'Late failure')$$,'late delivery outcome is an idempotent no-op');
select ok((select rfq_delivered_at is not null and rfq_delivery_error is null from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),'late failure cannot replace successful delivery');
select is((select rfq_snapshot from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),current_setting('test.rfq_claim')::jsonb->'snapshot','delivery completion preserves the original snapshot');
select is((select rfq_delivery_key::text from public.purchase_orders where id=pg_temp.purchase_fix_id(1000)),current_setting('test.rfq_claim')::jsonb->>'delivery_key','delivery completion preserves the original key');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.purchase_fix_id(2))::text,true);
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1003))$$,'P0001','Only owners and admins may manage purchases','ordinary member cannot claim an RFQ');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),(current_setting('test.rfq_claim')::jsonb->>'delivery_key')::uuid)$$,'P0001','Only owners and admins may manage purchases','ordinary member cannot finish an RFQ');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1001),'Member line',1,100)$$,'P0001','Only owners and admins may manage purchases','line guard retains its explicit staff check');
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.purchase_fix_id(3))::text,true);
select set_config('test.rfq_large_claim',public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1003))::text,true);
select is((select status::text from public.purchase_orders where id=pg_temp.purchase_fix_id(1003)),'sent','admin can claim RFQ delivery');
select is(jsonb_array_length(current_setting('test.rfq_large_claim')::jsonb->'snapshot'->'lines'),1001,'SQL RFQ snapshot includes more than the API row cap');
select is(current_setting('test.rfq_large_claim')::jsonb->'snapshot'->'lines'->1000->>'description','Bulk line 1001','RFQ snapshot includes the final line beyond the API cap');
select lives_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1003),(current_setting('test.rfq_large_claim')::jsonb->>'delivery_key')::uuid)$$,'admin can finish RFQ delivery');
reset role;
set local role anon;
select throws_ok($$select public.claim_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1001))$$,'42501',null,'anonymous RFQ claim is denied');
select throws_ok($$select public.finish_purchase_rfq(pg_temp.purchase_fix_id(10),pg_temp.purchase_fix_id(1000),pg_temp.purchase_fix_id(9999))$$,'42501',null,'anonymous RFQ finish is denied');
reset role;
select * from finish();
rollback;
