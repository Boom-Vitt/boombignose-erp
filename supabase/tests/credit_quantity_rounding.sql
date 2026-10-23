begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cq_id(n integer) returns uuid language sql immutable as $$select ('cb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.cq_id(1),'quantity-credit@example.invalid');
insert into public.organizations(id,name,slug) values(pg_temp.cq_id(10),'Quantity credit tests','quantity-credit-tests');
insert into public.memberships(org_id,user_id,role) values(pg_temp.cq_id(10),pg_temp.cq_id(1),'owner');
insert into public.clients(id,org_id,name) values(pg_temp.cq_id(20),pg_temp.cq_id(10),'Buyer');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cq_id(1))::text,true);
set local role authenticated;
select public.update_tax_business_profile(pg_temp.cq_id(10),'Seller','Address','1234567890123',true,700,false,'Head office');

insert into public.invoices(id,org_id,client_id,number,wht_rate_bps,prices_include_vat,discount_satang)
select pg_temp.cq_id(n),pg_temp.cq_id(10),pg_temp.cq_id(20),'DRAFT-QTY-'||n,300,false,3 from generate_series(31,32) n;
select public.update_tax_business_profile(pg_temp.cq_id(10),'Seller','Address','1234567890123',true,700,true,'Head office');
insert into public.invoices(id,org_id,client_id,number,wht_rate_bps,prices_include_vat,discount_satang)
select pg_temp.cq_id(n),pg_temp.cq_id(10),pg_temp.cq_id(20),'DRAFT-QTY-'||n,300,true,3 from generate_series(33,34) n;
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps)
select pg_temp.cq_id(n*10+r),pg_temp.cq_id(10),pg_temp.cq_id(n),'Odd price rate '||rate,1,10001,rate
from generate_series(31,34) n cross join (values (0,0),(1,700),(2,1000)) rates(r,rate);
select public.issue_invoice(pg_temp.cq_id(10),id,version,pg_temp.cq_id(100+n)) from public.invoices cross join generate_series(31,34) n where id=pg_temp.cq_id(n);

create function pg_temp.credit_portion(n integer,part integer,qty numeric) returns uuid language sql as $$
  select public.issue_credit_note(pg_temp.cq_id(10),pg_temp.cq_id(n),
    (select jsonb_agg(jsonb_build_object('invoice_item_id',id,'quantity',qty) order by id) from public.invoice_items where invoice_id=pg_temp.cq_id(n)),
    'Quantity return',pg_temp.cq_id(n*100+part));
$$;

select lives_ok(format('select pg_temp.credit_portion(%s,1,%s)',n,case when n%2=1 then 0.5 else 0.333 end),'First partial quantity credit '||n) from generate_series(31,34) n;
select lives_ok(format('select pg_temp.credit_portion(%s,2,%s)',n,case when n%2=1 then 0.5 else 0.333 end),'Second partial quantity credit '||n) from generate_series(31,34) n;
select lives_ok(format('select pg_temp.credit_portion(%s,3,0.334)',n),'Final third quantity credit '||n) from (values (32),(34)) cases(n);
reset role;

select is((select array_agg(c.raw_satang order by cmd.key) from public.credit_note_lines c
  join public.payment_command_results cmd on cmd.org_id=c.org_id and cmd.result=c.credit_note_id
  where c.invoice_item_id=pg_temp.cq_id(n*10)),
  case when n%2=1 then array[5001,5000]::bigint[] else array[3330,3331,3340]::bigint[] end,
  'Quantity credits use cumulative rounded raw amounts '||n) from generate_series(31,34) n;
select is((select sum(c.raw_satang)::bigint from public.credit_note_lines c where c.invoice_item_id=l.id),l.amount_satang,'Every original line is fully credited '||l.id)
from public.invoice_items l where org_id=pg_temp.cq_id(10);
select is((select sum(c.quantity) from public.credit_note_lines c where c.invoice_item_id=l.id),l.quantity,'Exact credited quantities are retained '||l.id)
from public.invoice_items l where org_id=pg_temp.cq_id(10);
select is((select sum((c.snapshot->'document'->>'baseSatang')::bigint)::bigint from public.credit_notes c where c.invoice_id=i.id),i.total_satang-i.vat_satang,'Credit bases exhaust original discounted base '||i.number) from public.invoices i where org_id=pg_temp.cq_id(10);
select is((select sum((c.snapshot->'document'->>'vatSatang')::bigint)::bigint from public.credit_notes c where c.invoice_id=i.id),i.vat_satang,'Credit VAT exhausts original VAT '||i.number) from public.invoices i where org_id=pg_temp.cq_id(10);
select is((select sum((c.snapshot->'document'->>'whtSatang')::bigint)::bigint from public.credit_notes c where c.invoice_id=i.id),i.wht_satang,'Credit WHT exhausts original WHT '||i.number) from public.invoices i where org_id=pg_temp.cq_id(10);
select is((select sum(c.amount_satang)::bigint from public.credit_notes c where c.invoice_id=i.id),i.amount_satang,'Credit due exhausts original due '||i.number) from public.invoices i where org_id=pg_temp.cq_id(10);
select is((select sum((credited->>'vatSatang')::bigint)::bigint from public.credit_notes c cross join lateral jsonb_array_elements(c.snapshot->'document'->'vatByRate') credited
  where c.invoice_id=i.id and credited->>'rateBps'=original->>'rateBps'),(original->>'vatSatang')::bigint,'Each VAT bucket exhausts original tax '||i.number||'/'||(original->>'rateBps'))
from public.invoices i cross join lateral jsonb_array_elements(i.tax_breakdown) original where i.org_id=pg_temp.cq_id(10);
select is(outstanding_satang,0::bigint,'No stranded satang after successive quantity credits '||invoice_id) from public.invoice_balances where org_id=pg_temp.cq_id(10);
set local role authenticated;
select throws_ok('select pg_temp.credit_portion(31,3,0.001)','P0001','Invalid credit quantity','Cumulative quantity cannot exceed the original');
select lives_ok('select pg_temp.credit_portion(31,2,0.5)','An acknowledged quantity command remains idempotent');
select is((select count(*) from public.credit_notes where invoice_id=pg_temp.cq_id(31)),2::bigint,'A retry does not consume quantity or create another note');

select * from finish();
rollback;
