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

select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'inserting a note advances the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
select public.save_document_lines('invoice',pg_temp.gid(40),jsonb_build_array(pg_temp.note(42,'Transfer to verified account')),'{}');
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'editing a note advances the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
update public.document_sections set kind='section' where id=pg_temp.gid(42);
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'direct section kind edits advance the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
update public.document_sections set lines_before=1 where id=pg_temp.gid(42);
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'moving a section past a priced line advances the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
update public.document_sections set position=1 where id=pg_temp.gid(42);
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'reordering sections advances the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
update public.document_sections set description=description,updated_at=now() where id=pg_temp.gid(42);
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer,'direct content-identical updates do not invalidate invoice review');
delete from public.document_sections where id=pg_temp.gid(42);
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer+1,'deleting a section advances the invoice version');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
select public.save_document_lines('invoice',pg_temp.gid(40),jsonb_build_array(pg_temp.note(42,'Transfer to verified account')),'{}');
select set_config('test.invoice_version',(select version::text from public.invoices where id=pg_temp.gid(40)),true);
select public.save_document_lines('invoice',pg_temp.gid(40),jsonb_build_array(pg_temp.note(42,'Transfer to verified account')),'{}');
select is((select version from public.invoices where id=pg_temp.gid(40)),current_setting('test.invoice_version')::integer,'retrying the same grid content preserves invoice review');
select is((select amount_satang from public.invoices where id=pg_temp.gid(40)),500000::bigint,'text changes preserve priced invoice amounts');
select lives_ok($$select public.issue_invoice(pg_temp.gid(10),pg_temp.gid(40),current_setting('test.invoice_version')::integer,pg_temp.gid(44))$$,'fresh invoice review can issue after a no-op save');
select throws_ok($$update public.document_sections set description='Late instruction' where id=pg_temp.gid(42)$$,
  'P0001','Issued or payment evidence locks invoice lines','issued invoice sections remain frozen');

select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
select is((select approval_snapshot->'sections' from public.purchase_orders where id=pg_temp.gid(50)),
  jsonb_build_array(jsonb_build_object('id',pg_temp.gid(52),'kind','note','description','Prices exclude freight, 30% deposit','lines_before',0,'position',0)),
  'approval captures section identity, content and placement');
update public.document_sections set description='Prices include freight, 50% deposit' where id=pg_temp.gid(52);
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','direct note edits invalidate purchase approval');
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
update public.document_sections set kind='section' where id=pg_temp.gid(52);
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','section kind edits invalidate purchase approval');
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
update public.document_sections set lines_before=1 where id=pg_temp.gid(52);
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','moving a section past a priced line invalidates purchase approval');
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
update public.document_sections set position=1 where id=pg_temp.gid(52);
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','reordering sections invalidates purchase approval');
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
delete from public.document_sections where id=pg_temp.gid(52);
select throws_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'P0001','Owner/admin approval required for current purchase content','section deletion invalidates purchase approval');
select public.save_document_lines('purchase_order',pg_temp.gid(50),jsonb_build_array(pg_temp.note(52,'Agreed deposit')),'{}');
select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(50));
update public.document_sections set description=description,updated_at=now() where id=pg_temp.gid(52);
select public.save_document_lines('purchase_order',pg_temp.gid(50),jsonb_build_array(pg_temp.note(52,'Agreed deposit')),'{}');
select lives_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(50),'confirmed')$$,
  'fresh purchase approval survives content-identical updates and grid retries');

reset role;
insert into public.invoices(id,org_id,client_id,number,amount_satang) values(pg_temp.gid(45),pg_temp.gid(10),pg_temp.gid(20),'DRAFT-HEADER',12345);
insert into public.purchase_orders(id,org_id,vendor_id,number) values
  (pg_temp.gid(60),pg_temp.gid(10),pg_temp.gid(30),'PO-FROZEN-RFQ'),
  (pg_temp.gid(70),pg_temp.gid(10),pg_temp.gid(30),'PO-LEGACY-APPROVAL');
insert into public.purchase_order_items(id,org_id,purchase_order_id,description,quantity,unit_cost_satang) values
  (pg_temp.gid(61),pg_temp.gid(10),pg_temp.gid(60),'RFQ goods',1,500000),
  (pg_temp.gid(71),pg_temp.gid(10),pg_temp.gid(70),'Legacy goods',1,500000);
insert into public.quotes(id,org_id,client_id,number,updated_at) values(pg_temp.gid(80),pg_temp.gid(10),pg_temp.gid(20),'QUOTE-IDENTITY','2000-01-01');
set local role authenticated;
select public.save_document_lines('invoice',pg_temp.gid(45),jsonb_build_array(pg_temp.note(46,'Header-only terms')),'{}');
select is((select jsonb_build_array(amount_satang,subtotal_satang,total_satang,vat_satang,wht_satang) from public.invoices where id=pg_temp.gid(45)),
  '[12345,12345,12345,0,0]'::jsonb,'a text-only edit preserves historical header-only invoice totals');

select public.approve_purchase_order(pg_temp.gid(10),pg_temp.gid(70));
select ok((select not (approval_snapshot ? 'sections') from public.purchase_orders where id=pg_temp.gid(70)),
  'approval content without sections retains the pre-migration shape');
select lives_ok($$select public.transition_purchase_order(pg_temp.gid(10),pg_temp.gid(70),'confirmed')$$,
  'an unchanged purchase with a pre-migration approval still confirms');

select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(
  jsonb_build_object('kind','section','id',pg_temp.gid(62),'description','Frozen heading'),pg_temp.note(63,'Frozen delivery terms')),'{}');
select set_config('test.rfq_claim',public.claim_purchase_rfq(pg_temp.gid(10),pg_temp.gid(60))::text,true);
select is(current_setting('test.rfq_claim')::jsonb->'snapshot'->'sections',
  jsonb_build_array(
    jsonb_build_object('id',pg_temp.gid(62),'kind','section','description','Frozen heading','lines_before',0,'position',0),
    jsonb_build_object('id',pg_temp.gid(63),'kind','note','description','Frozen delivery terms','lines_before',0,'position',1)),
  'RFQ delivery snapshots freeze section content and placement beside priced lines');
select throws_ok($$update public.document_sections set description='Unseen edit' where id=pg_temp.gid(63)$$,
  'P0001','Only draft purchase lines are editable','claimed RFQ notes reject later edits');
select throws_ok($$delete from public.document_sections where id=pg_temp.gid(62)$$,
  'P0001','Only draft purchase lines are editable','claimed RFQ sections reject deletion');
select throws_ok($$select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(pg_temp.note(64,'Late term')),'{}')$$,
  'P0001','Only draft purchase lines are editable','claimed RFQs reject new notes');
select is((select rfq_snapshot from public.purchase_orders where id=pg_temp.gid(60)),current_setting('test.rfq_claim')::jsonb->'snapshot',
  'rejected changes leave the RFQ delivery snapshot unchanged');

select public.save_document_lines('quote',pg_temp.gid(80),jsonb_build_array(pg_temp.note(81,'Draft quote terms')),'{}');
select is((select updated_at from public.quotes where id=pg_temp.gid(80)),now(),'quote notes touch the same parent timestamp as priced lines');
insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang) values(pg_temp.gid(82),pg_temp.gid(10),pg_temp.gid(80),'Quoted work',1,500000);
update public.quotes set status='sent' where id=pg_temp.gid(80);
select lives_ok($$update public.document_sections set description='Reviewed sent terms' where id=pg_temp.gid(81)$$,'sent quote sections remain editable');
update public.quotes set status='accepted' where id=pg_temp.gid(80);
select throws_ok($$update public.document_sections set description='Unseen accepted terms' where id=pg_temp.gid(81)$$,
  'P0001','Agreement lines are frozen','accepted quote sections remain frozen');
select throws_ok($$delete from public.document_sections where id=pg_temp.gid(81)$$,
  'P0001','Agreement lines are frozen','accepted quote sections reject deletion');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(80),jsonb_build_array(pg_temp.note(83,'Late accepted term')),'{}')$$,
  'P0001','Agreement lines are frozen','accepted quotes reject new sections');

select * from finish();
rollback;
