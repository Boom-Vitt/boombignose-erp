begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.upgrade_id(n integer) returns uuid language sql immutable as $$
  select ('bf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.upgrade_id(1),'synthetic-upgrade-owner@example.invalid',now()),
  (pg_temp.upgrade_id(2),'synthetic-upgrade-member@example.invalid',now()),
  (pg_temp.upgrade_id(3),'synthetic-upgrade-outsider@example.invalid',now());
insert into public.organizations(id,name,slug) values(pg_temp.upgrade_id(10),'Synthetic legacy seller','synthetic-finance-upgrade');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.upgrade_id(10),pg_temp.upgrade_id(1),'owner'),(pg_temp.upgrade_id(10),pg_temp.upgrade_id(2),'member');
insert into public.clients(id,org_id,name) values(pg_temp.upgrade_id(20),pg_temp.upgrade_id(10),'Synthetic legacy buyer');

-- Postgres reconstructs rows allowed before issue authority; no production bypass is added.
alter table public.invoices disable trigger user;
alter table public.invoice_items disable trigger user;
insert into public.invoices(id,org_id,client_id,number,status,issue_date,amount_satang,subtotal_satang,total_satang,notes) values
  (pg_temp.upgrade_id(30),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000001','sent','2001-01-01',1000,1000,1000,'Original zero-line document'),
  (pg_temp.upgrade_id(31),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'HISTORICAL-PO-42','partially_paid','2002-02-02',1000,1500,1000,'Original mismatched line/header'),
  (pg_temp.upgrade_id(32),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'HISTORICAL-PAID','paid','2003-03-03',1000,1000,1000,'Unverified historical paid assertion'),
  (pg_temp.upgrade_id(33),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'HISTORICAL-SENT-CASH','sent','2004-04-04',1000,1000,1000,'Historical sent with verified cash');
insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position)
  values(pg_temp.upgrade_id(10),pg_temp.upgrade_id(31),'Original historical line',1,777,777,0);
set constraints all immediate;
alter table public.invoice_items enable trigger user;
alter table public.invoices enable trigger user;
insert into public.payments(id,org_id,invoice_id,amount_satang,paid_at,notes) values
  (pg_temp.upgrade_id(40),pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),400,'2001-01-02 00:00:00+07','Original receipt assertion'),
  (pg_temp.upgrade_id(42),pg_temp.upgrade_id(10),pg_temp.upgrade_id(32),1000,'2003-03-04 00:00:00+07','Unverified assertion');
insert into public.payments(id,org_id,invoice_id,amount_satang,paid_at,verification_state,verified_by,verification_reference,command_key) values
  (pg_temp.upgrade_id(41),pg_temp.upgrade_id(10),pg_temp.upgrade_id(31),200,'2002-02-03 00:00:00+07','verified',pg_temp.upgrade_id(1),'Retained bank evidence',pg_temp.upgrade_id(141)),
  (pg_temp.upgrade_id(43),pg_temp.upgrade_id(10),pg_temp.upgrade_id(33),200,'2004-04-05 00:00:00+07','verified',pg_temp.upgrade_id(1),'Retained sent bank evidence',pg_temp.upgrade_id(143));
create temp table original_invoices as select id,to_jsonb(i)-array['version','updated_at','issued_snapshot_id'] as body from public.invoices i where org_id=pg_temp.upgrade_id(10);
create temp table original_payments as select id,to_jsonb(p) as body from public.payments p where org_id=pg_temp.upgrade_id(10);
grant select on original_invoices,original_payments to authenticated;
create function pg_temp.fail_adoption_audit() returns trigger language plpgsql as $$
begin
  if new.entity_id=pg_temp.upgrade_id(33) and new.action='invoice_legacy_adopted' then raise exception 'Injected adoption audit failure';end if;
  return new;
end;
$$;
create trigger fail_adoption_audit before insert on public.audit_log for each row execute function pg_temp.fail_adoption_audit();
create function pg_temp.mutate_adoption() returns trigger language plpgsql as $$
begin
  if old.issued_snapshot_id is null and new.issued_snapshot_id is not null then new.notes:='Unexpected trigger change';end if;
  return new;
end;
$$;
create trigger zz_mutate_adoption before update on public.invoices for each row execute function pg_temp.mutate_adoption();

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.upgrade_id(1))::text,true);
set local role authenticated;
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(97),'Reviewed legacy record')$$,'P0001','Legacy adoption must preserve original invoice','adoption fails closed if a trigger changes original content');
reset role;
drop trigger zz_mutate_adoption on public.invoices;
set local role authenticated;
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),2,pg_temp.upgrade_id(98),'Stale review')$$,'P0001','Legacy payable invoice at expected version required','stale adoption version refused');
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(99),'   ')$$,'P0001','Invalid legacy adoption command','blank audit reason refused');
select public.update_finance_lock_date(pg_temp.upgrade_id(10),(now() at time zone 'Asia/Bangkok')::date-1);
select lives_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(100),'Reviewed historical document and retained receipts')$$,'adopt zero-line legacy in a closed historical period without a current seller profile');
select lives_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(31),1,pg_temp.upgrade_id(101),'Reviewed historical line/header discrepancy')$$,'adopt mismatched historical totals with verified cash');
select lives_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(32),1,pg_temp.upgrade_id(102),'Retain original paid assertion for bank reconciliation')$$,'adopt historical paid assertion without fabricating verified cash');
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(33),1,pg_temp.upgrade_id(103),'Retain sent status and existing bank evidence')$$,'P0001','Injected adoption audit failure','adoption is atomic with its audit event');
select is((select count(*) from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(33)),0::bigint,'failed audit leaves no snapshot');
select ok((select issued_snapshot_id is null and version=1 from public.invoices where id=pg_temp.upgrade_id(33)),'failed audit leaves legacy linkage and version unchanged');
reset role;
select is((select count(*) from public.payment_command_results where org_id=pg_temp.upgrade_id(10) and key=pg_temp.upgrade_id(103)),0::bigint,'failed adoption leaves no command result');
drop trigger fail_adoption_audit on public.audit_log;
set local role authenticated;
select lives_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(33),1,pg_temp.upgrade_id(103),'Retain sent status and existing bank evidence')$$,'adopt historical sent status with verified cash');
select is((select count(*) from public.invoices i join original_invoices o using(id) where to_jsonb(i)-array['version','updated_at','issued_snapshot_id']=o.body),4::bigint,'adoption preserves every original business field');
select is((select count(*) from public.payments p join original_payments o using(id) where to_jsonb(p)=o.body),4::bigint,'adoption does not rewrite receipt dates, values or verification evidence');
select is((select snapshot->>'kind' from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(30)),'legacy_operational_invoice','legacy snapshot is explicitly identified');
select is((select snapshot->'lines' from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(30)),'[]'::jsonb,'zero-line history stays zero-line');
select is((select snapshot->'document'->>'subtotalSatang' from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(31)),'1500','snapshot freezes persisted header without repricing');
select is((select snapshot->'lines'->0->>'amountSatang' from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(31)),'777','snapshot freezes persisted line without balancing it');
select is((select snapshot->'document'->>'issueDate' from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(30)),'2001-01-01','adoption retains original issue date');
select lives_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(100),'Reviewed historical document and retained receipts')$$,'lost adoption response retry returns original snapshot');
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(100),'Changed reason')$$,'P0001','Idempotency conflict','changed adoption retry conflicts');
select is((select count(*) from public.audit_log where org_id=pg_temp.upgrade_id(10) and action='invoice_legacy_adopted'),4::bigint,'one audit event per adoption');
select throws_ok($$select public.reconcile_legacy_payment_with_evidence(pg_temp.upgrade_id(10),pg_temp.upgrade_id(40),400,'Synthetic bank match',pg_temp.upgrade_id(110),(now() at time zone 'Asia/Bangkok')::date-1,'transfer')$$,'P0001','Finance period is locked','adoption does not bypass bank-date period locks');
select lives_ok($$select public.reconcile_legacy_payment_with_evidence(pg_temp.upgrade_id(10),pg_temp.upgrade_id(40),400,'Synthetic bank match',pg_temp.upgrade_id(110),(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'adopted zero-line legacy receipt reconciles');
create temp table upgrade_claims(id uuid);
insert into upgrade_claims select public.submit_internal_payment_claim(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),600,'Synthetic remaining transfer',pg_temp.upgrade_id(111));
select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.upgrade_id(10),(select id from upgrade_claims),600,'Synthetic settlement',pg_temp.upgrade_id(112),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'adopted invoice settles through verified commands');
select is((select status::text from public.invoices where id=pg_temp.upgrade_id(30)),'paid','adopted zero-line invoice becomes paid from bank evidence');
select lives_ok($$select public.reconcile_legacy_payment_with_evidence(pg_temp.upgrade_id(10),pg_temp.upgrade_id(42),1000,'Synthetic historical bank match',pg_temp.upgrade_id(113),(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'adopted historical paid assertion can reconcile');
truncate upgrade_claims;
insert into upgrade_claims select public.submit_internal_payment_claim(pg_temp.upgrade_id(10),pg_temp.upgrade_id(31),800,'Synthetic mismatch settlement',pg_temp.upgrade_id(114));
select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.upgrade_id(10),(select id from upgrade_claims),800,'Synthetic mismatch bank evidence',pg_temp.upgrade_id(115),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'adopted mismatched header settles without recomputing');
select is((select subtotal_satang from public.invoices where id=pg_temp.upgrade_id(31)),1500::bigint,'settlement preserves historical header discrepancy');
select throws_ok($$update public.invoices set subtotal_satang=777 where id=pg_temp.upgrade_id(31)$$,'P0001','Issued tax content is frozen','adoption never permits later header mutation');
select throws_ok($$update public.invoice_items set description='Changed' where invoice_id=pg_temp.upgrade_id(31)$$,'P0001','Issued or payment evidence locks invoice lines','adoption freezes historical lines');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.upgrade_id(2))::text,true);
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(120),'Member attempt')$$,'P0001','Only staff may adopt legacy invoices','member cannot adopt');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.upgrade_id(3))::text,true);
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(30),1,pg_temp.upgrade_id(121),'Cross tenant attempt')$$,'P0001','Only staff may adopt legacy invoices','cross-tenant adoption refused');
reset role;
select ok(not has_function_privilege('anon','public.adopt_legacy_invoice(uuid,uuid,integer,uuid,text)','execute'),'anonymous adoption denied');
select is((select count(*) from public.document_counters where org_id=pg_temp.upgrade_id(10)),0::bigint,'adoption allocates no issued numbers');

insert into public.invoices(id,org_id,client_id,number) select pg_temp.upgrade_id(n),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'CUSTOM-'||n from generate_series(50,54) n;
insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang) select pg_temp.upgrade_id(10),pg_temp.upgrade_id(n),'Synthetic new service',1000 from generate_series(50,54) n;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.upgrade_id(1))::text,true);
set local role authenticated;
select throws_ok($$select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(50),2,pg_temp.upgrade_id(122),'Draft cannot be adopted')$$,'P0001','Legacy payable invoice at expected version required','draft cannot use adoption to bypass issue');
select public.update_tax_business_profile(pg_temp.upgrade_id(10),'Synthetic current seller','Synthetic address','',false,700,false,'');
select lives_ok($$select public.issue_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(50),(select version from public.invoices where id=pg_temp.upgrade_id(50)),pg_temp.upgrade_id(130))$$,'issuance skips historical occupied number when no counter exists');
select is((select number from public.invoices where id=pg_temp.upgrade_id(50)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000002','next unoccupied invoice number allocated');
reset role;
insert into public.invoice_snapshots(org_id,invoice_id,source_version,number,snapshot,issued_by)
  select org_id,pg_temp.upgrade_id(52),1,'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000003',snapshot,pg_temp.upgrade_id(1) from public.invoice_snapshots where invoice_id=pg_temp.upgrade_id(50);
set local role authenticated;
select public.issue_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(53),(select version from public.invoices where id=pg_temp.upgrade_id(53)),pg_temp.upgrade_id(132));
select is((select number from public.invoices where id=pg_temp.upgrade_id(53)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-000004','allocation also skips a number retained only by a snapshot');
reset role;
update public.document_counters set value=0 where org_id=pg_temp.upgrade_id(10) and kind='INV';
insert into public.vendors(id,org_id,name) values(pg_temp.upgrade_id(70),pg_temp.upgrade_id(10),'Synthetic upgrade vendor');
insert into public.purchase_orders(org_id,vendor_id,number) values(pg_temp.upgrade_id(10),pg_temp.upgrade_id(70),'PO-2020-000042');
insert into public.expense_claims(org_id,employee,title,number) values(pg_temp.upgrade_id(10),pg_temp.upgrade_id(1),'Synthetic historical expense','EXP-2020-000005');
select lives_ok($$select private.reconcile_document_counters()$$,'upgrade reconciliation repairs stale counters from invoices and snapshots');
select is((select value from public.document_counters where org_id=pg_temp.upgrade_id(10) and kind='PO' and year=2020),42::bigint,'upgrade reconciles purchase order series by number year');
select is((select value from public.document_counters where org_id=pg_temp.upgrade_id(10) and kind='EXP' and year=2020),5::bigint,'upgrade reconciles expense series by number year');
select is((select value from public.document_counters where org_id=pg_temp.upgrade_id(10) and kind='INV'),4::bigint,'historical high-water mark restored');
update public.document_counters set value=999999 where org_id=pg_temp.upgrade_id(10) and kind='INV';
select private.reconcile_document_counters();
select is((select value from public.document_counters where org_id=pg_temp.upgrade_id(10) and kind='INV'),999999::bigint,'reconciliation never lowers a counter');
set local role authenticated;
select lives_ok($$select public.issue_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(51),(select version from public.invoices where id=pg_temp.upgrade_id(51)),pg_temp.upgrade_id(131))$$,'six digits is a minimum, never a truncation width');
select is((select number from public.invoices where id=pg_temp.upgrade_id(51)),'INV-'||extract(year from now() at time zone 'Asia/Bangkok')::text||'-1000000','large suffix stays intact');
select is((select count(*) from public.invoice_snapshots where org_id=pg_temp.upgrade_id(10) and invoice_id=pg_temp.upgrade_id(50)),1::bigint,'collision skipping creates one snapshot');
reset role;
alter table public.invoices disable trigger user;
insert into public.invoices(id,org_id,client_id,number,status,amount_satang,subtotal_satang,total_satang) values(pg_temp.upgrade_id(60),pg_temp.upgrade_id(10),pg_temp.upgrade_id(20),'HISTORICAL-PAID-NO-RECEIPT','paid',1000,1000,1000);
set constraints all immediate;
alter table public.invoices enable trigger user;
update public.clients set portal_enabled=true,portal_token='synthetic-upgrade-portal' where id=pg_temp.upgrade_id(20);
set local role authenticated;
select public.adopt_legacy_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(60),1,pg_temp.upgrade_id(160),'Historical paid label without receipt evidence');
truncate upgrade_claims;
alter table upgrade_claims add column kind text;
insert into upgrade_claims(id,kind) select public.submit_internal_payment_claim(pg_temp.upgrade_id(10),pg_temp.upgrade_id(60),400,'Synthetic paid staff transfer',pg_temp.upgrade_id(161)),'staff';
grant insert on upgrade_claims to service_role;
set local role service_role;
select lives_ok($$insert into upgrade_claims(id,kind) select public.submit_payment_claim('synthetic-upgrade-portal',pg_temp.upgrade_id(60),600,'Synthetic paid portal transfer',pg_temp.upgrade_id(163)),'portal'$$,'portal reports against adopted paid assertion with open balance');
set local role authenticated;
select lives_ok($$select public.review_payment_claim_with_evidence(pg_temp.upgrade_id(10),(select id from upgrade_claims where kind='staff'),400,'Synthetic paid bank match',pg_temp.upgrade_id(162),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer')$$,'staff report and review work for adopted paid assertion with open balance');
select is((select status::text from public.invoices where id=pg_temp.upgrade_id(60)),'partially_paid','verified cash determines status after historical paid assertion');
select public.review_payment_claim_with_evidence(pg_temp.upgrade_id(10),(select id from upgrade_claims where kind='portal'),600,'Synthetic portal bank match',pg_temp.upgrade_id(164),'verified',(now() at time zone 'Asia/Bangkok')::date,'transfer');
select throws_ok($$select public.submit_internal_payment_claim(pg_temp.upgrade_id(10),pg_temp.upgrade_id(60),1,'Synthetic settled excess',pg_temp.upgrade_id(165))$$,'P0001','Report exceeds unclaimed open balance','paid status allowance cannot over-report a settled invoice');
reset role;
update public.document_counters set value=9223372036854775807 where org_id=pg_temp.upgrade_id(10) and kind='INV';
set local role authenticated;
select throws_ok($$select public.issue_invoice(pg_temp.upgrade_id(10),pg_temp.upgrade_id(54),(select version from public.invoices where id=pg_temp.upgrade_id(54)),pg_temp.upgrade_id(133))$$,'P0001','Invoice number counter exhausted','counter exhaustion is explicit and atomic');
reset role;
select is((select value from public.document_counters where org_id=pg_temp.upgrade_id(10) and kind='INV'),9223372036854775807::bigint,'exhaustion never wraps or consumes a number');
select ok(not has_function_privilege('authenticated','private.allocate_invoice_number(uuid,integer)','execute'),'number allocator is private');
select ok(not has_function_privilege('authenticated','private.reconcile_document_counters()','execute'),'counter reconciliation is private');

select * from finish();
rollback;
