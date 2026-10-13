-- FK validation takes KEY SHARE. A NO KEY UPDATE lock serializes lifecycle
-- changes without deadlocking distinct command keys holding those FK locks.
create or replace function public.convert_accepted_quote(p_org_id uuid,p_quote_id uuid,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.quotes;request public.quote_conversion_requests;project uuid;milestone uuid;invoice uuid;today date:=(now() at time zone 'Asia/Bangkok')::date;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only owners and admins may convert quotes';end if;
  if p_key is null then raise exception 'Command key required';end if;
  insert into public.quote_conversion_requests(org_id,key,quote_id) values(p_org_id,p_key,p_quote_id) on conflict do nothing;
  select * into request from public.quote_conversion_requests where org_id=p_org_id and key=p_key for update;
  if request.quote_id<>p_quote_id then raise exception 'Idempotency conflict';end if;
  if request.invoice_id is not null then return request.invoice_id;end if;
  select * into q from public.quotes where org_id=p_org_id and id=p_quote_id for no key update;
  if not found then raise exception 'Quote unavailable';end if;
  if q.status='converted' and q.converted_invoice_id is not null then
    update public.quote_conversion_requests set invoice_id=q.converted_invoice_id where org_id=p_org_id and key=p_key;
    return q.converted_invoice_id;
  end if;
  if q.status<>'accepted' or (q.valid_until is not null and q.valid_until<today) then raise exception 'Accepted nonexpired quote required';end if;
  if q.total_satang<=0 or q.discount_satang>q.subtotal_satang then raise exception 'Billable quote required';end if;
  project:=q.project_id;
  if project is not null and not exists(select 1 from public.projects where org_id=p_org_id and id=project and client_id=q.client_id) then raise exception 'Project customer mismatch';end if;
  if project is null then
    insert into public.projects(org_id,client_id,name,budget_satang,source_quote_id) values(p_org_id,q.client_id,'Service '||q.number,q.total_satang,q.id) returning id into project;
  end if;
  insert into public.milestones(org_id,project_id,title,source_quote_id) values(p_org_id,project,'Delivery '||q.number,q.id) returning id into milestone;
  insert into public.invoices(org_id,client_id,project_id,number,status,amount_satang,discount_satang,source_quote_id,source_milestone_id,issue_date,notes)
    values(p_org_id,q.client_id,project,'INV-'||q.number,'draft',0,q.discount_satang,q.id,milestone,today,'From accepted quote '||q.number) returning id into invoice;
  insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position)
    select p_org_id,invoice,description,quantity,unit_price_satang,amount_satang,position from public.quote_items where org_id=p_org_id and quote_id=q.id order by position,id;
  if (select amount_satang from public.invoices where id=invoice and org_id=p_org_id)<>q.total_satang then raise exception 'Conversion totals disagree';end if;
  update public.quotes set status='converted',project_id=project,converted_invoice_id=invoice where id=q.id and org_id=p_org_id;
  insert into public.audit_log(org_id,actor_id,entity,entity_id,action,summary,meta)
    values(p_org_id,auth.uid(),'quote',q.id,'quote_converted','Accepted service quote converted atomically',jsonb_build_object('projectId',project,'milestoneId',milestone,'invoiceId',invoice,'commandKey',p_key));
  update public.quote_conversion_requests set invoice_id=invoice where org_id=p_org_id and key=p_key;
  return invoice;
end;
$$;

create or replace function private.guard_project_removal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.organizations where id=old.org_id) and
    (exists(select 1 from public.quotes where org_id=old.org_id and project_id=old.id and status in ('accepted','converted'))
     or exists(select 1 from public.invoices where org_id=old.org_id and project_id=old.id)) then
      raise exception 'Contracted project requires an explicit correction, not deletion';end if;
  return old;
end;
$$;
create trigger guard_project_removal before delete on public.projects for each row execute function private.guard_project_removal();
