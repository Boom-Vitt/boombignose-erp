begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_function('public','update_tax_business_profile',array['uuid','text','text','text','text','integer','boolean','text'],'Tax profile accepts explicit three-way VAT status');

insert into auth.users(id,email) values('cf000000-0000-4000-8000-000000000001','vat-choice-owner@example.invalid');
insert into public.organizations(id,name,slug) values('cf000000-0000-4000-8000-000000000010','VAT choices','vat-choices');
insert into public.memberships(org_id,user_id,role) values('cf000000-0000-4000-8000-000000000010','cf000000-0000-4000-8000-000000000001','owner');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"cf000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.update_tax_business_profile('cf000000-0000-4000-8000-000000000010','Seller','Address',null,'not_registered',700,false,'Head office');
select is((select tax_status from public.org_settings where org_id='cf000000-0000-4000-8000-000000000010'),'not_registered','Unknown seller can explicitly declare not registered');
select public.update_tax_business_profile('cf000000-0000-4000-8000-000000000010','Seller','Address',null,'unknown',700,false,'Head office');
select is((select tax_status from public.org_settings where org_id='cf000000-0000-4000-8000-000000000010'),'unknown','Unknown is a distinct saved choice');
select throws_ok($$select public.update_tax_business_profile('cf000000-0000-4000-8000-000000000010','Seller','Address',null,'registered',700,false,'Head office')$$,'P0001','Invalid business profile','Registered VAT still requires valid tax ID');
select public.update_tax_business_profile('cf000000-0000-4000-8000-000000000010','Seller','Address','1234567890123','registered',700,false,'Head office');
select is((select vat_registered from public.org_settings where org_id='cf000000-0000-4000-8000-000000000010'),true,'Generated registration flag remains consistent');
select * from finish();
rollback;
