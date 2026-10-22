alter type public.record_type add value if not exists 'expense_claim';
create type public.expense_status as enum ('draft','submitted','approved','rejected','paid');

create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  employee uuid not null references auth.users(id),
  title text not null check(length(btrim(title)) between 1 and 200),
  status public.expense_status not null default 'draft',
  submitted_at timestamptz check(isfinite(submitted_at)),
  decided_by uuid references auth.users(id),
  decided_at timestamptz check(isfinite(decided_at)),
  decision_note text check(length(btrim(decision_note)) between 1 and 2000),
  paid_at timestamptz check(isfinite(paid_at)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id),
  unique(org_id,number),
  check((submitted_at is null)=(status='draft')),
  check((decided_at is null)=(decided_by is null) and (decided_at is null)=(status in ('draft','submitted'))),
  check((decision_note is not null)=(status='rejected')),
  check((paid_at is not null)=(status='paid'))
);
create table public.expense_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null,
  spent_on date not null check(isfinite(spent_on)),
  category public.cost_category not null default 'other',
  description text not null check(length(btrim(description)) between 1 and 1000),
  amount_satang bigint not null check(amount_satang between 1 and 9007199254740991),
  project_id uuid,
  position integer not null default 0 check(position>=0),
  unique(org_id,id),
  foreign key(org_id,claim_id) references public.expense_claims(org_id,id) on delete cascade,
  foreign key(org_id,project_id) references public.projects(org_id,id) on delete set null (project_id)
);
alter table public.costs
  add column expense_claim_id uuid,
  add constraint costs_expense_claim_tenant_fkey foreign key(org_id,expense_claim_id) references public.expense_claims(org_id,id);
create index expense_claims_employee_idx on public.expense_claims(org_id,employee,created_at desc);
create index expense_claims_status_idx on public.expense_claims(org_id,status);
create index expense_lines_claim_idx on public.expense_lines(org_id,claim_id,position);
create index costs_expense_claim_idx on public.costs(org_id,expense_claim_id) where expense_claim_id is not null;

do $$ declare t text; begin
  foreach t in array array['expense_claims','expense_lines'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create trigger guard_tenant_identity before update on public.%I for each row execute function private.guard_tenant_identity()',t);
  end loop;
end $$;
-- Claims change only through the security-definer commands below; members see their own, staff see all.
create policy expense_claims_read on public.expense_claims for select to authenticated
  using(private.is_org_member(org_id) and (employee=(select auth.uid()) or private.is_org_staff(org_id)));
-- The claim subqueries run under the claim read policy, so lines follow claim visibility.
create policy expense_lines_read on public.expense_lines for select to authenticated
  using(exists(select 1 from public.expense_claims c where c.org_id=expense_lines.org_id and c.id=expense_lines.claim_id));
grant insert,delete on public.expense_lines to authenticated;
create policy expense_lines_insert on public.expense_lines for insert to authenticated
  with check(exists(select 1 from public.expense_claims c where c.org_id=expense_lines.org_id and c.id=expense_lines.claim_id and c.employee=(select auth.uid()) and c.status='draft'));
create policy expense_lines_delete on public.expense_lines for delete to authenticated
  using(exists(select 1 from public.expense_claims c where c.org_id=expense_lines.org_id and c.id=expense_lines.claim_id and c.employee=(select auth.uid()) and c.status='draft'));
create trigger set_updated_at before update on public.expense_claims for each row execute function public.set_updated_at();
create trigger log_record_status after update of status on public.expense_claims for each row execute function private.log_record_status('expense_claim');

-- Compare the enum as text so the new label is safe in this migration transaction.
create or replace function private.record_exists(target_org uuid, kind public.record_type, target_id uuid)
returns boolean language sql stable set search_path='' as $$
  select case kind::text
    when 'client' then exists(select 1 from public.clients where org_id=target_org and id=target_id)
    when 'deal' then exists(select 1 from public.deals where org_id=target_org and id=target_id)
    when 'quote' then exists(select 1 from public.quotes where org_id=target_org and id=target_id)
    when 'invoice' then exists(select 1 from public.invoices where org_id=target_org and id=target_id)
    when 'project' then exists(select 1 from public.projects where org_id=target_org and id=target_id)
    when 'subscription' then exists(select 1 from public.subscriptions where org_id=target_org and id=target_id)
    when 'vendor' then exists(select 1 from public.vendors where org_id=target_org and id=target_id)
    when 'purchase_order' then exists(select 1 from public.purchase_orders where org_id=target_org and id=target_id)
    when 'expense_claim' then exists(select 1 from public.expense_claims where org_id=target_org and id=target_id)
    else false end;
$$;
-- Receipts and notes on a claim are as private as the claim itself.
drop policy record_notes_read on public.record_notes;
create policy record_notes_read on public.record_notes for select to authenticated
  using(private.is_org_member(org_id) and (record_type::text<>'expense_claim' or private.record_exists(org_id,record_type,record_id)));
drop policy record_attachments_read on public.record_attachments;
create policy record_attachments_read on public.record_attachments for select to authenticated
  using(private.is_org_member(org_id) and (record_type::text<>'expense_claim' or private.record_exists(org_id,record_type,record_id)));
-- Approval tasks follow claim visibility, and only their assignee or staff may complete or delete them.
create policy expense_claim_activity_read on public.activities as restrictive for select to authenticated
  using(record_type::text is distinct from 'expense_claim' or private.record_exists(org_id,record_type,record_id));
create policy expense_claim_activity_update on public.activities as restrictive for update to authenticated
  using(record_type::text is distinct from 'expense_claim' or owner=(select auth.uid()) or private.is_org_staff(org_id));
create policy expense_claim_activity_delete on public.activities as restrictive for delete to authenticated
  using(record_type::text is distinct from 'expense_claim' or owner=(select auth.uid()) or private.is_org_staff(org_id));

create function private.lock_expense_claim_for_line(p_org_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare claim public.expense_claims;
begin
  select * into claim from public.expense_claims where org_id=p_org_id and id=p_claim_id for no key update;
  if not found or claim.employee is distinct from auth.uid() or not private.is_org_member(p_org_id) then raise exception 'Expense claim unavailable';end if;
  if claim.status<>'draft' then raise exception 'Only draft expense lines are editable';end if;
end;
$$;
revoke all on function private.lock_expense_claim_for_line(uuid,uuid) from public,anon;
grant execute on function private.lock_expense_claim_for_line(uuid,uuid) to authenticated;

create function private.guard_expense_line()
returns trigger language plpgsql set search_path='' as $$
declare target_org uuid; target_claim uuid; total numeric;
begin
  target_org:=case when tg_op='DELETE' then old.org_id else new.org_id end;
  target_claim:=case when tg_op='DELETE' then old.claim_id else new.claim_id end;
  -- Serialize line edits with the transition command, which locks the same claim row.
  if current_user='authenticated' then
    perform private.lock_expense_claim_for_line(target_org,target_claim);
  else
    perform 1 from public.expense_claims where org_id=target_org and id=target_claim for no key update;
  end if;
  if tg_op='DELETE' then return old;end if;
  select coalesce(sum(amount_satang),0)+new.amount_satang into total
    from public.expense_lines where org_id=new.org_id and claim_id=new.claim_id and id<>new.id;
  if total>9007199254740991 then raise exception 'Expense total exceeds safe satang bounds';end if;
  return new;
end;
$$;
create trigger guard_expense_line before insert or update or delete on public.expense_lines for each row execute function private.guard_expense_line();

create function private.guard_expense_cost()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and ((tg_op<>'INSERT' and old.expense_claim_id is not null) or (tg_op<>'DELETE' and new.expense_claim_id is not null)) then
    raise exception 'Expense costs follow their claim';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
create trigger guard_expense_cost before insert or update or delete on public.costs for each row execute function private.guard_expense_cost();

create function public.create_expense_claim(p_org_id uuid,p_title text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; counter bigint; num text; yr integer:=extract(year from (now() at time zone 'Asia/Bangkok'));
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required';end if;
  loop
    insert into public.document_counters(org_id,kind,year,value) values(p_org_id,'EXP',yr,1)
      on conflict(org_id,kind,year) do update set value=document_counters.value+1 returning value into counter;
    num:='EXP-'||yr::text||'-'||lpad(counter::text,greatest(3,length(counter::text)),'0');
    exit when not exists(select 1 from public.expense_claims where org_id=p_org_id and number=num);
  end loop;
  insert into public.expense_claims(org_id,number,employee,title) values(p_org_id,num,auth.uid(),btrim(p_title)) returning id into result;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
    values(p_org_id,auth.uid(),'expense_claim',result,'created','Created expense claim '||num);
  return result;
end;
$$;

-- The one state machine for claims; lib/expenses/flow.ts mirrors its table for the UI.
create function public.transition_expense_claim(p_org_id uuid,p_claim_id uuid,p_status public.expense_status,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare claim public.expense_claims; actor uuid:=auth.uid(); created integer;
  today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_member(p_org_id) then raise exception 'Workspace membership required';end if;
  if p_status is null then raise exception 'Invalid expense transition';end if;
  select * into claim from public.expense_claims where org_id=p_org_id and id=p_claim_id for no key update;
  if not found or (claim.employee<>actor and not private.is_org_staff(p_org_id)) then raise exception 'Expense claim unavailable';end if;
  if claim.status=p_status then return;end if;
  if p_status in ('approved','rejected','paid') then
    if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may decide expense claims';end if;
    if claim.employee=actor then raise exception 'Nobody may decide their own expense claim';end if;
  elsif claim.employee<>actor then raise exception 'Only the claimant may submit, withdraw or reopen an expense claim';
  end if;
  if claim.status::text||'>'||p_status::text not in ('draft>submitted','submitted>draft','submitted>approved','submitted>rejected','approved>rejected','approved>paid','rejected>draft') then
    raise exception 'Invalid expense transition';
  end if;
  if p_status='submitted' then
    if not exists(select 1 from public.expense_lines where org_id=p_org_id and claim_id=claim.id) then raise exception 'Add expense lines first';end if;
    update public.expense_claims set status='submitted',submitted_at=now() where org_id=p_org_id and id=claim.id;
    insert into public.activities(org_id,record_type,record_id,owner,type,due_date,body)
      select p_org_id,'expense_claim',claim.id,m.user_id,'follow_up',today,'Review expense claim '||claim.number
      from public.memberships m where m.org_id=p_org_id and m.role in ('owner','admin') and m.user_id<>claim.employee;
  elsif p_status='approved' then
    -- Every member reads costs, so they carry the claim number but not the claimant or line text.
    insert into public.costs(org_id,category,amount_satang,incurred_on,project_id,vendor,bill_number,notes,expense_claim_id)
      select p_org_id,l.category,l.amount_satang,l.spent_on,l.project_id,'Employee expense',claim.number,'Expense claim '||claim.number,claim.id
      from public.expense_lines l where l.org_id=p_org_id and l.claim_id=claim.id;
    get diagnostics created=row_count;
    update public.expense_claims set status='approved',decided_by=actor,decided_at=now() where org_id=p_org_id and id=claim.id;
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
      values(p_org_id,actor,'expense_claim',claim.id,'approved','Approved expense claim '||claim.number,jsonb_build_object('costs',created));
  elsif p_status='rejected' then
    if nullif(btrim(p_note),'') is null then raise exception 'Rejection reason required';end if;
    delete from public.costs where org_id=p_org_id and expense_claim_id=claim.id;
    update public.expense_claims set status='rejected',decided_by=actor,decided_at=now(),decision_note=btrim(p_note) where org_id=p_org_id and id=claim.id;
    insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary)
      values(p_org_id,actor,'expense_claim',claim.id,'rejected','Rejected expense claim '||claim.number||': '||btrim(p_note));
  elsif p_status='paid' then
    update public.expense_claims set status='paid',paid_at=now() where org_id=p_org_id and id=claim.id;
    update public.costs set paid_at=now() where org_id=p_org_id and expense_claim_id=claim.id;
  elsif p_status='draft' then
    update public.expense_claims set status='draft',submitted_at=null,decided_by=null,decided_at=null,decision_note=null where org_id=p_org_id and id=claim.id;
  end if;
  if p_status in ('approved','rejected','draft') then
    update public.activities set done=true where org_id=p_org_id and record_type='expense_claim' and record_id=claim.id and not done;
  end if;
end;
$$;

revoke all on function public.create_expense_claim(uuid,text), public.transition_expense_claim(uuid,uuid,public.expense_status,text) from public,anon;
grant execute on function public.create_expense_claim(uuid,text), public.transition_expense_claim(uuid,uuid,public.expense_status,text) to authenticated;
