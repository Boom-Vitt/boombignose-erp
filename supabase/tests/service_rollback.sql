begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
insert into public.quotes(id,org_id,client_id,number,discount_satang)
values('ee100000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','SERVICE-ROLLBACK',100);
insert into public.quote_items(org_id,quote_id,description,quantity,unit_price_satang) values('a0000000-0000-0000-0000-000000000001','ee100000-0000-4000-8000-000000000001','Work',1,1000);
update public.quotes set status='sent' where id='ee100000-0000-4000-8000-000000000001';
update public.quotes set status='accepted' where id='ee100000-0000-4000-8000-000000000001';
create function pg_temp.fail_conversion() returns trigger language plpgsql as $$ begin if new.action='quote_converted' then raise exception 'Injected conversion audit failure';end if;return new;end $$;
create trigger test_fail_conversion before insert on public.audit_log for each row execute function pg_temp.fail_conversion();
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.convert_accepted_quote('a0000000-0000-0000-0000-000000000001','ee100000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000002')$$,'P0001','Injected conversion audit failure','conversion audit failure rolls back whole service command');
select is((select count(*) from public.projects where source_quote_id='ee100000-0000-4000-8000-000000000001'),0::bigint,'no partial project');
select is((select count(*) from public.milestones where source_quote_id='ee100000-0000-4000-8000-000000000001'),0::bigint,'no partial milestone');
select is((select count(*) from public.invoices where source_quote_id='ee100000-0000-4000-8000-000000000001'),0::bigint,'no partial invoice or linked items');
select is((select status from public.quotes where id='ee100000-0000-4000-8000-000000000001'),'accepted'::public.quote_status,'quote remains accepted');
select is((select count(*) from public.quote_conversion_requests where key='ee100000-0000-4000-8000-000000000002'),0::bigint,'command claim also rolls back');
select * from finish();
rollback;
