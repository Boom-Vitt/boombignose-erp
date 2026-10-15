-- A password-only (aal1) session of a user with a verified TOTP factor sees no
-- org data and cannot run tenant commands; aal2, or no factor, keeps access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email,email_confirmed_at) values('b9100000-0000-4000-8000-000000000001','mfa-owner@example.test',now());
insert into organizations(id,name,slug) values('b9100000-0000-4000-8000-000000000002','Synthetic MFA org','synthetic-mfa-org');
insert into memberships(org_id,user_id,role) values('b9100000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000001','owner');
insert into clients(org_id,name) values('b9100000-0000-4000-8000-000000000002','Synthetic MFA client');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
values('b9100000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000001','pgtap','totp','verified',now(),now());

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9100000-0000-4000-8000-000000000001","aal":"aal1"}',true);
set local role authenticated;
select is((select count(*) from clients),0::bigint,'aal1 session with a verified factor reads no clients');
select is((select count(*) from memberships),0::bigint,'aal1 session cannot list its memberships');
select is((select count(*) from organizations),0::bigint,'aal1 session cannot read its organization');
select throws_ok($$insert into clients(org_id,name) values('b9100000-0000-4000-8000-000000000002','Forged')$$,'42501',null,'aal1 session cannot write org data');
select throws_ok($$select provision_workspace('Second workspace','b9100000-0000-4000-8000-000000000004')$$,'P0001','Two-factor verification required','aal1 session cannot create a workspace');
select throws_ok($$select accept_workspace_invitation('any-token')$$,'P0001','Two-factor verification required','aal1 session cannot accept an invitation');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9100000-0000-4000-8000-000000000001","aal":"aal2"}',true);
set local role authenticated;
select is((select count(*) from clients),1::bigint,'aal2 session reads its clients');
select is((select count(*) from memberships),1::bigint,'aal2 session lists its membership');
reset role;

-- Unverified (abandoned) enrollment does not demand aal2.
update auth.mfa_factors set status='unverified' where id='b9100000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9100000-0000-4000-8000-000000000001","aal":"aal1"}',true);
set local role authenticated;
select is((select count(*) from clients),1::bigint,'without a verified factor a password session keeps access');
reset role;
select * from finish();
rollback;
