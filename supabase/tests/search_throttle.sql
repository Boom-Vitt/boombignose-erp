begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id,email,email_confirmed_at) values
  ('b7000000-0000-4000-8000-000000000001','search-a@example.test',now()),
  ('b7000000-0000-4000-8000-000000000002','search-b@example.test',now());

set local role anon;
select throws_ok($$select public.take_search_slot()$$,'42501',null,'anonymous users cannot take search slots');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$delete from private.search_throttle$$,'42501',null,'users cannot reset their own budget');
select is((select count(*)::int from generate_series(1,60) where public.take_search_slot()),60,'sixty searches a minute are allowed');
select is(public.take_search_slot(),false,'the next search in the same minute is refused');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is(public.take_search_slot(),true,'each user has their own budget');
reset role;

update private.search_throttle set minute=minute-interval '1 minute' where user_id='b7000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(public.take_search_slot(),true,'the budget refills the next minute');
reset role;
select is((select count(*)::int from private.search_throttle where user_id='b7000000-0000-4000-8000-000000000001'),1,'past minutes are pruned');

select * from finish();
rollback;
