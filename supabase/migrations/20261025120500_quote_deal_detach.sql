create or replace function private.guard_quote_record()
returns trigger language plpgsql set search_path='' as $$
declare subtotal numeric; totals jsonb; project_client uuid;
begin
  if new.discount_satang not between 0 and 9007199254740991 then raise exception 'Invalid quote discount'; end if;
  if tg_op='INSERT' and new.status<>'draft' then raise exception 'New quote must start as draft'; end if;
  if tg_op='UPDATE' then
    if old.status in ('accepted','converted','declined','expired') and
      (new.client_id<>old.client_id or new.number<>old.number or new.discount_satang<>old.discount_satang
       or new.notes is distinct from old.notes or new.issue_date<>old.issue_date or new.valid_until is distinct from old.valid_until or new.prices_include_vat<>old.prices_include_vat) then
      raise exception 'Accepted or terminal agreement content is frozen'; end if;
    if new.status<>old.status and not (
      (old.status='draft' and new.status='sent') or
      (old.status='sent' and new.status in ('accepted','declined','expired')) or
      (old.status in ('accepted','converted') and new.status in ('accepted','converted') and current_user='postgres')) then raise exception 'Invalid quote transition'; end if;
    if (new.converted_invoice_id is distinct from old.converted_invoice_id or
      (old.status in ('accepted','converted') and new.project_id is distinct from old.project_id)) and current_user<>'postgres' then
      raise exception 'Conversion links require the transaction command'; end if;
  end if;
  if new.project_id is not null then
    select client_id into project_client from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or project_client is distinct from new.client_id then raise exception 'Project and quote customer must match'; end if;
  end if;
  -- CRM link maintenance must not recalculate retained commercial content.
  if tg_op='UPDATE' and new.deal_id is distinct from old.deal_id and
    to_jsonb(new)-array['deal_id','updated_at']=to_jsonb(old)-array['deal_id','updated_at'] then return new;end if;
  select coalesce(sum(amount_satang),0) into subtotal from public.quote_items where org_id=new.org_id and quote_id=new.id;
  if subtotal>9007199254740991 then raise exception 'Quote exceeds safe satang bounds'; end if;
  new.subtotal_satang:=subtotal::bigint;
  select private.document_tax_totals(coalesce(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),'[]'),new.discount_satang,new.prices_include_vat,0) into totals from public.quote_items where org_id=new.org_id and quote_id=new.id;
  new.total_satang:=(totals->>'totalSatang')::bigint;new.vat_satang:=(totals->>'vatSatang')::bigint;new.tax_breakdown:=totals->'vatByRate';
  if new.status in ('sent','accepted','converted') and (subtotal<=0 or new.discount_satang>subtotal) then raise exception 'Priced lines and valid discount required'; end if;
  if tg_op='INSERT' then
    if new.accepted_at is not null or new.accepted_by_name is not null or new.accepted_by_email is not null then raise exception 'Acceptance requires a sent quote';end if;
  elsif old.status='sent' and new.status='accepted' then
    if current_user in ('authenticated','service_role') and not private.is_org_staff(new.org_id) then raise exception 'Only staff may accept quotes';end if;
    if new.valid_until is not null and new.valid_until<(now() at time zone 'Asia/Bangkok')::date then raise exception 'Quote expired';end if;
    new.accepted_at:=now();
  elsif new.accepted_at is distinct from old.accepted_at or new.accepted_by_name is distinct from old.accepted_by_name
    or new.accepted_by_email is distinct from old.accepted_by_email then raise exception 'Acceptance evidence is immutable';
  end if;
  return new;
end;
$$;

