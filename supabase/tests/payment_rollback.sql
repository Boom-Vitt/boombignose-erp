begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
insert into public.clients(id,org_id,name,portal_enabled,portal_token)
values('ee000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','Rollback fixture',true,'rollback-test-token');
insert into public.invoices(id,org_id,client_id,number,status,amount_satang)
values('ee000000-0000-4000-8000-000000000002','a0000000-0000-0000-0000-000000000001','ee000000-0000-4000-8000-000000000001','ROLLBACK-TEST','draft',10000);
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
select public.update_business_profile('a0000000-0000-0000-0000-000000000001','Synthetic rollback seller','Synthetic address',null,'not_registered');
insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang) values('a0000000-0000-0000-0000-000000000001','ee000000-0000-4000-8000-000000000002','Synthetic service',10000);
select public.issue_invoice('a0000000-0000-0000-0000-000000000001','ee000000-0000-4000-8000-000000000002',(select version from public.invoices where id='ee000000-0000-4000-8000-000000000002'),'ee000000-0000-4000-8000-000000000005');
select public.submit_payment_claim('rollback-test-token','ee000000-0000-4000-8000-000000000002',10000,'report','ee000000-0000-4000-8000-000000000003');
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin if new.action='payment_verified' then raise exception 'Injected audit failure'; end if; return new; end $$;
create trigger test_fail_audit before insert on public.audit_log for each row execute function pg_temp.fail_audit();
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
select throws_ok(format('select public.review_payment_claim_with_evidence(%L,(select id from public.payment_claims where invoice_id=%L),10000,%L,%L,%L,(now() at time zone ''Asia/Bangkok'')::date,''transfer'')',
'a0000000-0000-0000-0000-000000000001','ee000000-0000-4000-8000-000000000002','bank receipt','ee000000-0000-4000-8000-000000000004','verified'),'P0001','Injected audit failure','audit failure rolls back settlement');
select is((select count(*) from public.payments where invoice_id='ee000000-0000-4000-8000-000000000002'),0::bigint,'no orphan receipt');
select is((select count(*) from public.payment_allocations where invoice_id='ee000000-0000-4000-8000-000000000002'),0::bigint,'no orphan allocation');
select is((select status from public.invoices where id='ee000000-0000-4000-8000-000000000002'),'sent'::public.invoice_status,'status unchanged');
select is((select status from public.payment_claims where invoice_id='ee000000-0000-4000-8000-000000000002'),'pending','claim remains reviewable');
select is((select count(*) from public.payment_command_results where key='ee000000-0000-4000-8000-000000000004'),0::bigint,'idempotency command rolls back');
select * from finish();
rollback;
