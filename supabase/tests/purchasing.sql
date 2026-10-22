begin;
create extension if not exists pgtap with schema extensions;
select plan(44);
insert into auth.users(id,email,email_confirmed_at) values
 ('b6000000-0000-4000-8000-000000000001','purchase-owner@example.invalid',now()),
 ('b6000000-0000-4000-8000-000000000002','purchase-member@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('b6000000-0000-4000-8000-000000000010','Purchasing test','purchasing-test'),
 ('b6000000-0000-4000-8000-000000000011','Other purchasing test','other-purchasing-test');
insert into public.memberships(org_id,user_id,role) values
 ('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000001','owner'),
 ('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000002','member');
insert into public.vendors(id,org_id,name,payment_terms_days) values
 ('b6000000-0000-4000-8000-000000000020','b6000000-0000-4000-8000-000000000010','Test supplier',14),
 ('b6000000-0000-4000-8000-000000000021','b6000000-0000-4000-8000-000000000011','Other supplier',30);
insert into public.products(id,org_id,name,unit,cost_satang) values
 ('b6000000-0000-4000-8000-000000000030','b6000000-0000-4000-8000-000000000010','Test product','day',101),
 ('b6000000-0000-4000-8000-000000000031','b6000000-0000-4000-8000-000000000011','Other product','piece',202);
insert into public.purchase_orders(id,org_id,number,vendor_id) values
 ('b6000000-0000-4000-8000-000000000050','b6000000-0000-4000-8000-000000000011','PO-2026-001','b6000000-0000-4000-8000-000000000021');
insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values
 ('b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000050','Other line',1,202);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendors'::regclass),'vendor RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.purchase_orders'::regclass),'PO RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.purchase_order_items'::regclass),'line RLS forced');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from public.vendors),1,'vendor read scoped to workspace');
select throws_ok($$insert into public.vendors(org_id,name) values('b6000000-0000-4000-8000-000000000011','Cross tenant')$$,'42501',null,'cross tenant vendor insert rejected');
select set_config('test.purchase',public.create_purchase_order('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000020','2026-10-24',null,null)::text,true);
select set_config('test.purchase2',public.create_purchase_order('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000020','2026-10-24',null,null)::text,true);
select is((select number from public.purchase_orders where id=current_setting('test.purchase')::uuid),'PO-2026-001','counter starts at PO-YYYY-001');
select is((select number from public.purchase_orders where id=current_setting('test.purchase2')::uuid),'PO-2026-002','counter advances atomically');
select is((select count(*)::int from public.purchase_orders),2,'other workspace PO is invisible');
select is((select count(*)::int from public.purchase_order_items),0,'other workspace lines are invisible');
select throws_ok($$select public.create_purchase_order('b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000021','2026-10-24')$$,'P0001','Only owners and admins may manage purchases','cross tenant command rejected');
select throws_ok($$select public.create_purchase_order('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000021','2026-10-24')$$,'P0001','Active workspace vendor required','cross tenant vendor rejected');
select throws_ok($$update public.purchase_orders set status='billed' where id=current_setting('test.purchase')::uuid$$,'42501',null,'status cannot bypass commands');
select throws_ok($$select public.transition_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'confirmed')$$,'P0001','Add purchase lines first','empty PO cannot confirm');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,product_id,description,quantity,unit_cost_satang) values('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'b6000000-0000-4000-8000-000000000031','Bad product',1,101)$$,'P0001','Active workspace product required','cross tenant product rejected');
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang)
 values('b6000000-0000-4000-8000-000000000040','b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'b6000000-0000-4000-8000-000000000030','Agreed product',2.5,'day',101);
select is((select round(sum(quantity*unit_cost_satang))::bigint from public.purchase_order_items),253::bigint,'exact line rounding in satang');
select throws_ok($$insert into public.purchase_order_items(org_id,purchase_order_id,description,quantity,unit_cost_satang) values('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'Unsafe',2,9007199254740991)$$,'P0001','Purchase total exceeds safe satang bounds','unsafe total rejected');
select throws_ok($$update public.purchase_order_items set received_quantity=2.5 where id='b6000000-0000-4000-8000-000000000040'$$,'42501',null,'receipt cannot bypass command');
select lives_ok($$select public.transition_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'confirmed')$$,'confirm draft PO');
select throws_ok($$delete from public.purchase_order_items where id='b6000000-0000-4000-8000-000000000040'$$,'P0001','Only draft purchase lines are editable','confirmed snapshot cannot be deleted');
update public.products set name='Repriced',cost_satang=999,active=false where id='b6000000-0000-4000-8000-000000000030';
select is((select description||':'||unit||':'||unit_cost_satang from public.purchase_order_items),'Agreed product:day:101','catalog edits preserve agreed snapshot');
select lives_ok($$select public.receive_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'[{"id":"b6000000-0000-4000-8000-000000000040","previous_received_quantity":0,"received_quantity":1.25}]')$$,'partial receipt accepted');
select is((select status::text from public.purchase_orders where id=current_setting('test.purchase')::uuid),'confirmed','partial receipt leaves order open');
select lives_ok($$select public.receive_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'[{"id":"b6000000-0000-4000-8000-000000000040","previous_received_quantity":1.25,"received_quantity":1.25}]')$$,'receipt retry idempotent');
select is((select received_quantity from public.purchase_order_items),1.250::numeric,'retry does not add twice');
select throws_ok($$select public.receive_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'[{"id":"b6000000-0000-4000-8000-000000000040","previous_received_quantity":1.25,"received_quantity":3}]')$$,'P0001','Invalid cumulative receipt quantity','overreceipt rejected');
select throws_ok($$select public.receive_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'[{"id":"b6000000-0000-4000-8000-000000000040","previous_received_quantity":1.25,"received_quantity":1}]')$$,'P0001','Invalid cumulative receipt quantity','backward receipt rejected');
select throws_ok($$select public.transition_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'cancelled')$$,'P0001','Invalid purchase transition','received evidence cannot be cancelled');
select set_config('test.bill',public.bill_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid)::text,true);
select is((select amount_satang from public.costs where id=current_setting('test.bill')::uuid),126::bigint,'partial bill uses received cost');
select is(public.bill_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid),current_setting('test.bill')::uuid,'bill retry returns previous bill');
select is((select count(*)::int from public.costs),1,'retry does not duplicate money out');
select is((select due_date-bill_date from public.costs),14,'bill inherits vendor payment terms');
select lives_ok($$select public.receive_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid,'[{"id":"b6000000-0000-4000-8000-000000000040","previous_received_quantity":1.25,"received_quantity":2.5}]')$$,'remaining receipt accepted after partial bill');
select is((select status::text from public.purchase_orders where id=current_setting('test.purchase')::uuid),'received','full receipt marks received');
select public.bill_purchase_order('b6000000-0000-4000-8000-000000000010',current_setting('test.purchase')::uuid);
select is((select sum(amount_satang)::bigint from public.costs),253::bigint,'incremental bills equal exact full cost');
select is((select status::text from public.purchase_orders where id=current_setting('test.purchase')::uuid),'billed','fully billed order marks billed');
select lives_ok($$update public.costs set paid_at=now() where id=current_setting('test.bill')::uuid$$,'owner can mark bill paid');
select throws_ok($$delete from public.costs where id=current_setting('test.bill')::uuid$$,'P0001','Linked vendor bills must be retained','vendor bill evidence retained');
select ok(private.record_exists('b6000000-0000-4000-8000-000000000010','vendor','b6000000-0000-4000-8000-000000000020'),'vendor history supported');
select ok(private.record_exists('b6000000-0000-4000-8000-000000000010','purchase_order',current_setting('test.purchase')::uuid),'purchase history supported');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$insert into public.vendors(org_id,name) values('b6000000-0000-4000-8000-000000000010','Member vendor')$$,'42501',null,'member cannot create vendor');
select throws_ok($$select public.create_purchase_order('b6000000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000020','2026-10-24')$$,'P0001','Only owners and admins may manage purchases','member cannot create PO');
select throws_ok($$update public.costs set paid_at=now() where paid_at is null$$,'P0001','Only owners and admins may pay vendor bills','member cannot pay bill');
reset role;
select is((select value from public.document_counters where org_id='b6000000-0000-4000-8000-000000000010' and kind='PO' and year=2026),2::bigint,'failed commands do not consume counter');
set local role anon;
select throws_ok($$select * from public.purchase_orders$$,'42501',null,'anonymous PO access denied');
reset role;
select * from finish();
rollback;
