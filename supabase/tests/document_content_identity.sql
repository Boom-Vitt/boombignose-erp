begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.gid(n integer) returns uuid language sql immutable as $$
  select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.note(n integer,description text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind','note','id',pg_temp.gid(n),'description',description);
$$;
insert into auth.users(id,email,email_confirmed_at)
  select pg_temp.gid(n),'identity-'||n||'@example.invalid',now() from generate_series(1,2) n;
insert into public.organizations(id,name,slug) values(pg_temp.gid(10),'Document identity','document-identity');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.gid(10),pg_temp.gid(1),'owner'),(pg_temp.gid(10),pg_temp.gid(2),'admin');
insert into public.clients(id,org_id,name) values(pg_temp.gid(20),pg_temp.gid(10),'Buyer');
insert into public.vendors(id,org_id,name,email) values(pg_temp.gid(30),pg_temp.gid(10),'Supplier','supplier@example.invalid');
insert into public.invoices(id,org_id,client_id,number) values(pg_temp.gid(40),pg_temp.gid(10),pg_temp.gid(20),'DRAFT-IDENTITY');
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang)
  values(pg_temp.gid(41),pg_temp.gid(10),pg_temp.gid(40),'Work',1,500000);
insert into public.purchase_orders(id,org_id,vendor_id,number) values(pg_temp.gid(50),pg_temp.gid(10),pg_temp.gid(30),'PO-IDENTITY');
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang)
  values(pg_temp.gid(51),pg_temp.gid(10),pg_temp.gid(50),'Goods',1,500000);
insert into public.org_settings(org_id,purchase_approval_threshold_satang) values(pg_temp.gid(10),100000);

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(1))::text,true);
set local role authenticated;
select public.update_business_profile(pg_temp.gid(10),'Seller','Address',null,'unknown');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(2))::text,true);
select public.save_document_lines('invoice',pg_temp.gid(40),jsonb_build_array(pg_temp.note(42,'Transfer to account X')),'{}');
select public.save_document_lines('purchase_order',pg_temp.gid(50),jsonb_build_array(pg_temp.note(52,'Prices exclude freight, 30% deposit')),'{}');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(1))::text,true);
select throws_ok($$select public.issue_invoice(pg_temp.gid(10),pg_temp.gid(40),current_setting('test.invoice_version')::integer,pg_temp.gid(43))$$,
  'P0001','Draft at expected version required','invoice issue rejects a version read before another editor saved a grid note');
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','purchase confirmation rejects approval from before another editor saved a grid note');

select * from finish();
rollback;
