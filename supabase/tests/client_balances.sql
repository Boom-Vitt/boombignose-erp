begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id,email,email_confirmed_at) values
  ('cb000000-0000-4000-8000-000000000001','balance-member@example.test',now()),
  ('cb000000-0000-4000-8000-000000000002','balance-outsider@example.test',now());
insert into organizations(id,name,slug) values('cb000000-0000-4000-8000-000000000010','Synthetic balances','synthetic-balances');
insert into memberships(org_id,user_id,role) values('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000001','owner');
insert into clients(id,org_id,name) values
  ('cb000000-0000-4000-8000-000000000011','cb000000-0000-4000-8000-000000000010','Paid in 1,001 receipts'),
  ('cb000000-0000-4000-8000-000000000012','cb000000-0000-4000-8000-000000000010','Mixed invoices');
insert into invoices(id,org_id,client_id,number,status,amount_satang) values
  ('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000011','BAL-1','draft',100100),
  ('cb000000-0000-4000-8000-000000000022','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000012','BAL-2','draft',50000),
  ('cb000000-0000-4000-8000-000000000023','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000012','BAL-3','draft',70000),
  ('cb000000-0000-4000-8000-000000000024','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000012','BAL-4','cancelled',90000),
  ('cb000000-0000-4000-8000-000000000025','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000012','BAL-5','draft',40000);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"cb000000-0000-4000-8000-000000000001"}',true);
select public.update_business_profile('cb000000-0000-4000-8000-000000000010','Synthetic balance seller','Synthetic address',null,'not_registered');
insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang)
  select org_id,id,'Synthetic service',amount_satang from public.invoices where id in ('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000022','cb000000-0000-4000-8000-000000000025');
select public.issue_invoice(org_id,id,version,gen_random_uuid()) from public.invoices where id in ('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000022','cb000000-0000-4000-8000-000000000025');
insert into payments(org_id,invoice_id,amount_satang,verification_state,verified_by,verification_reference,command_key)
select 'cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000021',100,'verified','cb000000-0000-4000-8000-000000000001','receipt '||n,gen_random_uuid()
from generate_series(1,1001) n;
insert into payments(org_id,invoice_id,amount_satang,verification_state,verified_by,verification_reference,command_key) values
  ('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000022',20000,'verified','cb000000-0000-4000-8000-000000000001','bank slip',gen_random_uuid());
insert into payments(org_id,invoice_id,amount_satang) values
  ('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000022',30000);
insert into public.payment_allocations(org_id,payment_id,invoice_id,amount_satang) select org_id,id,invoice_id,amount_satang from public.payments where org_id='cb000000-0000-4000-8000-000000000010' and verification_state='verified';
insert into projects(id,org_id,name) values('cb000000-0000-4000-8000-000000000031','cb000000-0000-4000-8000-000000000010','Long project');
insert into time_entries(org_id,project_id,minutes)
select 'cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000031',30 from generate_series(1,1001);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"cb000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select results_eq($$select invoiced_satang,paid_satang,outstanding_satang from client_balances
  where org_id='cb000000-0000-4000-8000-000000000010' and client_id='cb000000-0000-4000-8000-000000000011'$$,
  $$values (100100::bigint,100100::bigint,0::bigint)$$,'invoice paid by 1,001 verified receipts owes nothing');
select results_eq($$select invoiced_satang,paid_satang,outstanding_satang from client_balances
  where org_id='cb000000-0000-4000-8000-000000000010' and client_id='cb000000-0000-4000-8000-000000000012'$$,
  $$values (90000::bigint,20000::bigint,70000::bigint)$$,'drafts, cancelled invoices and unverified receipts are excluded');
select is((select count(*) from client_balances where org_id='cb000000-0000-4000-8000-000000000010'),2::bigint,'one row per client');
select results_eq($$select paid_satang,outstanding_satang from invoice_balances
  where org_id='cb000000-0000-4000-8000-000000000010' and invoice_id='cb000000-0000-4000-8000-000000000021'$$,
  $$values (100100::bigint,0::bigint)$$,'invoice balance counts all 1,001 receipts');
select is((select minutes from project_time_totals where org_id='cb000000-0000-4000-8000-000000000010'
  and project_id='cb000000-0000-4000-8000-000000000031'),30030::bigint,'project time sums all 1,001 entries');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"cb000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is((select count(*) from client_balances where org_id='cb000000-0000-4000-8000-000000000010'),0::bigint,'non-members see no balances');
select is((select count(*) from invoice_balances where org_id='cb000000-0000-4000-8000-000000000010')
  + (select count(*) from project_time_totals where org_id='cb000000-0000-4000-8000-000000000010'),0::bigint,'non-members see no invoice balances or project time');
reset role;

set local role anon;
select throws_ok('select * from client_balances','42501',null,'anon cannot read balances');
reset role;
select * from finish();
rollback;
