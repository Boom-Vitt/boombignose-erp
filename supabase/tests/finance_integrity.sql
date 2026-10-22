begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.finance_id(n integer) returns uuid language sql immutable as $$
  select ('bf000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.finance_id(1),'synthetic-integrity-owner@example.invalid',now()),
  (pg_temp.finance_id(2),'synthetic-integrity-member@example.invalid',now()),
  (pg_temp.finance_id(3),'synthetic-integrity-admin@example.invalid',now());
insert into public.organizations(id,name,slug) values (pg_temp.finance_id(10),'Synthetic finance integrity','synthetic-finance-integrity');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.finance_id(10),pg_temp.finance_id(1),'owner'),
  (pg_temp.finance_id(10),pg_temp.finance_id(2),'member'),
  (pg_temp.finance_id(10),pg_temp.finance_id(3),'admin');
insert into public.clients(id,org_id,name,portal_enabled,portal_token) values (pg_temp.finance_id(20),pg_temp.finance_id(10),'Synthetic buyer',true,'synthetic-finance-integrity-token');
insert into public.invoices(id,org_id,client_id,number,issue_date)
  select pg_temp.finance_id(n),pg_temp.finance_id(10),pg_temp.finance_id(20),'DRAFT-'||pg_temp.finance_id(n)::text,'2001-01-01'::date from generate_series(30,35) n;
insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang)
  select pg_temp.finance_id(10),pg_temp.finance_id(n),'Synthetic service',case when n=35 then 2000 else 1000 end from generate_series(30,35) n;
insert into public.quotes(id,org_id,client_id,number) values (pg_temp.finance_id(40),pg_temp.finance_id(10),pg_temp.finance_id(20),'Synthetic quote');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.finance_id(1))::text,true);
set local role authenticated;
select public.update_tax_business_profile(pg_temp.finance_id(10),'Synthetic seller','Synthetic address','1234567890123',false,700,false,'Head office');

select throws_ok($$update public.invoices set status='sent' where id=pg_temp.finance_id(30)$$,'P0001','Payable state requires issue command','B2 direct sent requires a snapshot');
select throws_ok($$update public.invoices set status='overdue' where id=pg_temp.finance_id(30)$$,'P0001','Payable state requires issue command','B2 direct overdue requires a snapshot');
select throws_ok($$update public.invoices set status='partially_paid' where id=pg_temp.finance_id(30)$$,'P0001','Payable state requires issue command','B2 direct partial payment requires a snapshot');
select throws_ok($$update public.invoices set status='paid' where id=pg_temp.finance_id(30)$$,'P0001','Payable state requires issue command','B2 direct paid requires a snapshot');
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),1,'Synthetic report',pg_temp.finance_id(100))$$,'P0001','Invoice is not payable','B2 staff cannot report cash against a draft');
select throws_ok($$select public.submit_payment_claim('synthetic-finance-integrity-token',pg_temp.finance_id(30),1,'Synthetic report',pg_temp.finance_id(101))$$,'P0001','Invoice is not payable','B2 portal cannot report cash against a draft');
select lives_ok($$select public.cancel_draft_invoice(pg_temp.finance_id(10),pg_temp.finance_id(34))$$,'B2 explicit command cancels a draft');
select lives_ok($$select public.cancel_draft_invoice(pg_temp.finance_id(10),pg_temp.finance_id(34))$$,'B2 cancellation retry is harmless');
select throws_ok($$update public.invoices set status='sent' where id=pg_temp.finance_id(34)$$,'P0001','Cancelled draft is final','B2 cancelled to sent bypass is closed');
select throws_ok($$update public.invoices set status='draft' where id=pg_temp.finance_id(34)$$,'P0001','Cancelled draft is final','B2 cancelled draft cannot reopen');
reset role;
select throws_ok($$update public.invoices set status='overdue' where id=pg_temp.finance_id(30)$$,'P0001','Payable state requires issue command','B2 privileged writes also require a snapshot');
set local role authenticated;

select throws_ok($$insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang,tax_rate_bps) values(pg_temp.finance_id(10),pg_temp.finance_id(30),'Taxed service',1000,700)$$,'P0001','VAT registration required for taxable lines','S5 invoice insert rejects unregistered VAT');
select throws_ok($$update public.invoice_items set tax_rate_bps=700 where invoice_id=pg_temp.finance_id(30)$$,'P0001','VAT registration required for taxable lines','S5 invoice update rejects unregistered VAT');
select throws_ok($$insert into public.quote_items(org_id,quote_id,description,unit_price_satang,tax_rate_bps) values(pg_temp.finance_id(10),pg_temp.finance_id(40),'Taxed quote',1000,700)$$,'P0001','VAT registration required for taxable lines','S5 quote insert rejects unregistered VAT');
insert into public.quote_items(org_id,quote_id,description,unit_price_satang) values(pg_temp.finance_id(10),pg_temp.finance_id(40),'Untaxed quote',1000);
select throws_ok($$update public.quote_items set tax_rate_bps=700 where quote_id=pg_temp.finance_id(40)$$,'P0001','VAT registration required for taxable lines','S5 quote update rejects unregistered VAT');
select public.update_tax_business_profile(pg_temp.finance_id(10),'Synthetic seller','Synthetic address','1234567890123',true,700,false,'Head office');
select lives_ok($$update public.invoice_items set tax_rate_bps=700 where invoice_id=pg_temp.finance_id(32)$$,'S5 registered seller can tax invoice lines');
select lives_ok($$update public.quote_items set tax_rate_bps=700 where quote_id=pg_temp.finance_id(40)$$,'S5 registered seller can tax quote lines');
select public.update_tax_business_profile(pg_temp.finance_id(10),'Synthetic seller','Synthetic address','1234567890123',false,700,false,'Head office');
select throws_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(32),(select version from public.invoices where id=pg_temp.finance_id(32)),pg_temp.finance_id(102))$$,'P0001','VAT registration required for taxable lines','S5 issuance rechecks registration after a profile change');

select throws_ok($$update public.invoices set number='INV-2026-000001' where id=pg_temp.finance_id(30)$$,'P0001','Invoice series numbers require issue command','S12 drafts cannot reserve an issued number');
select throws_ok($$insert into public.invoices(org_id,client_id,number) values(pg_temp.finance_id(10),pg_temp.finance_id(20),' inv-2026-001 ')$$,'P0001','Invoice series numbers require issue command','S12 manual numeric series aliases are reserved');
reset role;
select is((select count(*) from public.document_counters where org_id=pg_temp.finance_id(10)),0::bigint,'S12 drafting and failed issues allocate no numbers');
set local role authenticated;
select lives_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(30),(select version from public.invoices where id=pg_temp.finance_id(30)),pg_temp.finance_id(110))$$,'S6 valid invoice issues');
select is((select issue_date from public.invoices where id=pg_temp.finance_id(30)),(now() at time zone 'Asia/Bangkok')::date,'S6 issue date is Bangkok today, regardless of draft date');
select is((select snapshot->'document'->>'issueDate' from public.invoice_snapshots where invoice_id=pg_temp.finance_id(30)),((now() at time zone 'Asia/Bangkok')::date)::text,'S6 snapshot retains actual issue date');
select is((select number from public.invoices where id=pg_temp.finance_id(30)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000001','S6 number follows Bangkok issue year');
select throws_ok($$update public.invoices set status='overdue' where id=pg_temp.finance_id(30)$$,'P0001','Invoice status changes require a command','B2 issued statuses cannot be edited directly');
select public.update_tax_business_profile(pg_temp.finance_id(10),'Synthetic seller','Synthetic address','1234567890123',true,700,false,'Head office');
select lives_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(32),(select version from public.invoices where id=pg_temp.finance_id(32)),pg_temp.finance_id(111))$$,'S5 re-registered seller can issue the taxable draft');
select is((select number from public.invoices where id=pg_temp.finance_id(32)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000002','S12 failed issue did not create a gap');
select lives_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(30),(select source_version from public.invoice_snapshots where invoice_id=pg_temp.finance_id(30)),pg_temp.finance_id(110))$$,'S12 same-key issue retry returns existing snapshot');
reset role;
select is((select value from public.document_counters where org_id=pg_temp.finance_id(10) and kind='INV' and year=extract(year from now() at time zone 'Asia/Bangkok')),2::bigint,'S12 retry consumes no number');
set local role authenticated;

select lives_ok($$select public.update_finance_lock_date(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date)$$,'S6 owner can close the current period');
select throws_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(33),(select version from public.invoices where id=pg_temp.finance_id(33)),pg_temp.finance_id(112))$$,'P0001','Finance period is locked','S6 issue on the lock date is refused');
select throws_ok($$select public.update_finance_lock_date(pg_temp.finance_id(10),'-infinity')$$,'P0001','Invalid finance lock date','S6 lock date must be finite');
select lives_ok($$select public.update_finance_lock_date(pg_temp.finance_id(10),null)$$,'S6 owner can reopen periods');
select lives_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(33),(select version from public.invoices where id=pg_temp.finance_id(33)),pg_temp.finance_id(112))$$,'S6 previously refused issue succeeds after unlock with same key');
reset role;
select is((select value from public.document_counters where org_id=pg_temp.finance_id(10) and kind='INV' and year=extract(year from now() at time zone 'Asia/Bangkok')),3::bigint,'S12 locked-period failure consumes no number');
set local role authenticated;

create temp table integrity_results(kind text primary key,id uuid);
insert into integrity_results select 'first',public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),300,'Synthetic first transfer',pg_temp.finance_id(120));
select lives_ok($$insert into integrity_results select 'second',public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),200,'Synthetic second transfer',pg_temp.finance_id(121))$$,'I8 two distinct pending staff transfers are allowed');
select lives_ok($$insert into integrity_results select 'portal',public.submit_payment_claim('synthetic-finance-integrity-token',pg_temp.finance_id(30),100,'Synthetic portal transfer',pg_temp.finance_id(122))$$,'I8 portal and staff claims share remaining capacity');
select is((select sum(amount_satang) from public.payment_claims where invoice_id=pg_temp.finance_id(30) and status='pending'),600::numeric,'I8 all pending claims reserve the open balance');
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),401,'Synthetic excess staff transfer',pg_temp.finance_id(123))$$,'P0001','Report exceeds unclaimed open balance','I8 combined staff claims cannot exceed the balance');
select throws_ok($$select public.submit_payment_claim('synthetic-finance-integrity-token',pg_temp.finance_id(30),401,'Synthetic excess portal transfer',pg_temp.finance_id(124))$$,'P0001','Claim exceeds unclaimed open balance','I8 combined portal claims cannot exceed the balance');
select is(public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),300,'Synthetic first transfer',pg_temp.finance_id(120)),(select id from integrity_results where kind='first'),'I8 retry reuses the original claim without reserving twice');
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),301,'Synthetic first transfer',pg_temp.finance_id(120))$$,'P0001','Idempotency conflict','I8 changed retry conflicts');

select ok(to_regprocedure('public.review_payment_claim(uuid,uuid,bigint,text,uuid,text)') is null,'I4 evidence-free review function is removed');
select ok(to_regprocedure('public.reconcile_legacy_payment(uuid,uuid,bigint,text,uuid)') is null,'I4 evidence-free reconciliation function is removed');
select throws_ok($$select public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='first'),300,'Synthetic verified evidence',pg_temp.finance_id(130),'verified',null,'transfer')$$,'P0001','Invalid verification evidence','I4 bank date is mandatory');
select public.update_finance_lock_date(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date-1);
select throws_ok($$select public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='first'),300,'Synthetic verified evidence',pg_temp.finance_id(130),'verified',(now() at time zone 'Asia/Bangkok')::date-1,'transfer')$$,'P0001','Finance period is locked','S6 receipt dated on the lock is refused');
select is((select count(*) from public.payments where invoice_id=pg_temp.finance_id(30)),0::bigint,'S6 locked receipt leaves no cash');
select is((select status from public.payment_claims where id=(select id from integrity_results where kind='first')),'pending','S6 locked receipt leaves the claim reviewable');
select lives_ok($$insert into integrity_results select 'receipt',public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='first'),300,'Synthetic verified evidence',pg_temp.finance_id(130),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'S6 receipt after the lock is allowed');
select is((select paid_at from public.payments where id=(select id from integrity_results where kind='receipt')),((now() at time zone 'Asia/Bangkok')::date)::timestamp at time zone 'Asia/Bangkok','I4 paid_at is the verified bank date at Bangkok midnight');
select is((select status::text from public.invoices where id=pg_temp.finance_id(30)),'partially_paid','I8 verifying one claim retains the remaining claims');
select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='first'),300,'Synthetic verified evidence',pg_temp.finance_id(130),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'I4 verified same-key retry is durable');
select public.update_finance_lock_date(pg_temp.finance_id(10),null);
select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='second'),200,'Synthetic older bank evidence',pg_temp.finance_id(131),'verified',(now() at time zone 'Asia/Bangkok')::date-2,'cash')$$,'I4 bank evidence can predate review');
select is((select min((paid_at at time zone 'Asia/Bangkok')::date) from public.payments where invoice_id=pg_temp.finance_id(30)),(now() at time zone 'Asia/Bangkok')::date-2,'I4 bank date survives review without becoming now');
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(30),401,'Synthetic after receipt excess',pg_temp.finance_id(132))$$,'P0001','Report exceeds unclaimed open balance','I8 verified cash and remaining pending claims both reserve balance');

select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.finance_id(10),(select id from integrity_results where kind='portal'),0,'Synthetic rejected duplicate',pg_temp.finance_id(133),'rejected',null,null)$$,'I4 rejection requires no invented bank evidence and creates no receipt');
select is((select count(*) from public.payments where invoice_id=pg_temp.finance_id(30)),2::bigint,'I4 rejecting a claim never creates cash');
select public.update_finance_lock_date(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date-1);
reset role;
select throws_ok($$update public.payments set paid_at=((now() at time zone 'Asia/Bangkok')::date-1)::timestamp at time zone 'Asia/Bangkok' where invoice_id=pg_temp.finance_id(30) and verification_state='verified'$$,'P0001','Finance period is locked','S6 privileged backdating cannot bypass the receipt lock');
select throws_ok($$update public.payments set paid_at=((now() at time zone 'Asia/Bangkok')::date)::timestamp at time zone 'Asia/Bangkok' where invoice_id=pg_temp.finance_id(30) and method='cash'$$,'P0001','Finance period is locked','S6 a closed receipt cannot move to an open date');
select throws_ok($$delete from public.payments where invoice_id=pg_temp.finance_id(30) and method='cash'$$,'P0001','Finance period is locked','S6 a closed receipt cannot be deleted');

select throws_ok($$select private.assert_finance_date_open(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date-1)$$,'P0001','Finance period is locked','S6 corrections use the same inclusive lock boundary');
select throws_ok($$select private.assert_finance_date_open(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date-2)$$,'P0001','Finance period is locked','S6 corrections before the lock are refused');
select lives_ok($$select private.assert_finance_date_open(pg_temp.finance_id(10),(now() at time zone 'Asia/Bangkok')::date)$$,'S6 corrections after the lock are allowed');
insert into public.payments(id,org_id,invoice_id,amount_satang) values(pg_temp.finance_id(150),pg_temp.finance_id(10),pg_temp.finance_id(33),100);
set local role authenticated;
select throws_ok($$select public.reconcile_legacy_payment_with_evidence(pg_temp.finance_id(10),pg_temp.finance_id(150),100,'Synthetic legacy bank evidence',pg_temp.finance_id(151),(now() at time zone 'Asia/Bangkok')::date-1,'transfer')$$,'P0001','Finance period is locked','S6 legacy reconciliation obeys the bank date lock');
select public.update_finance_lock_date(pg_temp.finance_id(10),null);
select lives_ok($$select public.reconcile_legacy_payment_with_evidence(pg_temp.finance_id(10),pg_temp.finance_id(150),100,'Synthetic legacy bank evidence',pg_temp.finance_id(151),(now() at time zone 'Asia/Bangkok')::date-1,'transfer')$$,'S6 legacy receipt retries after unlocking');
select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(35),(select version from public.invoices where id=pg_temp.finance_id(35)),pg_temp.finance_id(140));
reset role;
create function pg_temp.fail_issue_audit() returns trigger language plpgsql as $$
begin
  if new.entity_id=pg_temp.finance_id(31) and new.action='invoice_issued' then raise exception 'Injected issue audit failure';end if;
  return new;
end;
$$;
create trigger test_issue_audit_failure before insert on public.audit_log for each row execute function pg_temp.fail_issue_audit();
set local role authenticated;
select throws_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(31),(select version from public.invoices where id=pg_temp.finance_id(31)),pg_temp.finance_id(160))$$,'P0001','Injected issue audit failure','S12 downstream failure rolls back counter allocation');
reset role;
drop trigger test_issue_audit_failure on public.audit_log;
set local role authenticated;
select lives_ok($$select public.issue_invoice(pg_temp.finance_id(10),pg_temp.finance_id(31),(select version from public.invoices where id=pg_temp.finance_id(31)),pg_temp.finance_id(160))$$,'S12 failed issue can retry its original key');
select is((select number from public.invoices where id=pg_temp.finance_id(31)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000005','S12 rolled-back counter leaves the next number gap free');
reset role;
insert into public.payment_claims(org_id,client_id,invoice_id,amount_satang,reference,idempotency_key)
  select pg_temp.finance_id(10),pg_temp.finance_id(20),pg_temp.finance_id(35),1,'Synthetic reservation '||n,gen_random_uuid() from generate_series(1,1001) n;
set local role authenticated;
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.finance_id(10),pg_temp.finance_id(35),1000,'Synthetic cap probe',pg_temp.finance_id(141))$$,'P0001','Report exceeds unclaimed open balance','I8 aggregate includes more than 1000 pending rows');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.finance_id(2))::text,true);
select throws_ok($$select public.update_finance_lock_date(pg_temp.finance_id(10),null)$$,'P0001','Only staff may change the finance lock date','S6 members cannot change the lock date');
select throws_ok($$select public.cancel_draft_invoice(pg_temp.finance_id(10),pg_temp.finance_id(31))$$,'P0001','Only staff may cancel drafts','B2 members cannot cancel drafts');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.finance_id(3))::text,true);
select lives_ok($$select public.update_finance_lock_date(pg_temp.finance_id(10),null)$$,'S6 admins can change the lock date');
select throws_ok($$select public.update_finance_lock_date(pg_temp.finance_id(999),null)$$,'P0001','Only staff may change the finance lock date','S6 another workspace cannot be changed');
reset role;
select * from finish();
rollback;
