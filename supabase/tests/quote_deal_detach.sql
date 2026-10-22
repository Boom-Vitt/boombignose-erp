begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.detach_id(n integer) returns uuid language sql immutable as $$
  select ('bf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.detach_id(1),'synthetic-detach-owner@example.invalid',now());
insert into public.organizations(id,name,slug) values(pg_temp.detach_id(10),'Synthetic quote detach','synthetic-quote-detach');
insert into public.memberships(org_id,user_id,role) values(pg_temp.detach_id(10),pg_temp.detach_id(1),'owner');
insert into public.clients(id,org_id,name) values(pg_temp.detach_id(20),pg_temp.detach_id(10),'Synthetic buyer'),(pg_temp.detach_id(21),pg_temp.detach_id(10),'Other buyer');
insert into public.deals(id,org_id,client_id,title) values
  (pg_temp.detach_id(30),pg_temp.detach_id(10),pg_temp.detach_id(20),'Deal to delete'),
  (pg_temp.detach_id(31),pg_temp.detach_id(10),pg_temp.detach_id(21),'Other customer deal');
insert into public.quotes(id,org_id,client_id,deal_id,number) select pg_temp.detach_id(n),pg_temp.detach_id(10),pg_temp.detach_id(20),pg_temp.detach_id(30),'Synthetic legacy quote '||n from generate_series(40,41) n;
insert into public.quote_items(org_id,quote_id,description,unit_price_satang) select pg_temp.detach_id(10),pg_temp.detach_id(n),'Retained service',1000 from generate_series(40,41) n;
-- Reconstruct terminal historical pricing without repricing it during a CRM unlink.
set constraints all immediate;
alter table public.quotes disable trigger guard_quote_record;
update public.quotes set status=case when id=pg_temp.detach_id(40) then 'accepted'::public.quote_status else 'expired'::public.quote_status end,
  valid_until='2001-01-01',total_satang=1200,accepted_at=case when id=pg_temp.detach_id(40) then '2000-12-01'::timestamptz end,
  accepted_by_name=case when id=pg_temp.detach_id(40) then 'Original accepting buyer' end where org_id=pg_temp.detach_id(10);
alter table public.quotes enable trigger guard_quote_record;
create temp table quote_before as select id,to_jsonb(q)-array['deal_id','updated_at'] body from public.quotes q where org_id=pg_temp.detach_id(10);
grant select on quote_before to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.detach_id(1))::text,true);
set local role authenticated;
select throws_ok($$update public.quotes set deal_id=pg_temp.detach_id(31) where id=pg_temp.detach_id(40)$$,'P0001','Deal and quote customer must match','deal-only exception retains customer binding');
select throws_ok($$update public.quotes set deal_id=null,notes='Changed accepted scope' where id=pg_temp.detach_id(40)$$,'P0001','Accepted or terminal agreement content is frozen','accepted content and deal cannot change together');
select throws_ok($$update public.quotes set deal_id=null,notes='Changed expired scope' where id=pg_temp.detach_id(41)$$,'P0001','Accepted or terminal agreement content is frozen','expired content and deal cannot change together');
select throws_ok($$update public.quotes set deal_id=null,accepted_by_name='Changed buyer' where id=pg_temp.detach_id(40)$$,'P0001','Acceptance evidence is immutable','deal detach cannot rewrite acceptance evidence');
select lives_ok($$delete from public.deals where id=pg_temp.detach_id(30)$$,'delete detaches accepted and expired quotes');
select is((select count(*) from public.quotes where org_id=pg_temp.detach_id(10) and deal_id is null),2::bigint,'both terminal quotes lose only their deal link');
select is((select count(*) from public.quotes q join quote_before b using(id) where to_jsonb(q)-array['deal_id','updated_at']=b.body),2::bigint,'CRM deletion preserves all quote content, pricing and acceptance evidence');
select is((select count(*) from public.quote_items where org_id=pg_temp.detach_id(10)),2::bigint,'CRM deletion retains quote lines');
select * from finish();
rollback;
