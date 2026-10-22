begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values ('be000000-0000-4000-8000-000000000001','vat-fixes@example.invalid',now());
insert into public.organizations(id,name,slug) values
  ('be000000-0000-4000-8000-000000000010','Synthetic registered seller','synthetic-registered-seller'),
  ('be000000-0000-4000-8000-000000000011','Synthetic undeclared seller','synthetic-undeclared-seller');
insert into public.memberships(org_id,user_id,role) values
  ('be000000-0000-4000-8000-000000000010','be000000-0000-4000-8000-000000000001','owner'),
  ('be000000-0000-4000-8000-000000000011','be000000-0000-4000-8000-000000000001','owner');
-- A profile saved before VAT settings existed carries only tax_status.
insert into public.org_settings(org_id,legal_name,business_address,tax_id,tax_status) values ('be000000-0000-4000-8000-000000000010','Registered seller','Seller address','1234567890123','registered')
  on conflict(org_id) do update set legal_name=excluded.legal_name,business_address=excluded.business_address,tax_id=excluded.tax_id,tax_status=excluded.tax_status;
select is((select vat_registered from public.org_settings where org_id='be000000-0000-4000-8000-000000000010'),true,'registered tax status is VAT registered');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"be000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.update_tax_business_profile('be000000-0000-4000-8000-000000000010','Registered seller','Moved address','1234567890123',true,700,false,'');
select is((select tax_status from public.org_settings where org_id='be000000-0000-4000-8000-000000000010'),'registered','address save keeps registered status');
select public.update_tax_business_profile('be000000-0000-4000-8000-000000000010','Registered seller','Moved address','1234567890123',false,700,false,'');
select is((select (tax_status,vat_registered)::text from public.org_settings where org_id='be000000-0000-4000-8000-000000000010'),'(not_registered,f)','unchecking VAT deregisters');
select public.update_tax_business_profile('be000000-0000-4000-8000-000000000011','Undeclared seller','Seller address','',false,700,false,'');
select is((select (tax_status,vat_registered)::text from public.org_settings where org_id='be000000-0000-4000-8000-000000000011'),'(unknown,f)','saving an undeclared profile keeps unknown status');
reset role;

-- Same cases and expectations as lib/tax/totals.test.ts "agrees with the SQL helper".
select is(private.document_tax_totals('[{"amount_satang":1999900000000001,"tax_rate_bps":9999}]',0,true,0),'{"subtotalSatang":1999900000000001,"baseSatang":1000000000000001,"vatSatang":999900000000000,"totalSatang":1999900000000001,"whtSatang":0,"amountDueSatang":1999900000000001,"vatByRate":[{"rateBps":9999,"baseSatang":1000000000000001,"vatSatang":999900000000000}]}'::jsonb,'parity: inclusive VAT at 9999 bps rounds once');
select is(private.document_tax_totals('[{"amount_satang":10000000000003,"tax_rate_bps":0},{"amount_satang":10000000000002,"tax_rate_bps":700},{"amount_satang":10000000000002,"tax_rate_bps":1000}]',15000000000002,false,300),'{"subtotalSatang":30000000000007,"baseSatang":15000000000005,"vatSatang":850000000000,"totalSatang":15850000000005,"whtSatang":450000000000,"amountDueSatang":15400000000005,"vatByRate":[{"rateBps":0,"baseSatang":5000000000002,"vatSatang":0},{"rateBps":700,"baseSatang":5000000000001,"vatSatang":350000000000},{"rateBps":1000,"baseSatang":5000000000002,"vatSatang":500000000000}]}'::jsonb,'parity: discount floors stay exact across three rates');
select is(private.document_tax_totals('[{"amount_satang":1,"tax_rate_bps":10000}]',0,true,0),'{"subtotalSatang":1,"baseSatang":0,"vatSatang":1,"totalSatang":1,"whtSatang":0,"amountDueSatang":1,"vatByRate":[{"rateBps":10000,"baseSatang":0,"vatSatang":1}]}'::jsonb,'parity: inclusive VAT half-up tie');
select is(private.document_tax_totals('[{"amount_satang":50,"tax_rate_bps":0}]',0,false,100),'{"subtotalSatang":50,"baseSatang":50,"vatSatang":0,"totalSatang":50,"whtSatang":1,"amountDueSatang":49,"vatByRate":[{"rateBps":0,"baseSatang":50,"vatSatang":0}]}'::jsonb,'parity: WHT half-up tie');
select is(private.document_tax_totals('[{"amount_satang":9007199254740991,"tax_rate_bps":700}]',0,true,500),'{"subtotalSatang":9007199254740991,"baseSatang":8417943228729898,"vatSatang":589256026011093,"totalSatang":9007199254740991,"whtSatang":420897161436495,"amountDueSatang":8586302093304496,"vatByRate":[{"rateBps":700,"baseSatang":8417943228729898,"vatSatang":589256026011093}]}'::jsonb,'parity: max safe inclusive amount with WHT');
select is(private.document_tax_totals('[{"amount_satang":9007199254740990,"tax_rate_bps":0},{"amount_satang":1,"tax_rate_bps":9999}]',9007199254740989,true,300),'{"subtotalSatang":9007199254740991,"baseSatang":2,"vatSatang":0,"totalSatang":2,"whtSatang":0,"amountDueSatang":2,"vatByRate":[{"rateBps":0,"baseSatang":2,"vatSatang":0},{"rateBps":9999,"baseSatang":0,"vatSatang":0}]}'::jsonb,'parity: near-total discount at max safe subtotal');
select * from finish();
rollback;
