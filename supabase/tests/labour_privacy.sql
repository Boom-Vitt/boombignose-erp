begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4700000-0000-4000-8000-000000000001','labour-owner@example.invalid',now()),
 ('d4700000-0000-4000-8000-000000000002','labour-admin@example.invalid',now()),
 ('d4700000-0000-4000-8000-000000000003','labour-solo@example.invalid',now()),
 ('d4700000-0000-4000-8000-000000000004','labour-peer@example.invalid',now());
insert into public.organizations(id,name,slug) values('d4700000-0000-4000-8000-000000000010','Labour privacy','labour-privacy-test');
insert into public.memberships(org_id,user_id,role) values
 ('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000001','owner'),
 ('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000002','admin'),
 ('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000003','member'),
 ('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000004','member');
insert into public.projects(id,org_id,name) values
 ('d4700000-0000-4000-8000-000000000030','d4700000-0000-4000-8000-000000000010','Single contributor'),
 ('d4700000-0000-4000-8000-000000000031','d4700000-0000-4000-8000-000000000010','Shared');
insert into public.time_entries(id,org_id,project_id,user_id,minutes,billable,rate_satang) values
 ('d4700000-0000-4000-8000-000000000040','d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000030','d4700000-0000-4000-8000-000000000003',60,false,null),
 ('d4700000-0000-4000-8000-000000000041','d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000031','d4700000-0000-4000-8000-000000000003',30,true,1000),
 ('d4700000-0000-4000-8000-000000000042','d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000031','d4700000-0000-4000-8000-000000000004',60,false,null);

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4700000-0000-4000-8000-000000000001"}',true);
select public.set_member_cost_rate('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000003',12000);
select public.set_member_cost_rate('d4700000-0000-4000-8000-000000000010','d4700000-0000-4000-8000-000000000004',30000);
select results_eq($$select project_id::text,labour_cost_satang from public.project_labour_totals where org_id='d4700000-0000-4000-8000-000000000010' order by 1$$,
 $$values ('d4700000-0000-4000-8000-000000000030',12000::bigint),('d4700000-0000-4000-8000-000000000031',36000::bigint)$$,'owner sees project labour totals');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4700000-0000-4000-8000-000000000002"}',true);
select is((select labour_cost_satang from public.project_labour_totals where project_id='d4700000-0000-4000-8000-000000000031'),36000::bigint,'admin sees project labour totals');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4700000-0000-4000-8000-000000000003"}',true);
select is((select count(*) from public.project_labour_totals),0::bigint,'member reads no labour total from the view');
select is((select count(*) from private.project_labour_totals('d4700000-0000-4000-8000-000000000010')),0::bigint,'member reads no labour total from the aggregate function');
select is((select count(*) from public.member_cost_rates),0::bigint,'member reads no individual cost rate');
select is((select count(*) from public.time_entries where org_id='d4700000-0000-4000-8000-000000000010'),3::bigint,'member still reads the workspace hours');
select lives_ok($$update public.time_entries set minutes=minutes+60 where id='d4700000-0000-4000-8000-000000000040'$$,'member extends own entry by an hour');
select is((select count(*) from public.project_labour_totals),0::bigint,'changing own hours reveals no labour delta');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4700000-0000-4000-8000-000000000004"}',true);
select is((select count(*) from public.project_labour_totals),0::bigint,'another member reads no labour total either');

-- Every database entry point to labour cost must gate on staff, including ones added later.
select is(array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosrc ~* '(member_cost_rates|labour)'
    and has_function_privilege('authenticated',p.oid,'execute') and p.prosrc !~ 'is_org_staff' order by 1),
  '{}'::text[],'every callable function over cost rates or labour requires staff');
select is(array(select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m') and pg_get_viewdef(c.oid) ~* '(member_cost_rates|labour)' order by 1),
  array['project_labour_totals'],'project_labour_totals is the only view over labour cost');
reset role;
select * from finish();
rollback;
