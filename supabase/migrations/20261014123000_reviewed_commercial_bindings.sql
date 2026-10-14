-- Independent review: confirmed invitation recipient and retained source terms.
create or replace function public.accept_workspace_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); email text; invitation public.invitations;
begin
  if actor is null or p_token is null or length(p_token)>200 then raise exception 'Invalid invitation'; end if;
  select lower(u.email) into email from auth.users u where id=actor and u.email_confirmed_at is not null;
  if email is null or email='' then raise exception 'Verified recipient email required'; end if;
  select * into invitation from public.invitations where token=p_token for update;
  if not found or lower(invitation.email)<>email then raise exception 'Invitation unavailable for this recipient'; end if;
  if invitation.status='accepted' and invitation.accepted_by=actor and private.is_org_member(invitation.org_id) then return invitation.org_id; end if;
  if invitation.status<>'pending' or (invitation.expires_at is not null and invitation.expires_at<=now()) then raise exception 'Invitation expired or revoked'; end if;
  insert into public.memberships(org_id,user_id,role) values(invitation.org_id,actor,invitation.role) on conflict(user_id,org_id) do nothing;
  update public.invitations set status='accepted',accepted_by=actor where id=invitation.id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary) values(invitation.org_id,actor,'invitation',invitation.id,'invitation_accepted','Intended recipient accepted invitation');
  return invitation.org_id;
end;
$$;
create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;q public.quotes;subtotal numeric;line_count integer;
begin
  if new.project_id is not null then
    select client_id into customer from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or customer is distinct from new.client_id then raise exception 'Invoice and project customer must match';end if;
  end if;
  select coalesce(sum(amount_satang),0),count(*) into subtotal,line_count from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
  if subtotal>9007199254740991 then raise exception 'Invoice exceeds safe satang bounds';end if;
  if line_count>0 then new.amount_satang:=greatest(0,subtotal-new.discount_satang)::bigint;end if;
  if new.source_quote_id is not null then
    select * into q from public.quotes where org_id=new.org_id and id=new.source_quote_id;
    if not found or new.client_id<>q.client_id or new.project_id is distinct from q.project_id then
      -- During conversion the quote is linked only after its complete invoice exists.
      if q.status<>'accepted' then raise exception 'Source invoice customer/project binding is frozen';end if;
    end if;
    if q.status='converted' and (new.discount_satang<>q.discount_satang or new.amount_satang<>q.total_satang or new.client_id<>q.client_id or new.project_id is distinct from q.project_id) then raise exception 'Converted invoice must preserve accepted source terms';end if;
  end if;
  if new.source_milestone_id is not null and not exists(select 1 from public.milestones where org_id=new.org_id and id=new.source_milestone_id and project_id=new.project_id and source_quote_id is not distinct from new.source_quote_id) then raise exception 'Source milestone must match invoice agreement and project';end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
end;
$$;
create or replace function private.guard_milestone_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source_quote_id is not null and exists(select 1 from public.quotes where org_id=new.org_id and id=new.source_quote_id and status='converted' and project_id is distinct from new.project_id) then raise exception 'Source milestone project binding is frozen';end if;
  return new;
end;
$$;
create trigger guard_milestone_source before insert or update on public.milestones for each row execute function private.guard_milestone_source();
create or replace function private.guard_invoice_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;tenant uuid;amount numeric;parent public.invoices;
begin
  if tg_op='DELETE' then target:=old.invoice_id;tenant:=old.org_id;else target:=new.invoice_id;tenant:=new.org_id;end if;
  if tg_op='UPDATE' and (new.invoice_id<>old.invoice_id or new.org_id<>old.org_id) then raise exception 'Line reassignment forbidden';end if;
  select * into parent from public.invoices where org_id=tenant and id=target for update;
  if not found then if tg_op='DELETE' then return old;end if;raise exception 'Invoice unavailable';end if;
  if parent.source_quote_id is not null and exists(select 1 from public.quotes where org_id=tenant and id=parent.source_quote_id and status='converted') then raise exception 'Converted source invoice lines are frozen';end if;
  if parent.issued_snapshot_id is not null or exists(select 1 from public.payments where org_id=tenant and invoice_id=target and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=tenant and invoice_id=target and status='pending') then raise exception 'Issued or payment evidence locks invoice lines';end if;
  if tg_op='DELETE' then return old;end if;
  if new.quantity<=0 or new.unit_price_satang not between 0 and 9007199254740991 then raise exception 'Invalid line amount';end if;
  amount:=round(new.quantity*new.unit_price_satang);
  if amount not between 0 and 9007199254740991 then raise exception 'Line exceeds safe satang bounds';end if;
  new.amount_satang:=amount::bigint;return new;
end;
$$;
-- Direct caller audit notes remain available, but trusted command evidence cannot be forged.
drop policy audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated with check(private.is_org_member(org_id) and actor_id=(select auth.uid()) and entity not in ('payment','payment_claim','invoice_snapshot') and action not like 'payment_%' and action not in ('invoice_issued','quote_converted','subscription_occurrence_generated','business_profile_updated','workspace_provisioned','invitation_accepted'));
