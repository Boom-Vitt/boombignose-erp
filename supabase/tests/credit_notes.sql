begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','credit_notes','Credit notes retain issued corrections');
select has_function('public','issue_credit_note',array['uuid','uuid','jsonb','text','uuid'],'Credit note command exists');

create function pg_temp.cn_id(n integer) returns uuid language sql immutable as $$select ('ca000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.cn_id(1),'cn-owner@example.invalid'),(pg_temp.cn_id(2),'cn-member@example.invalid');
insert into public.organizations(id,name,slug) values(pg_temp.cn_id(10),'Credit tests','cn-tests');
insert into public.memberships(org_id,user_id,role) values(pg_temp.cn_id(10),pg_temp.cn_id(1),'owner'),(pg_temp.cn_id(10),pg_temp.cn_id(2),'member');
insert into public.clients(id,org_id,name) values(pg_temp.cn_id(20),pg_temp.cn_id(10),'Buyer');
insert into public.invoices(id,org_id,client_id,number,wht_rate_bps) values(pg_temp.cn_id(30),pg_temp.cn_id(10),pg_temp.cn_id(20),'DRAFT-CN',300);
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cn_id(1))::text,true);
set local role authenticated;
select public.update_tax_business_profile(pg_temp.cn_id(10),'Seller','Address','1234567890123',true,700,false,'Head office');
insert into public.invoice_items(id,org_id,invoice_id,description,quantity,unit_price_satang,tax_rate_bps) values
(pg_temp.cn_id(40),pg_temp.cn_id(10),pg_temp.cn_id(30),'Taxed service',2,5000,700),
(pg_temp.cn_id(41),pg_temp.cn_id(10),pg_temp.cn_id(30),'Exempt service',1,10000,0);
select throws_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","quantity":1}]','Correction',pg_temp.cn_id(50))$$,'P0001','Issued invoice required','Draft cannot be credited');
select public.issue_invoice(pg_temp.cn_id(10),pg_temp.cn_id(30),(select version from public.invoices where id=pg_temp.cn_id(30)),pg_temp.cn_id(49));
select lives_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","quantity":1}]','Partial return',pg_temp.cn_id(50))$$,'Partial quantity credit issues');
select is((select amount_satang from public.credit_notes where org_id=pg_temp.cn_id(10)),5200::bigint,'Credit calculates 7% VAT and 3% WHT');
select is((select credited_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(30)),5200::bigint,'Original balance reflects partial credit');
select is((select outstanding_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(30)),14900::bigint,'Outstanding is reduced without cash');
select is((select paid_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(30)),0::bigint,'Credit creates no cash');
select lives_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","quantity":1}]','Partial return',pg_temp.cn_id(50))$$,'Exact retry recovers issued note');
select is((select count(*) from public.credit_notes where org_id=pg_temp.cn_id(10)),1::bigint,'Retry creates no extra number');
select throws_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","amount_satang":5001}]','Excess credit',pg_temp.cn_id(51))$$,'P0001','Credit exceeds remaining line amount','Cumulative line limit enforced');
select public.update_finance_lock_date(pg_temp.cn_id(10),(now() at time zone 'Asia/Bangkok')::date);
select throws_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","amount_satang":5000}]','Locked credit',pg_temp.cn_id(52))$$,'P0001','Finance period is locked','Lock date blocks new credit');
select public.update_finance_lock_date(pg_temp.cn_id(10),null);
select lives_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(30),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000040","amount_satang":5000},{"invoice_item_id":"ca000000-0000-4000-8000-000000000041","amount_satang":10000}]','Remaining correction',pg_temp.cn_id(52))$$,'Remaining mixed-rate amount credit issues');
select is((select sum(amount_satang)::bigint from public.credit_notes where org_id=pg_temp.cn_id(10)),20100::bigint,'Full correction exactly matches original due');
select is((select outstanding_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(30)),0::bigint,'Full credit leaves zero outstanding');
select is((select status::text from public.invoices where id=pg_temp.cn_id(30)),'paid','Fully credited invoice is settled');
select is((select amount_satang from public.invoices where id=pg_temp.cn_id(30)),20100::bigint,'Original issued amount is retained');
reset role;
select is((select value from public.document_counters where org_id=pg_temp.cn_id(10) and kind='CN'),2::bigint,'Failed and retried commands leave gap-free CN series');
select throws_ok($$update public.credit_notes set reason='Changed' where org_id=pg_temp.cn_id(10)$$,'P0001','Issued credit notes are immutable','Even privileged edits retain issued notes');
select throws_ok($$delete from public.credit_note_lines where org_id=pg_temp.cn_id(10)$$,'P0001','Issued credit notes are immutable','Credit source evidence is immutable');
select ok(not has_table_privilege('authenticated','public.credit_notes','insert'),'Clients cannot bypass issue command');

set constraints all immediate;
alter table public.invoices disable trigger guard_invoice_issue;
alter table public.invoices disable trigger guard_commercial_customer;
insert into public.invoices(id,org_id,client_id,number,status,amount_satang) values
(pg_temp.cn_id(31),pg_temp.cn_id(10),pg_temp.cn_id(20),'Historical with lines','sent',900),
(pg_temp.cn_id(32),pg_temp.cn_id(10),pg_temp.cn_id(20),'Historical without lines','sent',800);
insert into public.invoice_items(id,org_id,invoice_id,description,unit_price_satang) values(pg_temp.cn_id(42),pg_temp.cn_id(10),pg_temp.cn_id(31),'Historical line',500);
set constraints all immediate;
alter table public.invoices enable trigger guard_commercial_customer;
alter table public.invoices enable trigger guard_invoice_issue;
set local role authenticated;
select public.adopt_legacy_invoice(pg_temp.cn_id(10),pg_temp.cn_id(31),(select version from public.invoices where id=pg_temp.cn_id(31)),pg_temp.cn_id(70),'Historical imported evidence');
select public.adopt_legacy_invoice(pg_temp.cn_id(10),pg_temp.cn_id(32),(select version from public.invoices where id=pg_temp.cn_id(32)),pg_temp.cn_id(71),'Historical imported evidence');
select lives_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(31),'[{"invoice_item_id":"ca000000-0000-4000-8000-000000000042","quantity":1}]','Historical correction',pg_temp.cn_id(72))$$,'Adopted legacy line correction issues');
select is((select outstanding_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(31)),0::bigint,'Historical line correction uses retained header amount');
select lives_ok($$select public.issue_credit_note(pg_temp.cn_id(10),pg_temp.cn_id(32),'[{"amount_satang":400}]','Historical amount correction',pg_temp.cn_id(73))$$,'Line-less adopted invoice supports amount correction');
select is((select outstanding_satang from public.invoice_balances where invoice_id=pg_temp.cn_id(32)),400::bigint,'Legacy amount correction reduces retained balance');
select * from finish();
rollback;
