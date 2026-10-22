begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.w4c_id(n integer) returns uuid language sql immutable as $$
  select ('4c000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.w4c_id(1),'synthetic-w4c-owner@example.invalid',now()),
  (pg_temp.w4c_id(2),'synthetic-w4c-member@example.invalid',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.w4c_id(10),'Synthetic W4c workspace','synthetic-w4c'),
  (pg_temp.w4c_id(11),'Synthetic W4c other workspace','synthetic-w4c-other');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.w4c_id(10),pg_temp.w4c_id(1),'owner'),
  (pg_temp.w4c_id(10),pg_temp.w4c_id(2),'member');
insert into public.clients(id,org_id,name,portal_enabled,portal_token) values
  (pg_temp.w4c_id(20),pg_temp.w4c_id(10),'Synthetic W4c buyer',true,repeat('4c',32)),
  (pg_temp.w4c_id(21),pg_temp.w4c_id(10),'Synthetic W4c other buyer',false,null),
  (pg_temp.w4c_id(22),pg_temp.w4c_id(11),'Synthetic W4c foreign buyer',true,repeat('5d',32));

create function pg_temp.w4c_quote(n integer,qty numeric,price bigint,rate integer default 0,discount bigint default 0,accept_it boolean default true,p_valid date default null)
returns uuid language plpgsql as $$
declare q uuid:=pg_temp.w4c_id(n);
begin
  insert into public.quotes(id,org_id,client_id,number,discount_satang,valid_until)
    values(q,pg_temp.w4c_id(10),pg_temp.w4c_id(20),'W4C-'||n,discount,p_valid);
  insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang,tax_rate_bps)
    values(pg_temp.w4c_id(n+1000),pg_temp.w4c_id(10),q,'Synthetic quoted work',qty,price,rate);
  update public.quotes set status='sent' where id=q;
  if accept_it then update public.quotes set status='accepted' where id=q;end if;
  return q;
end;
$$;

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.w4c_id(1))::text,true);
set local role authenticated;

select public.update_tax_business_profile(pg_temp.w4c_id(10),'Synthetic W4c seller','Synthetic address','1234567890123',true,700,false,'Head office');
select pg_temp.w4c_quote(100,2,10000,0,0,false);
select pg_temp.w4c_quote(101,1,10000,0,0,false,(now() at time zone 'Asia/Bangkok')::date-1);
select throws_ok($$update public.quotes set status='accepted' where id=pg_temp.w4c_id(101)$$,'P0001','Quote expired','expired sent quote cannot be accepted');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.w4c_id(2))::text,true);
select throws_ok($$update public.quotes set status='accepted' where id=pg_temp.w4c_id(100)$$,'P0001','Only staff may accept quotes','member cannot accept through a direct database update');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.w4c_id(1))::text,true);
update public.quotes set status='accepted' where id=pg_temp.w4c_id(100);
select ok((select accepted_at is not null from public.quotes where id=pg_temp.w4c_id(100)),'staff acceptance records its timestamp');

reset role;
set constraints all immediate;
alter table public.quotes disable trigger guard_quote_record;
update public.quotes set valid_until=(now() at time zone 'Asia/Bangkok')::date-1,accepted_at=now()-interval '2 days' where id=pg_temp.w4c_id(100);
alter table public.quotes enable trigger guard_quote_record;
set constraints all deferred;
set local role authenticated;
select lives_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(100),pg_temp.w4c_id(200))$$,'an agreement accepted before expiry can convert after expiry');
select is((select count(*) from public.invoices where source_quote_id=pg_temp.w4c_id(100)),1::bigint,'late conversion creates one linked invoice');
select ok((select number like 'DRAFT-%' from public.invoices where source_quote_id=pg_temp.w4c_id(100)),'converted draft uses an unnumbered reference outside the issued series');
select is(public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(100),pg_temp.w4c_id(200)),(select converted_invoice_id from public.quotes where id=pg_temp.w4c_id(100)),'same conversion key replays the original invoice');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),(select converted_invoice_id from public.quotes where id=pg_temp.w4c_id(100)))$$,'cancelling a late-converted draft does not recheck acceptance expiry');
select is((select accepted_at from public.quotes where id=pg_temp.w4c_id(100)),now()-interval '2 days','cancellation preserves the original acceptance timestamp');

select pg_temp.w4c_quote(102,10,1000);
select set_config('test.w4c_partial',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(102),pg_temp.w4c_id(201),jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1102),'quantity',3)))::text,true);
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1102)),3::numeric,'partial invoice reserves only its requested quantity');
select is((select amount_satang from public.invoices where id=current_setting('test.w4c_partial')::uuid),3000::bigint,'partial invoice charges only its requested quantity');
select is((select quote_item_id from public.invoice_items where invoice_id=current_setting('test.w4c_partial')::uuid),pg_temp.w4c_id(1102),'invoice line retains its source quote line');
select throws_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(102),pg_temp.w4c_id(202),jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1102),'quantity',8)))$$,'P0001','Quantity exceeds unbilled quote line','aggregate reservation cannot exceed the accepted line quantity');
select throws_ok($$update public.quote_items set invoiced_quantity=0 where id=pg_temp.w4c_id(1102)$$,'P0001',null,'cached invoiced quantity cannot be forged directly');
select throws_ok($$update public.invoice_items set quantity=1 where invoice_id=current_setting('test.w4c_partial')::uuid$$,'P0001',null,'sealed quote invoice lines cannot be changed');
select throws_ok($$update public.invoices set quote_invoice_sealed=false where id=current_setting('test.w4c_partial')::uuid$$,'P0001',null,'ordinary caller cannot unseal a source invoice');
select throws_ok($$update public.invoices set status='cancelled' where id=current_setting('test.w4c_partial')::uuid$$,'P0001','Invoice status changes require a command','source cancellation cannot invert the quote-first command lock order');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_partial')::uuid)$$,'cancelling a source draft is an explicit command');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1102)),0::numeric,'cancelled draft releases its reserved quote quantity');
select ok((select status in ('accepted','converted') from public.quotes where id=pg_temp.w4c_id(102)),'draft cancellation preserves the accepted agreement');
select throws_ok($$update public.invoices set status='draft' where id=current_setting('test.w4c_partial')::uuid$$,'P0001','Cancelled draft is final','cancelled invoice cannot reclaim released quantities');
select set_config('test.w4c_remainder',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(102),pg_temp.w4c_id(203))::text,true);
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1102)),10::numeric,'a new command bills the released remainder');
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(102) and status<>'cancelled'),10000::numeric,'noncancelled invoices cannot double charge the quote');
select is((select count(*) from public.projects where source_quote_id=pg_temp.w4c_id(102)),1::bigint,'multiple conversions retain one source project');
select is(public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(102),pg_temp.w4c_id(239)),current_setting('test.w4c_remainder')::uuid,'alternate default key reuses an already-complete quote invoice');
select is((select count(*) from public.invoices where source_quote_id=pg_temp.w4c_id(102) and status<>'cancelled'),1::bigint,'alternate default key does not create another completed invoice');

select pg_temp.w4c_quote(120,5,1000,0,0,false);
insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang)
  values(pg_temp.w4c_id(1121),pg_temp.w4c_id(10),pg_temp.w4c_id(120),'Unbilled second quote line',2,2000);
update public.quotes set status='accepted' where id=pg_temp.w4c_id(120);
select set_config('test.w4c_two_line_partial',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(120),pg_temp.w4c_id(230),
  jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1120),'quantity',2)))::text,true);
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1120)),2::numeric,'two-line quote reserves its selected line');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1121)),0::numeric,'two-line quote leaves its other line unbilled');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_two_line_partial')::uuid)$$,
  'cancellation releases a billed line without rewriting the untouched zero counter');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1120)),0::numeric,'two-line cancellation clears its changed counter');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1121)),0::numeric,'two-line cancellation preserves its unchanged zero counter');
select lives_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(120),pg_temp.w4c_id(231))$$,
  'both lines remain billable after partial cancellation');
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(120) and status<>'cancelled'),9000::numeric,
  'rebilling both released lines produces their accepted total');

select pg_temp.w4c_quote(103,10,1000,700);
select set_config('test.w4c_deposit',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(103),pg_temp.w4c_id(204),null,null,2500)::text,true);
select is((select quote_invoice_kind from public.invoices where id=current_setting('test.w4c_deposit')::uuid),'deposit','percentage command creates a deposit invoice');
select is((select quote_deposit_satang from public.invoices where id=current_setting('test.w4c_deposit')::uuid),2500::bigint,'percentage deposit stores its pretax base');
select is((select total_satang from public.invoices where id=current_setting('test.w4c_deposit')::uuid),2675::bigint,'deposit carries its accepted tax rate');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1103)),0::numeric,'deposit does not consume delivery quantity');
select set_config('test.w4c_final',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(103),pg_temp.w4c_id(205))::text,true);
select is((select quote_deposit_deduction_satang from public.invoices where id=current_setting('test.w4c_final')::uuid),2500::bigint,'final invoice deducts the deposit base exactly once');
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(103) and status<>'cancelled'),10700::numeric,'deposit plus final invoice equals the quote gross total');
select throws_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_deposit')::uuid)$$,'P0001',null,'a deposit applied to an active final invoice cannot be cancelled');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_final')::uuid)$$,'cancelling the final invoice releases its deposit application');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_deposit')::uuid)$$,'released unapplied deposit can be cancelled');

select pg_temp.w4c_quote(130,10,1000,700,1000);
select set_config('test.w4c_cycle_deposit',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(130),pg_temp.w4c_id(232),null,null,2500)::text,true);
select set_config('test.w4c_cycle_partial',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(130),pg_temp.w4c_id(233),
  jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1130),'quantity',4)))::text,true);
select set_config('test.w4c_cycle_final',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(130),pg_temp.w4c_id(234))::text,true);
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(130) and status<>'cancelled'),9631::numeric,
  'discounted deposit and split invoices preserve independent VAT rounding');
select is((select quote_deposit_deduction_satang from public.invoices where id=current_setting('test.w4c_cycle_final')::uuid),2250::bigint,
  'the original final applies the deposit once');
select lives_ok($$select public.cancel_quote_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_cycle_partial')::uuid)$$,
  'an earlier draft partial can be cancelled while the final stays active');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1130)),6::numeric,
  'cancelling the earlier partial releases only its own quantity');
select set_config('test.w4c_cycle_rebill',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(130),pg_temp.w4c_id(235))::text,true);
select is((select quote_deposit_deduction_satang from public.invoices where id=current_setting('test.w4c_cycle_rebill')::uuid),0::bigint,
  'rebilling released quantity does not deduct an already-applied deposit');
select is((select sum(quote_deposit_deduction_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(130) and status<>'cancelled'),2250::numeric,
  'active invoices still deduct the deposit exactly once after rebilling');
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(130) and status<>'cancelled'),9631::numeric,
  'rebilling preserves independent VAT rounding and one deposit deduction');
select is((select invoiced_quantity from public.quote_items where id=pg_temp.w4c_id(1130)),10::numeric,
  'replacement invoice restores exactly the accepted line quantity');

select pg_temp.w4c_quote(104,1,100,700);
select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(104),pg_temp.w4c_id(206),null,50,null);
select set_config('test.w4c_round_final',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(104),pg_temp.w4c_id(207))::text,true);
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(104) and status<>'cancelled'),108::numeric,'deposit and final each round their own VAT without forcing the quote gross');
select lives_ok($$select public.issue_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_round_final')::uuid,(select version from public.invoices where id=current_setting('test.w4c_round_final')::uuid),pg_temp.w4c_id(211))$$,'independently rounded final remains compatible with the existing issue command');
select throws_ok($$update public.invoice_items set quantity=2 where invoice_id=current_setting('test.w4c_round_final')::uuid$$,'P0001',null,'issued source invoice retains line evidence protection');
select throws_ok($$update public.invoices set wht_rate_bps=300 where id=current_setting('test.w4c_round_final')::uuid$$,'P0001',null,'issued source invoice retains tax evidence protection');

select pg_temp.w4c_quote(140,2,10005,700);
select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(140),pg_temp.w4c_id(440),jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1140),'quantity',1)));
select set_config('test.w4c_vat_final',public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(140),pg_temp.w4c_id(441))::text,true);
select is((select sum(total_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(140)),21410::numeric,'partial invoices keep independently rounded gross');
select is((select sum(vat_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(140)),1400::numeric,'each exclusive invoice rounds VAT on its own base');
select is((select sum((b->>'baseSatang')::numeric) from public.invoices i cross join jsonb_array_elements(i.tax_breakdown) b where i.source_quote_id=pg_temp.w4c_id(140) and (b->>'rateBps')::int=700),20010::numeric,'exclusive partial invoices preserve accepted taxable base');
select is((select count(*) from public.invoice_items l join public.invoices i on i.id=l.invoice_id where i.source_quote_id=pg_temp.w4c_id(140) and l.tax_rate_bps=0),0::bigint,'VAT rounding does not add a zero-rated revenue line');
select lives_ok($$select public.issue_invoice(pg_temp.w4c_id(10),current_setting('test.w4c_vat_final')::uuid,(select version from public.invoices where id=current_setting('test.w4c_vat_final')::uuid),pg_temp.w4c_id(442))$$,'independently rounded final remains issuable');

select public.update_tax_business_profile(pg_temp.w4c_id(10),'Synthetic W4c seller','Synthetic address','1234567890123',true,700,true,'Head office');
select pg_temp.w4c_quote(141,2,10705,700);
select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(141),pg_temp.w4c_id(443),jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1141),'quantity',1)));
select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(141),pg_temp.w4c_id(444));
select is((select sum(vat_satang) from public.invoices where source_quote_id=pg_temp.w4c_id(141)),1400::numeric,'each inclusive invoice extracts VAT from its own total');
select is((select sum((b->>'baseSatang')::numeric) from public.invoices i cross join jsonb_array_elements(i.tax_breakdown) b where i.source_quote_id=pg_temp.w4c_id(141) and (b->>'rateBps')::int=700),20010::numeric,'inclusive invoices preserve their independently computed taxable base');
select public.update_tax_business_profile(pg_temp.w4c_id(10),'Synthetic W4c seller','Synthetic address','1234567890123',true,700,false,'Head office');

select pg_temp.w4c_quote(105,1,10000,0,0,false);
insert into public.quote_items(org_id,quote_id,description,quantity,unit_price_satang,tax_rate_bps,position)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(105),'Different tax bucket',1,10000,700,1);
update public.quotes set status='accepted' where id=pg_temp.w4c_id(105);
select throws_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(105),pg_temp.w4c_id(208),null,1000,null)$$,'P0001','Deposits require one tax rate','mixed-rate deposit fails explicitly rather than misallocating tax');
reset role;
select is((select count(*) from public.quote_conversion_requests where org_id=pg_temp.w4c_id(10) and key=pg_temp.w4c_id(208)),0::bigint,'rejected deposit rolls back its idempotency claim');
set local role authenticated;
select throws_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(11),pg_temp.w4c_id(102),pg_temp.w4c_id(209))$$,'P0001',null,'owner cannot bill another workspace');
select throws_ok($$select public.convert_accepted_quote(pg_temp.w4c_id(10),pg_temp.w4c_id(105),pg_temp.w4c_id(210),jsonb_build_array(jsonb_build_object('quote_item_id',pg_temp.w4c_id(1102),'quantity',1)))$$,'P0001',null,'invoice command rejects a line from another quote');

select pg_temp.w4c_quote(106,1,10000,0,0,false);
select throws_ok($$select public.accept_portal_quote(repeat('4c',32),pg_temp.w4c_id(106),'Synthetic signer','signer@example.invalid')$$,'42501',null,'authenticated caller cannot invoke the service-only portal boundary');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.accept_portal_quote(repeat('4c',32),pg_temp.w4c_id(106),'Synthetic signer','signer@example.invalid')$$,'portal resolves its token and accepts its own quote');
select is((select accepted_by_name from public.quotes where id=pg_temp.w4c_id(106)),'Synthetic signer','portal stores the accepting name');
select is((select accepted_by_email from public.quotes where id=pg_temp.w4c_id(106)),'signer@example.invalid','portal stores the accepting email');
select ok((select accepted_at is not null from public.quotes where id=pg_temp.w4c_id(106)),'portal stores acceptance time');
select ok(exists(select 1 from public.audit_log where org_id=pg_temp.w4c_id(10) and entity='quote' and entity_id=pg_temp.w4c_id(106) and action like '%accept%'),'portal acceptance writes trusted audit evidence');
select throws_ok($$select public.accept_portal_quote(repeat('5d',32),pg_temp.w4c_id(101),'Synthetic signer','signer@example.invalid')$$,'P0001',null,'portal token cannot accept another client workspace quote');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.w4c_id(1))::text,true);
set local role authenticated;

select set_config('test.w4c_number1',public.reserve_document_number(pg_temp.w4c_id(10),'quote',2098),true);
select set_config('test.w4c_number2',public.reserve_document_number(pg_temp.w4c_id(10),'quote',2098),true);
select isnt(current_setting('test.w4c_number1'),current_setting('test.w4c_number2'),'counter reservations return distinct quote numbers');
select throws_ok($$select public.reserve_document_number(pg_temp.w4c_id(11),'quote',2098)$$,'P0001',null,'document counter cannot reserve numbers in another workspace');

select pg_temp.w4c_quote(107,1,1000,0,0,false);
update public.quote_items set position=7 where quote_id=pg_temp.w4c_id(107);
insert into public.quote_items(id,org_id,quote_id,description,quantity,unit_price_satang,position)
  values(pg_temp.w4c_id(1108),pg_temp.w4c_id(10),pg_temp.w4c_id(107),'Appended quote work',1,1000,0);
select is((select position from public.quote_items where id=pg_temp.w4c_id(1108)),8,'quote append uses max position rather than line count');
insert into public.invoices(id,org_id,client_id,number) values(pg_temp.w4c_id(400),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'W4C-ORDINARY-DRAFT');
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang)
  values(pg_temp.w4c_id(401),pg_temp.w4c_id(10),pg_temp.w4c_id(400),'Ordinary invoice line',1,1000);
update public.invoice_items set position=9 where id=pg_temp.w4c_id(401);
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang,position)
  values(pg_temp.w4c_id(402),pg_temp.w4c_id(10),pg_temp.w4c_id(400),'Appended invoice work',1,1000,0);
select is((select position from public.invoice_items where id=pg_temp.w4c_id(402)),10,'invoice append uses max position rather than line count');
select throws_ok($$insert into public.invoice_items(org_id,invoice_id,quote_item_id,description,quantity,unit_price_satang)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(400),pg_temp.w4c_id(1102),'Forged quote source',1,1000)$$,
  'P0001','Quote line source requires the conversion command','ordinary invoice cannot gain a quote source through a direct insert');
select throws_ok($$update public.invoice_items set quote_item_id=pg_temp.w4c_id(1102) where id=pg_temp.w4c_id(401)$$,
  'P0001','Quote line source requires the conversion command','ordinary invoice cannot gain a quote source through a direct update');
select lives_ok($$select public.issue_invoice(pg_temp.w4c_id(10),pg_temp.w4c_id(400),(select version from public.invoices where id=pg_temp.w4c_id(400)),pg_temp.w4c_id(212))$$,'ordinary draft issue path still works');
select throws_ok($$update public.invoice_items set quantity=2 where id=pg_temp.w4c_id(401)$$,'P0001','Issued or payment evidence locks invoice lines','unrelated issued invoice line guard remains intact');
select throws_ok($$update public.invoices set total_satang=1 where id=pg_temp.w4c_id(400)$$,'P0001','Issued tax content is frozen','unrelated issued invoice tax guard remains intact');

reset role;
insert into public.invoices(id,org_id,client_id,number,source_quote_id)
  values(pg_temp.w4c_id(403),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'W4C-TRUSTED-SOURCE-FIXTURE',pg_temp.w4c_id(105));
select throws_ok($$insert into public.invoice_items(org_id,invoice_id,quote_item_id,description,quantity,unit_price_satang)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(403),pg_temp.w4c_id(1102),'Wrong quote in trusted command',1,1000)$$,
  'P0001','Invoice and quote line source must match','trusted command cannot attach a line from another quote');
select lives_ok($$insert into public.invoice_items(org_id,invoice_id,quote_item_id,description,quantity,unit_price_satang)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(403),pg_temp.w4c_id(1105),'Correct quote in trusted command',1,10000)$$,
  'trusted command can attach its own quote line');
set local role authenticated;

insert into public.subscriptions(id,org_id,client_id,name,amount_satang,interval,start_date,next_run_date,tax_rate_bps,wht_rate_bps)
  values(pg_temp.w4c_id(300),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic W4c subscription',10000,'weekly',(now() at time zone 'Asia/Bangkok')::date-21,(now() at time zone 'Asia/Bangkok')::date-21,700,300);
select lives_ok($$select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(300),(now() at time zone 'Asia/Bangkok')::date-14)$$,'unbilled subscription can change its anchor');
select is((select next_run_date from public.subscriptions where id=pg_temp.w4c_id(300)),(now() at time zone 'Asia/Bangkok')::date-14,'changing start date also resets the initial next run date');
select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(300),null,'paused');
select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(300),null,'active');
select is((select next_run_date from public.subscriptions where id=pg_temp.w4c_id(300)),(now() at time zone 'Asia/Bangkok')::date,'default resume skips missed periods and retains cadence');
select set_config('test.w4c_occurrence',public.generate_subscription_occurrence(pg_temp.w4c_id(10),pg_temp.w4c_id(300),(now() at time zone 'Asia/Bangkok')::date)::text,true);
select is((select wht_rate_bps from public.invoices where id=current_setting('test.w4c_occurrence')::uuid),300,'subscription copies withholding to its invoice');
select is((select tax_rate_bps from public.invoice_items where invoice_id=current_setting('test.w4c_occurrence')::uuid),700,'subscription copies VAT to its line');
select is((select wht_rate_bps from public.invoice_items where invoice_id=current_setting('test.w4c_occurrence')::uuid),300,'subscription copies withholding to its line');
select is((select amount_satang from public.invoices where id=current_setting('test.w4c_occurrence')::uuid),10400::bigint,'generated invoice collects gross minus withholding');
select is(public.generate_subscription_occurrence(pg_temp.w4c_id(10),pg_temp.w4c_id(300),(now() at time zone 'Asia/Bangkok')::date),current_setting('test.w4c_occurrence')::uuid,'occurrence retry returns the existing invoice');
select throws_ok($$select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(300),(now() at time zone 'Asia/Bangkok')::date+1)$$,'P0001',null,'billed subscription cannot rewrite its anchor');

insert into public.subscriptions(id,org_id,client_id,name,amount_satang,interval,status,start_date,next_run_date)
  values(pg_temp.w4c_id(301),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic W4c missed periods',10000,'weekly','paused',(now() at time zone 'Asia/Bangkok')::date-21,(now() at time zone 'Asia/Bangkok')::date-21);
select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(301),null,'active',true);
select is((select next_run_date from public.subscriptions where id=pg_temp.w4c_id(301)),(now() at time zone 'Asia/Bangkok')::date-21,'explicit bill missed periods retains the outstanding occurrence');
insert into public.products(id,org_id,name,tax_rate_bps,wht_rate_bps)
  values(pg_temp.w4c_id(500),pg_temp.w4c_id(10),'Synthetic subscription product',1000,100);
update public.org_settings set wht_rate_bps=300 where org_id=pg_temp.w4c_id(10);
insert into public.subscriptions(id,org_id,client_id,name,amount_satang,product_id)
  values(pg_temp.w4c_id(302),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic product tax defaults',10000,pg_temp.w4c_id(500));
select is((select tax_rate_bps from public.subscriptions where id=pg_temp.w4c_id(302)),1000,'subscription defaults VAT from its selected product');
select is((select wht_rate_bps from public.subscriptions where id=pg_temp.w4c_id(302)),100,'subscription defaults withholding from its selected product');
insert into public.subscriptions(id,org_id,client_id,name,amount_satang)
  values(pg_temp.w4c_id(303),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic organization tax defaults',10000);
select is((select tax_rate_bps from public.subscriptions where id=pg_temp.w4c_id(303)),700,'subscription without product defaults VAT from its organization');
select is((select wht_rate_bps from public.subscriptions where id=pg_temp.w4c_id(303)),300,'subscription without product defaults withholding from its organization');
insert into public.subscriptions(id,org_id,client_id,name,amount_satang,tax_rate_bps,wht_rate_bps,prices_include_vat,start_date,next_run_date)
  values(pg_temp.w4c_id(304),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic stored exclusive agreement',10000,700,0,false,
    (now() at time zone 'Asia/Bangkok')::date,(now() at time zone 'Asia/Bangkok')::date),
  (pg_temp.w4c_id(305),pg_temp.w4c_id(10),pg_temp.w4c_id(20),'Synthetic stored inclusive agreement',10700,700,0,true,
    (now() at time zone 'Asia/Bangkok')::date,(now() at time zone 'Asia/Bangkok')::date);
select public.update_tax_business_profile(pg_temp.w4c_id(10),'Synthetic W4c seller','Synthetic address','1234567890123',true,700,true,'Head office');
select set_config('test.w4c_stored_exclusive',public.generate_subscription_occurrence(pg_temp.w4c_id(10),pg_temp.w4c_id(304),(now() at time zone 'Asia/Bangkok')::date)::text,true);
select is((select prices_include_vat from public.invoices where id=current_setting('test.w4c_stored_exclusive')::uuid),false,'stored exclusive agreement survives organization switching to inclusive VAT');
select is((select total_satang from public.invoices where id=current_setting('test.w4c_stored_exclusive')::uuid),10700::bigint,'stored exclusive agreement still adds VAT once');
select is((select source_subscription_id from public.invoices where id=current_setting('test.w4c_stored_exclusive')::uuid),pg_temp.w4c_id(304),'generated invoice retains its subscription identity');
select public.update_tax_business_profile(pg_temp.w4c_id(10),'Synthetic W4c seller','Synthetic address','1234567890123',true,700,false,'Head office');
select set_config('test.w4c_stored_inclusive',public.generate_subscription_occurrence(pg_temp.w4c_id(10),pg_temp.w4c_id(305),(now() at time zone 'Asia/Bangkok')::date)::text,true);
select is((select prices_include_vat from public.invoices where id=current_setting('test.w4c_stored_inclusive')::uuid),true,'stored inclusive agreement survives organization switching to exclusive VAT');
select is((select total_satang from public.invoices where id=current_setting('test.w4c_stored_inclusive')::uuid),10700::bigint,'stored inclusive agreement still extracts VAT once');
select is((select vat_satang from public.invoices where id=current_setting('test.w4c_stored_inclusive')::uuid),700::bigint,'stored inclusive agreement preserves its expected VAT amount');
select throws_ok($$update public.invoices set source_subscription_id=pg_temp.w4c_id(304) where id=current_setting('test.w4c_stored_inclusive')::uuid$$,
  'P0001','Subscription source is immutable','generated invoice cannot be reassigned to another subscription');
select throws_ok($$insert into public.invoices(org_id,client_id,number,source_subscription_id)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(20),'W4C-FORGED-SUBSCRIPTION',pg_temp.w4c_id(304))$$,
  'P0001','Subscription source requires the occurrence command','ordinary caller cannot forge a subscription source');
select throws_ok($$insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(1),'quote',pg_temp.w4c_id(106),'quote_accepted','Counterfeit acceptance')$$,
  'P0001','Reserved audit action requires its command','authenticated caller cannot counterfeit acceptance audit evidence');
select throws_ok($$insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(1),'subscription',pg_temp.w4c_id(300),'subscription_schedule_changed','Counterfeit schedule command')$$,
  'P0001','Reserved audit action requires its command','authenticated caller cannot counterfeit schedule command evidence');
select throws_ok($$insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(1),'quote',pg_temp.w4c_id(102),'invoice_cancelled','Counterfeit cancellation')$$,
  'P0001','Reserved audit action requires its command','authenticated caller cannot counterfeit cancellation command evidence');
select lives_ok($$insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
  values(pg_temp.w4c_id(10),pg_temp.w4c_id(1),'quote',pg_temp.w4c_id(106),'note_added','Ordinary audit note')$$,
  'ordinary authenticated audit notes remain available');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.w4c_id(2))::text,true);
select throws_ok($$select public.update_subscription_schedule(pg_temp.w4c_id(10),pg_temp.w4c_id(301),null,'paused')$$,'P0001',null,'member cannot alter subscription schedules');
select lives_ok($$select public.reserve_document_number(pg_temp.w4c_id(10),'quote',2098)$$,'member can reserve quote numbers in their workspace');

reset role;
select * from finish();
rollback;
