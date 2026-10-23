begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.gid(n integer) returns uuid language sql immutable as $$
  select ('c5c00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
-- The grid's JSON rows for a quote or invoice line; quantity travels as exact decimal text.
create function pg_temp.line(n integer,description text,quantity text,price bigint,rate integer default 700) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind','line','id',pg_temp.gid(n),'product_id',null,'description',description,'quantity',quantity,'unit','piece','unit_price_satang',price,'tax_rate_bps',rate);
$$;
create function pg_temp.text_row(n integer,kind text,description text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind',kind,'id',pg_temp.gid(n),'description',description);
$$;
insert into auth.users(id,email,email_confirmed_at)
  select pg_temp.gid(n),'grid-user-'||n||chr(64)||'line-grid.invalid',now() from generate_series(1,3) n;
insert into public.organizations(id,name,slug) values
  (pg_temp.gid(10),'Line grid test','line-grid-test'),
  (pg_temp.gid(11),'Other line grid test','other-line-grid-test');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.gid(10),pg_temp.gid(1),'owner'),
  (pg_temp.gid(10),pg_temp.gid(2),'member'),
  (pg_temp.gid(11),pg_temp.gid(3),'owner');
insert into public.clients(id,org_id,name) values (pg_temp.gid(20),pg_temp.gid(10),'Grid buyer'),(pg_temp.gid(21),pg_temp.gid(11),'Other buyer');
insert into public.quotes(id,org_id,client_id,number,discount_satang) values
  (pg_temp.gid(30),pg_temp.gid(10),pg_temp.gid(20),'GRID-Q1',1000),
  (pg_temp.gid(31),pg_temp.gid(10),pg_temp.gid(20),'GRID-Q2',0),
  (pg_temp.gid(32),pg_temp.gid(11),pg_temp.gid(21),'OTHER-Q1',0);
insert into public.invoices(id,org_id,client_id,number,discount_satang,wht_rate_bps) values
  (pg_temp.gid(40),pg_temp.gid(10),pg_temp.gid(20),'DRAFT-GRID-I1',1000,300),
  (pg_temp.gid(41),pg_temp.gid(10),pg_temp.gid(20),'DRAFT-GRID-I2',0,0);
insert into public.vendors(id,org_id,name) values (pg_temp.gid(50),pg_temp.gid(10),'Grid supplier');
insert into public.purchase_orders(id,org_id,number,vendor_id) values (pg_temp.gid(60),pg_temp.gid(10),'PO-GRID-1',pg_temp.gid(50));

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.document_sections'::regclass),'section RLS is forced');
select ok((select not prosecdef from pg_proc where oid='public.save_document_lines(text,uuid,jsonb,uuid[])'::regprocedure),'save runs as the caller so RLS and line guards apply');
select ok(not has_function_privilege('anon','public.save_document_lines(text,uuid,jsonb,uuid[])','execute'),'anonymous callers cannot save lines');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(1))::text,true);
set local role authenticated;
select public.update_tax_business_profile(pg_temp.gid(10),'Grid seller','Grid address','1234567890123',true,700,false,'Head office');

-- Totals parity: the same rows and expectations as lib/line-grid/grid.test.ts.
select lives_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.line(100,'Design','1.5',33333),pg_temp.text_row(101,'section','Materials'),
  pg_temp.line(102,'Boards','2',10000,0),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(104,'note','Delivered on site')),'{}')$$,
  'owner saves lines, a section and a note in one call');
select is((select jsonb_agg(jsonb_build_array(description,position,amount_satang) order by position) from public.quote_items where quote_id=pg_temp.gid(30)),
  '[["Design",0,50000],["Boards",1,20000],["Glue",2,33]]'::jsonb,'lines keep grid order and the guard computes amounts');
select is((select jsonb_agg(jsonb_build_array(kind,description,lines_before,position) order by position) from public.document_sections where quote_id=pg_temp.gid(30)),
  '[["section","Materials",1,0],["note","Delivered on site",3,1]]'::jsonb,'sections record the priced lines above them');
select is((select jsonb_build_array(subtotal_satang,vat_satang,total_satang) from public.quotes where id=pg_temp.gid(30)),'[70033,3452,72485]'::jsonb,'quote totals match the grid preview (exclusive VAT, discount 10.00)');
select is((select tax_breakdown from public.quotes where id=pg_temp.gid(30)),'[{"rateBps":0,"vatSatang":0,"baseSatang":19714},{"rateBps":700,"vatSatang":3452,"baseSatang":49319}]'::jsonb,'quote VAT breakdown matches the grid preview');

select lives_ok($$select public.save_document_lines('invoice',pg_temp.gid(40),jsonb_build_array(
  pg_temp.line(110,'Design','1.5',33333),pg_temp.line(111,'Boards','2',10000,0),pg_temp.line(112,'Glue','0.333',99)),'{}')$$,'owner saves invoice lines');
select is((select jsonb_build_array(subtotal_satang,vat_satang,total_satang,wht_satang,amount_satang) from public.invoices where id=pg_temp.gid(40)),'[70033,3452,72485,2071,70414]'::jsonb,'invoice totals and WHT 3% match the grid preview');

select lives_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.text_row(104,'note','Delivered on site'),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(101,'section','Materials'),
  pg_temp.line(102,'Boards','2',10000,0),pg_temp.line(100,'Design','1.5',33333)),'{}')$$,'reordered rows save');
select is((select jsonb_agg(jsonb_build_array(id,position) order by position) from public.quote_items where quote_id=pg_temp.gid(30)),
  jsonb_build_array(jsonb_build_array(pg_temp.gid(103),0),jsonb_build_array(pg_temp.gid(102),1),jsonb_build_array(pg_temp.gid(100),2)),'reorder keeps line ids and renumbers positions');
select is((select jsonb_agg(jsonb_build_array(description,lines_before,position) order by position) from public.document_sections where quote_id=pg_temp.gid(30)),
  '[["Delivered on site",0,0],["Materials",1,1]]'::jsonb,'reorder moves sections with their rows');

select lives_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.text_row(104,'note','Delivered on site'),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(101,'section','Materials'),
  pg_temp.line(102,'Boards','2',10000,0),pg_temp.line(100,'Design','1.5',33333)),'{}')$$,'retrying the same save succeeds');
select is((select count(*)::int from public.quote_items where quote_id=pg_temp.gid(30))+(select count(*)::int from public.document_sections where quote_id=pg_temp.gid(30)),5,'a retried save converges instead of duplicating rows');

reset role;
insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang) values (pg_temp.gid(105),pg_temp.gid(10),pg_temp.gid(30),'Added elsewhere',1,500);
set local role authenticated;
select lives_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.line(100,'Design work','1.5',33333),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(101,'section','Materials')),array[pg_temp.gid(102),pg_temp.gid(104)])$$,
  'edits and deletions save together');
select is((select jsonb_agg(jsonb_build_array(description,position) order by position) from public.quote_items where quote_id=pg_temp.gid(30)),
  '[["Design work",0],["Glue",1],["Added elsewhere",2]]'::jsonb,'deleted lines go, edits apply, and a line saved elsewhere meanwhile follows the grid rows');
select is((select jsonb_agg(description) from public.document_sections where quote_id=pg_temp.gid(30)),'["Materials"]'::jsonb,'deleted sections go');

select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(pg_temp.line(100,'Design work','2',33333),pg_temp.line(106,'Broken','0',100)),'{}')$$,
  'P0001','Invalid line','an invalid line rejects the whole save');
select is((select quantity from public.quote_items where id=pg_temp.gid(100)),1.5::numeric,'the valid edit in a rejected save is rolled back');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(31),jsonb_build_array(pg_temp.line(100,'Stolen','1',1)),'{}')$$,
  '23505',null,'a line id from another document cannot be moved into this one');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(31),jsonb_build_array(pg_temp.line(120,'Twice','1',1),pg_temp.line(120,'Twice','1',1)),'{}')$$,
  'P0001','Invalid line rows','duplicate row ids are rejected');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(31),jsonb_build_array(jsonb_build_object('kind','total','id',pg_temp.gid(121),'description','x')),'{}')$$,
  'P0001','Invalid line rows','unknown row kinds are rejected');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(31),jsonb_build_array(pg_temp.text_row(122,'section','  ')),'{}')$$,
  '23514',null,'blank section text is rejected');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(32),jsonb_build_array(pg_temp.line(123,'Cross tenant','1',1)),'{}')$$,
  'P0001','Document unavailable','another workspace''s quote is invisible');
select throws_ok($$select public.save_document_lines('ledger',pg_temp.gid(31),'[]','{}')$$,'P0001','Unknown document','only quote, invoice and purchase order lines save');

update public.quotes set status='sent' where id=pg_temp.gid(30);
select lives_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.line(100,'Design work','1.5',33333),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(101,'section','Materials (sent)')),'{}')$$,'sent quotes stay editable');
update public.quotes set status='accepted' where id=pg_temp.gid(30);
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(30),jsonb_build_array(
  pg_temp.line(100,'Design work','1.5',33333),pg_temp.line(103,'Glue','0.333',99),pg_temp.text_row(101,'section','Changed after acceptance')),'{}')$$,
  'P0001','Agreement lines are frozen','accepted quote sections are frozen with its lines');
select throws_ok($$delete from public.document_sections where id=pg_temp.gid(101)$$,'P0001','Agreement lines are frozen','accepted quote sections cannot be deleted');
select throws_ok($$insert into public.document_sections(org_id,quote_id,kind,description,lines_before,position) values(pg_temp.gid(10),pg_temp.gid(30),'note','Late note',0,9)$$,
  'P0001','Agreement lines are frozen','accepted quotes take no new sections');
select throws_ok($$update public.document_sections set quote_id=null,invoice_id=pg_temp.gid(41) where id=pg_temp.gid(101)$$,'P0001','Line reassignment forbidden','sections cannot move between documents');

select lives_ok($$select public.save_document_lines('invoice',pg_temp.gid(41),jsonb_build_array(pg_temp.line(130,'Issued service','1',10000),pg_temp.text_row(131,'section','Phase 1')),'{}')$$,'draft invoice takes lines and sections');
select lives_ok($$select public.issue_invoice(pg_temp.gid(10),pg_temp.gid(41),(select version from public.invoices where id=pg_temp.gid(41)),pg_temp.gid(132))$$,'the invoice issues');
select throws_ok($$select public.save_document_lines('invoice',pg_temp.gid(41),jsonb_build_array(pg_temp.line(130,'Issued service','1',10000),pg_temp.text_row(131,'section','Rewritten')),'{}')$$,
  'P0001','Issued or payment evidence locks invoice lines','issued invoice sections are frozen');

select public.update_tax_business_profile(pg_temp.gid(10),'Grid seller','Grid address','1234567890123',false,700,false,'Head office');
select throws_ok($$select public.save_document_lines('quote',pg_temp.gid(31),jsonb_build_array(pg_temp.line(140,'Taxed','1',100,700)),'{}')$$,
  'P0001','VAT registration required for taxable lines','existing VAT registration guard still applies through the save');
select public.update_tax_business_profile(pg_temp.gid(10),'Grid seller','Grid address','1234567890123',true,700,false,'Head office');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(2))::text,true);
set local role authenticated;
select throws_ok($$select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(jsonb_build_object('kind','line','id',pg_temp.gid(150),'product_id',null,'description','Member line','quantity','1','unit','piece','unit_price_satang',100)),'{}')$$,
  'P0001','Only owners and admins may manage purchases','members cannot write purchase lines');
select throws_ok($$insert into public.document_sections(org_id,purchase_order_id,kind,description,lines_before,position) values(pg_temp.gid(10),pg_temp.gid(60),'note','Member note',0,0)$$,
  '42501',null,'members cannot write purchase sections');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.gid(1))::text,true);
set local role authenticated;
select lives_ok($$select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(
  jsonb_build_object('kind','line','id',pg_temp.gid(151),'product_id',null,'description','Steel','quantity','4','unit','kg','unit_price_satang',1234),
  pg_temp.text_row(152,'section','Fasteners'),
  jsonb_build_object('kind','line','id',pg_temp.gid(153),'product_id',null,'description','Bolts','quantity','10','unit','piece','unit_price_satang',5)),'{}')$$,'owner saves purchase lines');
select lives_ok($$select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(
  jsonb_build_object('kind','line','id',pg_temp.gid(153),'product_id',null,'description','Bolts','quantity','12','unit','piece','unit_price_satang',5),
  pg_temp.text_row(152,'section','Fasteners'),
  jsonb_build_object('kind','line','id',pg_temp.gid(151),'product_id',null,'description','Steel','quantity','4','unit','kg','unit_price_satang',1234)),'{}')$$,'draft purchase lines update and reorder in place');
select is((select jsonb_agg(jsonb_build_array(id,description,quantity,position) order by position) from public.purchase_order_items where purchase_order_id=pg_temp.gid(60)),
  jsonb_build_array(jsonb_build_array(pg_temp.gid(153),'Bolts',12.000,0),jsonb_build_array(pg_temp.gid(151),'Steel',4.000,1)),'purchase lines keep ids, take edits and new order');
select throws_ok($$update public.purchase_order_items set received_quantity=1 where id=pg_temp.gid(151)$$,'42501',null,'receipt quantities stay command-only');
reset role;
update public.purchase_orders set status='sent' where id=pg_temp.gid(60);
set local role authenticated;
select throws_ok($$select public.save_document_lines('purchase_order',pg_temp.gid(60),jsonb_build_array(
  jsonb_build_object('kind','line','id',pg_temp.gid(153),'product_id',null,'description','Bolts','quantity','99','unit','piece','unit_price_satang',5)),'{}')$$,
  'P0001','Only draft purchase lines are editable','sent purchase lines are frozen');
select throws_ok($$update public.document_sections set description='Changed' where id=pg_temp.gid(152)$$,'P0001','Only draft purchase lines are editable','sent purchase sections are frozen');

select * from finish();
rollback;
