-- Local pgTAP fixture only: model an agreement accepted before its validity
-- ended. Restore enforcement before exercising the real command; rollback all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
insert into public.quotes(id,org_id,client_id,number)
values('ee200000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','EXPIRED-ACCEPTED-TEST');
insert into public.quote_items(org_id,quote_id,description,quantity,unit_price_satang) values('a0000000-0000-0000-0000-000000000001','ee200000-0000-4000-8000-000000000001','Past agreement',1,1000);
update public.quotes set status='sent' where id='ee200000-0000-4000-8000-000000000001';
update public.quotes set status='accepted' where id='ee200000-0000-4000-8000-000000000001';
set constraints all immediate;
alter table public.quotes disable trigger guard_quote_record;
update public.quotes set valid_until=current_date-1 where id='ee200000-0000-4000-8000-000000000001';
alter table public.quotes enable trigger guard_quote_record;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.convert_accepted_quote('a0000000-0000-0000-0000-000000000001','ee200000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000002')$$,'P0001','Accepted nonexpired quote required','accepted agreement that has since expired cannot convert');
select is((select count(*) from public.invoices where source_quote_id='ee200000-0000-4000-8000-000000000001'),0::bigint,'no expired invoice');
select is((select count(*) from public.quote_conversion_requests where key='ee200000-0000-4000-8000-000000000002'),0::bigint,'failed expired command leaves no key claim');
select * from finish();
rollback;
