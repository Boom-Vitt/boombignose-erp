begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.history_id(n integer) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.history_id(1),'history-member@example.invalid',now()),
  (pg_temp.history_id(2),'history-outsider@example.invalid',now()),
  (pg_temp.history_id(3),'history-dual@example.invalid',now());
insert into public.organizations(id,name,slug) values
  (pg_temp.history_id(10),'History workspace','history-test-a'),
  (pg_temp.history_id(20),'Other history workspace','history-test-b');
insert into public.memberships(org_id,user_id,role) values
  (pg_temp.history_id(10),pg_temp.history_id(1),'member'),
  (pg_temp.history_id(20),pg_temp.history_id(2),'owner'),
  (pg_temp.history_id(10),pg_temp.history_id(3),'owner'),
  (pg_temp.history_id(20),pg_temp.history_id(3),'owner');
insert into public.clients(id,org_id,name) values
  (pg_temp.history_id(100),pg_temp.history_id(10),'History client'),
  (pg_temp.history_id(200),pg_temp.history_id(20),'Foreign client');
insert into public.deals(id,org_id,client_id,title) values(pg_temp.history_id(101),pg_temp.history_id(10),pg_temp.history_id(100),'History deal');
insert into public.quotes(id,org_id,client_id,number) values(pg_temp.history_id(102),pg_temp.history_id(10),pg_temp.history_id(100),'HISTORY-Q');
insert into public.quote_items(org_id,quote_id,description,quantity,unit_price_satang) values(pg_temp.history_id(10),pg_temp.history_id(102),'History test service',1,100);
insert into public.invoices(id,org_id,client_id,number) values(pg_temp.history_id(103),pg_temp.history_id(10),pg_temp.history_id(100),'HISTORY-I');
insert into public.projects(id,org_id,name) values(pg_temp.history_id(104),pg_temp.history_id(10),'History project');
insert into public.subscriptions(id,org_id,client_id,name) values(pg_temp.history_id(105),pg_temp.history_id(10),pg_temp.history_id(100),'History subscription');

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.record_notes'::regclass,'public.record_attachments'::regclass)), 'new tables enable and force RLS');
select is((select public from storage.buckets where id='record-attachments'),false,'attachment bucket is private');
select is((select file_size_limit from storage.buckets where id='record-attachments'),10485760::bigint,'bucket enforces ten MB');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='activities_record_idx'),'record activity index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='activities_owner_due_idx'),'personal activity index exists');

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.history_id(1))::text,true);
set local role authenticated;
select is((select count(*) from public.record_activity_assignees(pg_temp.history_id(10))),2::bigint,'member can resolve all workspace assignees despite own-only memberships RLS');
select throws_ok($$select * from public.record_activity_assignees(pg_temp.history_id(20))$$,'P0001','Workspace membership required','assignees RPC denies foreign workspace');
select lives_ok($$insert into public.activities(org_id,record_type,record_id,owner) values(pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(3))$$,'member can assign an activity to a teammate');
select lives_ok($$insert into public.record_notes(id,org_id,record_type,record_id,author,body) values(pg_temp.history_id(300),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(1),'A member note')$$,'members can append notes in their workspace');
select throws_ok($$insert into public.record_notes(org_id,record_type,record_id,author,body) values(pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(2),'Forged author')$$,'42501',null,'note author cannot be forged');
select throws_ok($$insert into public.record_notes(org_id,record_type,record_id,author,body) values(pg_temp.history_id(20),'client',pg_temp.history_id(200),pg_temp.history_id(1),'Foreign note')$$,'42501',null,'foreign workspace note insert denied');
select throws_ok($$insert into public.record_notes(org_id,record_type,record_id,author,body) values(pg_temp.history_id(10),'client',pg_temp.history_id(999),pg_temp.history_id(1),'Missing record')$$,'42501',null,'note target must exist');
select lives_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(301),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(301),'scope.pdf',10,'application/pdf',pg_temp.history_id(1))$$,'members can append attachment metadata');
select throws_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(302),pg_temp.history_id(10),'client',pg_temp.history_id(100),'foreign/path','scope.pdf',10,'application/pdf',pg_temp.history_id(1))$$,'23514',null,'metadata path must match org and record identity');
select throws_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(302),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(302),'scope.pdf',10485761,'application/pdf',pg_temp.history_id(1))$$,'23514',null,'oversized metadata rejected');
select throws_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(302),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(302),'page.html',10,'text/html',pg_temp.history_id(1))$$,'23514',null,'active content MIME type rejected');
select throws_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(302),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(302),'scope.pdf',10,'application/pdf',pg_temp.history_id(2))$$,'42501',null,'uploader cannot be forged');

select throws_ok($$insert into public.record_attachments(id,org_id,record_type,record_id,path,filename,size,content_type,uploaded_by) values(pg_temp.history_id(302),pg_temp.history_id(20),'client',pg_temp.history_id(200),pg_temp.history_id(20)||'/client/'||pg_temp.history_id(200)||'/'||pg_temp.history_id(302),'scope.pdf',10,'application/pdf',pg_temp.history_id(1))$$,'42501',null,'foreign workspace attachment insert denied');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('record-attachments',pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(301),pg_temp.history_id(1)::text)$$,'member can upload a scoped storage object');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('record-attachments',pg_temp.history_id(20)||'/client/'||pg_temp.history_id(200)||'/'||pg_temp.history_id(302),pg_temp.history_id(1)::text)$$,'42501',null,'foreign workspace storage upload denied');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('record-attachments',pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(302),pg_temp.history_id(2)::text)$$,'42501',null,'storage owner cannot be forged');
select set_config('storage.allow_delete_query','true',true);
select lives_ok($$delete from storage.objects where bucket_id='record-attachments' and name=pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(301)$$,'retained storage delete does not throw');
select is((select count(*) from storage.objects where bucket_id='record-attachments' and name=pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(301)),1::bigint,'retained attachment cannot be deleted through cleanup policy');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('record-attachments',pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(303),pg_temp.history_id(1)::text)$$,'uncommitted storage upload supported');
select lives_ok($$delete from storage.objects where bucket_id='record-attachments' and name=pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(303)$$,'uploader can clean up uncommitted upload');
select is((select count(*) from storage.objects where bucket_id='record-attachments' and name=pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(303)),0::bigint,'uncommitted upload was removed');

select lives_ok($$insert into public.activities(id,org_id,deal_id,client_id,type,body) values(pg_temp.history_id(400),pg_temp.history_id(10),pg_temp.history_id(101),pg_temp.history_id(100),'call','Legacy call')$$,'legacy deal activity insert still works');
select is((select record_type::text from public.activities where id=pg_temp.history_id(400)),'deal','deal takes primary precedence over client');
select is((select record_id from public.activities where id=pg_temp.history_id(400)),pg_temp.history_id(101),'legacy link synchronizes record id');
select lives_ok($$insert into public.activities(id,org_id,record_type,record_id,owner,type,due_date) values(pg_temp.history_id(401),pg_temp.history_id(10),'client',pg_temp.history_id(100),pg_temp.history_id(1),'call','2026-10-23')$$,'polymorphic client activity insert works');
select is((select client_id from public.activities where id=pg_temp.history_id(401)),pg_temp.history_id(100),'new client target populates legacy link');
select lives_ok($$insert into public.activities(id,org_id,record_type,record_id) values(pg_temp.history_id(402),pg_temp.history_id(10),'deal',pg_temp.history_id(101))$$,'polymorphic deal activity insert works');
select is((select client_id from public.activities where id=pg_temp.history_id(402)),pg_temp.history_id(100),'new deal target retains linked client');
select lives_ok($$insert into public.activities(org_id,record_type,record_id) values(pg_temp.history_id(10),'quote',pg_temp.history_id(102)),(pg_temp.history_id(10),'invoice',pg_temp.history_id(103)),(pg_temp.history_id(10),'project',pg_temp.history_id(104)),(pg_temp.history_id(10),'subscription',pg_temp.history_id(105))$$,'all six record kinds support activities');
select throws_ok($$insert into public.activities(org_id,record_type,record_id,client_id) values(pg_temp.history_id(10),'quote',pg_temp.history_id(102),pg_temp.history_id(100))$$,'P0001','Conflicting activity record links','conflicting explicit legacy targets rejected');
select throws_ok($$insert into public.activities(org_id,record_type) values(pg_temp.history_id(10),'quote')$$,'P0001','Record type and id must be supplied together','partial record pair rejected');
select throws_ok($$insert into public.activities(org_id,record_type,record_id,owner) values(pg_temp.history_id(10),'quote',pg_temp.history_id(102),pg_temp.history_id(2))$$,'P0001','Assignee not found in workspace','foreign assignee rejected');
select lives_ok($$update public.activities set deal_id=null where id=pg_temp.history_id(400)$$,'legacy deal detach still works');
select is((select record_type::text from public.activities where id=pg_temp.history_id(400)),'client','deal detach falls back to retained client');
select lives_ok($$delete from public.projects where id=pg_temp.history_id(104)$$,'deleting a target preserves historical activities');
select lives_ok($$update public.activities set done=true where record_type='project' and record_id=pg_temp.history_id(104)$$,'activities can be completed after target deletion');
select lives_ok($$update public.activities set done=true where id=pg_temp.history_id(401)$$,'mark done works');
select ok((select completed_at is not null from public.activities where id=pg_temp.history_id(401)),'mark done stamps completion');
select lives_ok($$update public.activities set body='Edited',completed_at='2000-01-01' where id=pg_temp.history_id(401)$$,'unrelated edit remains supported');
select ok((select completed_at>'2026-01-01' from public.activities where id=pg_temp.history_id(401)),'unrelated edit cannot move completion time');
select lives_ok($$update public.activities set done=false where id=pg_temp.history_id(401)$$,'legacy reopen works');
select ok((select completed_at is null from public.activities where id=pg_temp.history_id(401)),'reopening clears completion time');
select throws_ok($$update public.activities set org_id=pg_temp.history_id(20) where id=pg_temp.history_id(401)$$,'P0001','Tenant and record identity are immutable','new columns cannot bypass tenant identity guard');
select ok(private.can_access_record_attachment(pg_temp.history_id(10)||'/client/'||pg_temp.history_id(100)||'/'||pg_temp.history_id(301)),'member may access own workspace storage path');
select ok(not private.can_access_record_attachment(pg_temp.history_id(20)||'/client/'||pg_temp.history_id(200)||'/'||pg_temp.history_id(301)),'foreign workspace storage path denied');
select ok(not private.can_access_record_attachment('../client/invalid/file'),'malformed storage path denied');
select ok(not private.can_access_record_attachment(pg_temp.history_id(10)||'/client/'||pg_temp.history_id(200)||'/'||pg_temp.history_id(301)),'cross-workspace target storage path denied');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.history_id(2))::text,true);
set local role authenticated;
select is((select count(*) from public.record_notes where org_id=pg_temp.history_id(10)),0::bigint,'outsider cannot read notes');
select is((select count(*) from storage.objects where bucket_id='record-attachments' and name like pg_temp.history_id(10)||'/%'),0::bigint,'outsider cannot read storage objects');
select is((select count(*) from public.record_attachments where org_id=pg_temp.history_id(10)),0::bigint,'outsider cannot read attachment metadata');
select is((select count(*) from public.activities where org_id=pg_temp.history_id(10)),0::bigint,'outsider cannot read activity record links');
reset role;

select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.history_id(3))::text,true);
set local role authenticated;
select throws_ok($$insert into public.record_notes(org_id,record_type,record_id,author,body) values(pg_temp.history_id(10),'client',pg_temp.history_id(200),pg_temp.history_id(3),'Dual-org forgery')$$,'42501',null,'dual-org membership cannot forge note target');
select throws_ok($$insert into public.activities(org_id,record_type,record_id) values(pg_temp.history_id(10),'client',pg_temp.history_id(200))$$,'P0001','Record not found in workspace','dual-org membership cannot forge activity target');
select lives_ok($$update public.quotes set status='sent' where id=pg_temp.history_id(102)$$,'status changes remain supported');
select is((select meta->>'from' from public.audit_log where entity_id=pg_temp.history_id(102) and action='record_status_changed'),'draft','status history records prior state');
select is((select meta->>'to' from public.audit_log where entity_id=pg_temp.history_id(102) and action='record_status_changed'),'sent','status history records next state');
reset role;
select * from finish();
rollback;
