begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users(id,email,email_confirmed_at) values
  ('b5000000-0000-4000-8000-000000000001','synthetic-product-owner@example.invalid',now()),
  ('b5000000-0000-4000-8000-000000000002','synthetic-product-member@example.invalid',now());
insert into public.organizations(id,name,slug) values
  ('b5000000-0000-4000-8000-000000000010','Synthetic product workspace','synthetic-products'),
  ('b5000000-0000-4000-8000-000000000011','Other product workspace','synthetic-other-products');
insert into public.memberships(org_id,user_id,role) values
  ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000001','owner'),
  ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000002','member');
insert into public.products(id,org_id,sku,name,unit,list_price_satang) values
  ('b5000000-0000-4000-8000-000000000020','b5000000-0000-4000-8000-000000000010','TRAINING','Training','day',101),
  ('b5000000-0000-4000-8000-000000000021','b5000000-0000-4000-8000-000000000011','TRAINING','Other training','hour',202);
insert into public.clients(id,org_id,name) values ('b5000000-0000-4000-8000-000000000030','b5000000-0000-4000-8000-000000000010','Synthetic product buyer');
insert into public.quotes(id,org_id,client_id,number) values ('b5000000-0000-4000-8000-000000000040','b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000030','PRODUCT-QUOTE');
insert into public.invoices(id,org_id,client_id,number,status) values ('b5000000-0000-4000-8000-000000000050','b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000030','PRODUCT-INVOICE','draft');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.products'::regclass),'product RLS enabled and forced');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b5000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from public.products),1,'owner sees only own workspace products');
select lives_ok($$insert into public.products(org_id,name) values ('b5000000-0000-4000-8000-000000000010','No SKU one'),('b5000000-0000-4000-8000-000000000010','No SKU two')$$,'multiple null SKUs allowed');
select throws_ok($$insert into public.products(org_id,sku,name) values ('b5000000-0000-4000-8000-000000000010','TRAINING','Duplicate')$$,'23505',null,'SKU unique inside one workspace');
select is((select count(*)::int from public.products where sku is null),2,'optional SKUs remain null');
select throws_ok($$insert into public.products(org_id,name) values ('b5000000-0000-4000-8000-000000000011','Cross workspace')$$,'42501',null,'owner cannot create in another workspace');
with changed as (update public.products set name='Forged' where id='b5000000-0000-4000-8000-000000000021' returning id) select is((select count(*)::int from changed),0,'cross workspace updates affect no rows');
with removed as (delete from public.products where id='b5000000-0000-4000-8000-000000000021' returning id) select is((select count(*)::int from removed),0,'cross workspace deletes affect no rows');
select throws_ok($$update public.products set org_id='b5000000-0000-4000-8000-000000000011' where id='b5000000-0000-4000-8000-000000000020'$$,'P0001','Tenant and record identity are immutable','product tenant identity immutable');
select throws_ok($$insert into public.products(org_id,name,list_price_satang) values ('b5000000-0000-4000-8000-000000000010','Unsafe',9007199254740992)$$,'23514',null,'unsafe satang rejected');
select throws_ok($$insert into public.products(org_id,name,cost_satang) values ('b5000000-0000-4000-8000-000000000010','Negative cost',-1)$$,'23514',null,'negative cost rejected');
select throws_ok($$insert into public.products(org_id,name,tax_rate_bps) values ('b5000000-0000-4000-8000-000000000010','Invalid tax',10001)$$,'23514',null,'invalid tax basis points rejected');
select throws_ok($$insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit_price_satang) values ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000040','b5000000-0000-4000-8000-000000000021','Forged',1,1)$$,'23503',null,'quote product reference cannot cross workspace');
select throws_ok($$insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit_price_satang) values ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000050','b5000000-0000-4000-8000-000000000021','Forged',1,1)$$,'23503',null,'invoice product reference cannot cross workspace');
insert into public.quote_items(org_id,quote_id,product_id,description,quantity,unit,unit_price_satang) values ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000040','b5000000-0000-4000-8000-000000000020','Agreed training',2.5,'day',101);
insert into public.invoice_items(org_id,invoice_id,product_id,description,quantity,unit,unit_price_satang) values ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000050','b5000000-0000-4000-8000-000000000020','Agreed training',2.5,'day',101);
select throws_ok($$update public.products set unit='hour' where id='b5000000-0000-4000-8000-000000000020'$$,'P0001','Product unit is locked by document lines','referenced product unit cannot invalidate accepted terms');
update public.products set name='Renamed training',description='New description',list_price_satang=999,active=false where id='b5000000-0000-4000-8000-000000000020';
select is((select description||':'||unit||':'||unit_price_satang||':'||amount_satang from public.quote_items where quote_id='b5000000-0000-4000-8000-000000000040'),'Agreed training:day:101:253','quote snapshot and exact half-up math survive catalog edit/archive');
select is((select description||':'||unit||':'||unit_price_satang||':'||amount_satang from public.invoice_items where invoice_id='b5000000-0000-4000-8000-000000000050'),'Agreed training:day:101:253','invoice snapshot survives catalog edit/archive');
select throws_ok($$insert into public.products(org_id,sku,name) values ('b5000000-0000-4000-8000-000000000010','TRAINING','Archived duplicate')$$,'23505',null,'archived products retain their SKU');
select is((select count(*)::int from public.products where active),2,'archive removes product from active selection');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b5000000-0000-4000-8000-000000000002"}',true);
select is((select count(*)::int from public.products),3,'member sees own products including archived');
select throws_ok($$insert into public.products(org_id,name) values ('b5000000-0000-4000-8000-000000000010','Member write')$$,'42501',null,'member cannot create products');
with changed as (update public.products set active=true where id='b5000000-0000-4000-8000-000000000020' returning id) select is((select count(*)::int from changed),0,'member cannot edit products');
with removed as (delete from public.products where id='b5000000-0000-4000-8000-000000000020' returning id) select is((select count(*)::int from removed),0,'member cannot delete products');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b5000000-0000-4000-8000-000000000001"}',true);
update public.quotes set status='sent' where id='b5000000-0000-4000-8000-000000000040';
update public.quotes set status='accepted' where id='b5000000-0000-4000-8000-000000000040';
select lives_ok($$select public.convert_accepted_quote('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000040','b5000000-0000-4000-8000-000000000060')$$,'conversion accepts archived product with agreed snapshot');
select is((select item.product_id::text||':'||item.unit||':'||item.unit_price_satang||':'||item.amount_satang from public.invoice_items item join public.invoices invoice on invoice.org_id=item.org_id and invoice.id=item.invoice_id where invoice.source_quote_id='b5000000-0000-4000-8000-000000000040'),'b5000000-0000-4000-8000-000000000020:day:101:253','conversion carries agreed product/unit/price without repricing');

insert into public.products(id,org_id,name,unit) values ('b5000000-0000-4000-8000-000000000022','b5000000-0000-4000-8000-000000000010','Disposable draft reference','day');
update public.invoice_items set product_id='b5000000-0000-4000-8000-000000000022' where invoice_id='b5000000-0000-4000-8000-000000000050';
delete from public.products where id='b5000000-0000-4000-8000-000000000022';
select is((select product_id from public.invoice_items where invoice_id='b5000000-0000-4000-8000-000000000050'),null::uuid,'product removal clears only nullable reference');
select is((select org_id::text||':'||description||':'||unit||':'||amount_satang from public.invoice_items where invoice_id='b5000000-0000-4000-8000-000000000050'),'b5000000-0000-4000-8000-000000000010:Agreed training:day:253','reference removal preserves tenant and line snapshot');
reset role;
select is((select count(*)::int from public.products where sku='TRAINING' and org_id in ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000011')),2,'same SKU allowed in different workspaces');
set local role authenticated;
select public.update_business_profile('b5000000-0000-4000-8000-000000000010','Synthetic seller','Synthetic address',null,'unknown');
insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,position) values ('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000050','Legacy unitless line',1,100,1);
select lives_ok($$select public.issue_invoice('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000050',(select version from public.invoices where id='b5000000-0000-4000-8000-000000000050'),'b5000000-0000-4000-8000-000000000061')$$,'invoice with unit and unitless lines issues');
select is((select snapshot->'lines'->0->>'unit' from public.invoice_snapshots where invoice_id='b5000000-0000-4000-8000-000000000050'),'day','issued snapshot retains agreed billing unit');
select is((select snapshot->'lines'->1->'unit' from public.invoice_snapshots where invoice_id='b5000000-0000-4000-8000-000000000050'),'null'::jsonb,'issued snapshot retains nullable legacy unit');
select throws_ok($$update public.products set unit='month' where id='b5000000-0000-4000-8000-000000000020'$$,'P0001','Product unit is locked by document lines','issued and accepted units remain locked in the catalog');
select is((select snapshot->'lines'->0->>'unit' from public.invoice_snapshots where invoice_id='b5000000-0000-4000-8000-000000000050'),'day','catalog edits cannot rewrite issued billing unit');
select is((select snapshot->'document'->>'totalSatang' from public.invoice_snapshots where invoice_id='b5000000-0000-4000-8000-000000000050'),'353','unit retention preserves exact issued money');
select is(public.issue_invoice('b5000000-0000-4000-8000-000000000010','b5000000-0000-4000-8000-000000000050',(select source_version from public.invoice_snapshots where invoice_id='b5000000-0000-4000-8000-000000000050'),'b5000000-0000-4000-8000-000000000061'),(select issued_snapshot_id from public.invoices where id='b5000000-0000-4000-8000-000000000050'),'issued retry returns the same unit snapshot');
reset role;
set local role anon;
select throws_ok($$select * from public.products$$,'42501',null,'anonymous product access denied');
reset role;
select * from finish();
rollback;
