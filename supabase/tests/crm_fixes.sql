begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
select plan(22);
create function pg_temp.fix_id(n integer) returns uuid language sql immutable as $$
  select ('c4e10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.fix_id(1),'crm-fix-owner@example.test',now()),
  (pg_temp.fix_id(2),'crm-fix-outsider@example.test',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.fix_id(10),'CRM fixes','crm-fixes-a'),
  (pg_temp.fix_id(20),'Other CRM fixes','crm-fixes-b');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.fix_id(10),pg_temp.fix_id(1),'owner'),
  (pg_temp.fix_id(20),pg_temp.fix_id(2),'owner');
insert into public.clients(id,org_id,name) values
  (pg_temp.fix_id(100),pg_temp.fix_id(10),'Buyer'),
  (pg_temp.fix_id(101),pg_temp.fix_id(10),'Other buyer');
insert into public.deals(id,org_id,client_id,title,created_at) values
  (pg_temp.fix_id(201),pg_temp.fix_id(10),pg_temp.fix_id(100),'Expired quote deal',now()-interval '3 days'),
  (pg_temp.fix_id(202),pg_temp.fix_id(10),pg_temp.fix_id(100),'Undeletable deal',now()-interval '2 days'),
  (pg_temp.fix_id(203),pg_temp.fix_id(10),pg_temp.fix_id(100),'Quoted deal',now()-interval '1 day'),
  (pg_temp.fix_id(204),pg_temp.fix_id(10),pg_temp.fix_id(101),'Unquoted deal',now());
insert into public.activities(id,org_id,deal_id,type,body) values
  (pg_temp.fix_id(501),pg_temp.fix_id(10),pg_temp.fix_id(201),'call','Call about the expired quote'),
  (pg_temp.fix_id(502),pg_temp.fix_id(10),pg_temp.fix_id(202),'call','Call about the undeletable deal');
-- An accepted quote past its valid-until date, linked to the deal being deleted.
insert into public.quotes(id,org_id,client_id,deal_id,number) values
  (pg_temp.fix_id(301),pg_temp.fix_id(10),pg_temp.fix_id(100),pg_temp.fix_id(201),'CRM-FIX-1'),
  (pg_temp.fix_id(302),pg_temp.fix_id(10),pg_temp.fix_id(100),pg_temp.fix_id(203),'CRM-FIX-2');
insert into public.quote_items(org_id,quote_id,description,unit_price_satang) values
  (pg_temp.fix_id(10),pg_temp.fix_id(301),'Retained service',1000);
set constraints all immediate;
alter table public.quotes disable trigger guard_quote_record;
update public.quotes set status='accepted',valid_until='2001-01-01',accepted_at='2000-12-01',accepted_by_name='Original buyer'
  where id=pg_temp.fix_id(301);
alter table public.quotes enable trigger guard_quote_record;
create temp table quote_before as select to_jsonb(q)-array['deal_id','updated_at'] body from public.quotes q where id=pg_temp.fix_id(301);
grant select on quote_before to authenticated;
-- Something that refuses one deal's deletion after its activities were detached.
create function pg_temp.refuse_delete() returns trigger language plpgsql as $$
begin raise exception 'Refused for test'; end;
$$;
create trigger refuse_delete before delete on public.deals for each row when (old.title='Undeletable deal') execute function pg_temp.refuse_delete();

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.fix_id(1))::text,true);
set local role authenticated;

-- Deleting a deal is one command: detach activities and delete together, or neither.
select throws_ok($$select public.delete_deal(pg_temp.fix_id(10),pg_temp.fix_id(202))$$,'P0001','Refused for test','a refused delete fails');
select ok((select deal_id=pg_temp.fix_id(202) and record_type='deal' from public.activities where id=pg_temp.fix_id(502)),'a refused delete keeps the activities on the deal');
select is(public.delete_deal(pg_temp.fix_id(10),pg_temp.fix_id(201)),'Expired quote deal','a deal with an expired accepted quote is deleted and its title returned');
select is((select count(*)::int from public.deals where id=pg_temp.fix_id(201)),0,'the deal is gone');
select ok((select deal_id is null and client_id=pg_temp.fix_id(100) and record_type='client' from public.activities where id=pg_temp.fix_id(501)),'its activities move to the client');
select ok((select q.deal_id is null and to_jsonb(q)-array['deal_id','updated_at']=b.body from public.quotes q,quote_before b where q.id=pg_temp.fix_id(301)),'the expired accepted quote is unlinked with its content unchanged');
select throws_ok($$select public.delete_deal(pg_temp.fix_id(10),pg_temp.fix_id(201))$$,'P0002','Deal not found','deleting a deal that no longer exists fails');

-- Quote and deal customers match from both sides.
select throws_ok($$update public.deals set client_id=pg_temp.fix_id(101) where id=pg_temp.fix_id(203)$$,'23503',null,'a quoted deal cannot move to another customer');
select is((select client_id from public.deals where id=pg_temp.fix_id(203)),pg_temp.fix_id(100),'the quoted deal keeps its customer');
select lives_ok($$update public.deals set client_id=pg_temp.fix_id(100) where id=pg_temp.fix_id(204)$$,'a deal without quotes can change customer');
select throws_ok($$update public.quotes set client_id=pg_temp.fix_id(101) where id=pg_temp.fix_id(302)$$,null,'Deal and quote customer must match','a linked quote cannot move to another customer');

-- A probability named in the same write as a stage change is kept, even when it equals the old one.
update public.deals set probability=40 where id=pg_temp.fix_id(203);
update public.deals set stage='proposal',probability=40 where id=pg_temp.fix_id(203);
select is((select probability::int from public.deals where id=pg_temp.fix_id(203)),40,'an explicit probability equal to the previous one survives a stage change');
update public.deals set stage='negotiation' where id=pg_temp.fix_id(203);
select is((select probability::int from public.deals where id=pg_temp.fix_id(203)),70,'a stage change that names no probability takes the stage default');
update public.deals set stage='discovery',probability=null where id=pg_temp.fix_id(203);
select is((select probability::int from public.deals where id=pg_temp.fix_id(203)),30,'an explicit null takes the stage default');
update public.deals set title='Quoted deal renamed',probability=55 where id=pg_temp.fix_id(203);
update public.deals set stage='proposal',title='Quoted deal' where id=pg_temp.fix_id(203);
select is((select probability::int from public.deals where id=pg_temp.fix_id(203)),50,'an earlier explicit write does not carry over to the next stage change');

-- A lost move and its closing note are one command.
select throws_ok($$select public.move_deal(pg_temp.fix_id(10),pg_temp.fix_id(203),'lost',null,(select id from public.deal_lost_reasons where org_id=pg_temp.fix_id(10) and name='No budget'),'  ')$$,
  '23514',null,'a closing note that cannot be saved fails the move');
select is((select stage::text from public.deals where id=pg_temp.fix_id(203)),'proposal','a failed closing note leaves the deal where it was');
select is(public.move_deal(pg_temp.fix_id(10),pg_temp.fix_id(203),'lost',null,(select id from public.deal_lost_reasons where org_id=pg_temp.fix_id(10) and name='No budget'),'Lost: Went in-house')::text,
  'proposal','a lost move with a closing note succeeds');
select ok((select d.stage='lost' and n.body='Lost: Went in-house' and n.author=pg_temp.fix_id(1)
  from public.deals d join public.record_notes n on n.org_id=d.org_id and n.record_type='deal' and n.record_id=d.id where d.id=pg_temp.fix_id(203)),
  'the deal is lost and the closing note is in its history');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.fix_id(2))::text,true);
set local role authenticated;
select throws_ok($$select public.delete_deal(pg_temp.fix_id(10),pg_temp.fix_id(204))$$,'42501',null,'outsiders cannot delete deals');
reset role;

-- A repeat web-form enquiry locks the open deal it reuses until the submission commits.
insert into public.contacts(org_id,client_id,name,email) values(pg_temp.fix_id(10),pg_temp.fix_id(100),'Repeat visitor','repeat@example.test');
insert into public.lead_forms(id,org_id,token,name,default_owner) values(pg_temp.fix_id(600),pg_temp.fix_id(10),repeat('f',43),'Fix form',pg_temp.fix_id(1));
set local role service_role;
select is(public.submit_lead_form(repeat('f',43),repeat('d',64),'Repeat visitor','','repeat@example.test','','Second enquiry',''),'success','the repeat enquiry is accepted');
reset role;
select is((select modes::text from extensions.pgrowlocks('public.deals') l join public.deals d on d.ctid=l.locked_row where d.id=pg_temp.fix_id(204)),
  '{"For Update"}','the reused deal is locked for update through the attachment writes');

select * from finish();
rollback;
