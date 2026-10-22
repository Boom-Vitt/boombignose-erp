begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.qmc_id(n integer) returns uuid language sql immutable as $$
  select ('4c900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.qmc_id(1),'synthetic-qmc-owner@example.invalid',now()),
  (pg_temp.qmc_id(2),'synthetic-qmc-member@example.invalid',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.qmc_id(10),'Synthetic quote metadata','synthetic-quote-metadata'),
  (pg_temp.qmc_id(11),'Synthetic foreign quote metadata','synthetic-quote-metadata-foreign');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.qmc_id(10),pg_temp.qmc_id(1),'owner'),
  (pg_temp.qmc_id(10),pg_temp.qmc_id(2),'member');
insert into public.clients(id,org_id,name) values
  (pg_temp.qmc_id(20),pg_temp.qmc_id(10),'Synthetic quote metadata buyer'),
  (pg_temp.qmc_id(21),pg_temp.qmc_id(11),'Synthetic foreign metadata buyer');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.qmc_id(1))::text,true);
set local role authenticated;
select public.update_tax_business_profile(pg_temp.qmc_id(10),'Synthetic metadata seller','Synthetic address','1234567890123',true,700,false,'Head office');
insert into public.quotes(id,org_id,client_id,number) values
  (pg_temp.qmc_id(30),pg_temp.qmc_id(10),pg_temp.qmc_id(20),'QMC-ACCEPTED'),
  (pg_temp.qmc_id(31),pg_temp.qmc_id(10),pg_temp.qmc_id(20),'QMC-DRAFT');
insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang,tax_rate_bps) values
  (pg_temp.qmc_id(130),pg_temp.qmc_id(10),pg_temp.qmc_id(30),'Accepted taxable service',4,10000,700),
  (pg_temp.qmc_id(131),pg_temp.qmc_id(10),pg_temp.qmc_id(31),'Draft taxable service',2,10000,700);
update public.quotes set status='sent' where id=pg_temp.qmc_id(30);
update public.quotes set status='accepted' where id=pg_temp.qmc_id(30);
select set_config('test.qmc_first',public.convert_accepted_quote(pg_temp.qmc_id(10),pg_temp.qmc_id(30),pg_temp.qmc_id(100),
  jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.qmc_id(130),'quantity',2)))::text,true);
select set_config('test.qmc_second',public.convert_accepted_quote(pg_temp.qmc_id(10),pg_temp.qmc_id(30),pg_temp.qmc_id(101),
  jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.qmc_id(130),'quantity',1)))::text,true);
insert into public.invoices(id,org_id,client_id,number) values
  (pg_temp.qmc_id(40),pg_temp.qmc_id(10),pg_temp.qmc_id(20),'QMC-STANDALONE'),
  (pg_temp.qmc_id(41),pg_temp.qmc_id(10),pg_temp.qmc_id(20),'QMC-ISSUED'),
  (pg_temp.qmc_id(42),pg_temp.qmc_id(10),pg_temp.qmc_id(20),'QMC-LINK-BACKFILL');
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps) values
  (pg_temp.qmc_id(140),pg_temp.qmc_id(10),pg_temp.qmc_id(40),'Standalone taxable service',2,10000,700),
  (pg_temp.qmc_id(141),pg_temp.qmc_id(10),pg_temp.qmc_id(41),'Issued taxable service',1,10000,700),
  (pg_temp.qmc_id(142),pg_temp.qmc_id(10),pg_temp.qmc_id(42),'Linked taxable service',1,10000,700);
select public.issue_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(41),(select version from public.invoices where id=pg_temp.qmc_id(41)),pg_temp.qmc_id(102));
select public.update_tax_business_profile(pg_temp.qmc_id(10),'Synthetic metadata seller','Synthetic address','1234567890123',false,700,false,'Head office');

select lives_ok($$update public.quote_items set position=position+1 where id=pg_temp.qmc_id(131)$$,
  'deregistered seller can reorder an existing taxable draft quote line');
select lives_ok($$update public.invoice_items set position=position+1 where id=pg_temp.qmc_id(140)$$,
  'deregistered seller can reorder an existing taxable draft invoice line');
select throws_ok($$insert into public.quote_items(org_id,quote_id,description,unit_price_satang,tax_rate_bps)
  values(pg_temp.qmc_id(10),pg_temp.qmc_id(31),'New taxable quote scope',10000,700)$$,'P0001','VAT registration required for taxable lines',
  'metadata exemption does not allow a new taxable quote line');
select throws_ok($$insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang,tax_rate_bps)
  values(pg_temp.qmc_id(10),pg_temp.qmc_id(40),'New taxable invoice scope',10000,700)$$,'P0001','VAT registration required for taxable lines',
  'metadata exemption does not allow a new taxable invoice line');
select throws_ok($$update public.quote_items set quantity=3 where id=pg_temp.qmc_id(131)$$,'P0001','VAT registration required for taxable lines',
  'taxable quote quantity changes still require registration');
select throws_ok($$update public.invoice_items set unit_price_satang=10001 where id=pg_temp.qmc_id(140)$$,'P0001','VAT registration required for taxable lines',
  'taxable invoice price changes still require registration');
select throws_ok($$update public.quote_items set description='Changed taxable quote' where id=pg_temp.qmc_id(131)$$,'P0001','VAT registration required for taxable lines',
  'taxable quote description changes still require registration');
select throws_ok($$update public.invoice_items set tax_rate_bps=1000 where id=pg_temp.qmc_id(140)$$,'P0001','VAT registration required for taxable lines',
  'taxable invoice rate changes still require registration');
select throws_ok($$update public.invoice_items set wht_rate_bps=300 where id=pg_temp.qmc_id(140)$$,'P0001','VAT registration required for taxable lines',
  'taxable invoice withholding changes still require registration');
select throws_ok($$update public.quote_items set invoiced_quantity=0 where id=pg_temp.qmc_id(130)$$,'P0001','Invoiced quantity requires the conversion command',
  'VAT metadata exemption retains quote reservation authorization');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.qmc_id(10),current_setting('test.qmc_first')::uuid)$$,
  'explicit quote cancellation releases quantities after VAT deregistration');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.qmc_id(130)),1::numeric,
  'cancellation releases only its reservation and retains the other active invoice');

reset role;
create temp table qmc_cancel_backup as select pg_get_functiondef('public.cancel_quote_invoice(uuid,uuid)'::regprocedure) definition;
create or replace function public.cancel_quote_invoice(p_org_id uuid,p_invoice_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Quote-first cancellation route';
end;
$$;
set local role authenticated;
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),current_setting('test.qmc_second')::uuid)$$,
  'P0001','Quote-first cancellation route','generic source cancellation delegates to the quote-first command');
reset role;
do $$begin execute (select definition from pg_temp.qmc_cancel_backup);end;$$;
set local role authenticated;
select lives_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),current_setting('test.qmc_second')::uuid)$$,
  'generic draft cancellation releases a source reservation after VAT deregistration');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.qmc_id(130)),0::numeric,
  'both cancellation entry points release all reserved quote quantity');
select is((select status::text from public.quotes where id=pg_temp.qmc_id(30)),'accepted',
  'source cancellations retain the accepted quote for future billing');
select lives_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),current_setting('test.qmc_second')::uuid)$$,
  'generic source cancellation remains idempotent');
select is((select count(*) from public.audit_log where org_id=pg_temp.qmc_id(10) and entity='quote' and entity_id=pg_temp.qmc_id(30) and action='invoice_cancelled'),2::bigint,
  'each source cancellation records one quote audit entry');

reset role;
update public.invoices set source_quote_id=pg_temp.qmc_id(30),project_id=(select project_id from public.quotes where id=pg_temp.qmc_id(30))
  where id=pg_temp.qmc_id(42);
select lives_ok($$update public.invoice_items set quote_item_id=pg_temp.qmc_id(130) where id=pg_temp.qmc_id(142)$$,
  'privileged historical quote link backfill retains a taxable line after deregistration');
set local role authenticated;
select throws_ok($$update public.invoice_items set quote_item_id=null where id=pg_temp.qmc_id(142)$$,
  'P0001','Quote line source requires the conversion command','VAT metadata exemption retains quote source authorization');

select lives_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(40))$$,
  'standalone draft cancellation retains its original behavior');
select lives_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(40))$$,
  'standalone draft cancellation retry remains harmless');
select is((select status::text from public.invoices where id=pg_temp.qmc_id(40)),'cancelled','standalone draft is cancelled');
select is((select count(*) from public.audit_log where org_id=pg_temp.qmc_id(10) and entity='invoice' and entity_id=pg_temp.qmc_id(40) and action='invoice_draft_cancelled'),1::bigint,
  'standalone cancellation retains one original invoice audit entry');
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(41))$$,'P0001','Unissued draft required',
  'generic cancellation still rejects an issued standalone invoice');
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(999))$$,'P0001','Unissued draft required',
  'generic cancellation retains unavailable draft validation');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.qmc_id(2))::text,true);
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),pg_temp.qmc_id(40))$$,'P0001','Only staff may cancel drafts',
  'member cannot cancel a standalone draft');
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(10),current_setting('test.qmc_second')::uuid)$$,'P0001','Only staff may cancel drafts',
  'member cannot use generic source cancellation');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.qmc_id(1))::text,true);
select throws_ok($$select public.cancel_draft_invoice(pg_temp.qmc_id(11),pg_temp.qmc_id(42))$$,'P0001','Only staff may cancel drafts',
  'generic cancellation remains scoped to the requested organization');
select ok(has_function_privilege('authenticated','public.cancel_draft_invoice(uuid,uuid)','execute'),
  'authenticated retains access to the guarded cancellation command');
select ok(not has_function_privilege('anon','public.cancel_draft_invoice(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.cancel_draft_invoice(uuid,uuid)','execute'),
  'anonymous and service callers retain no cancellation command grant');

reset role;
select * from finish();
rollback;
