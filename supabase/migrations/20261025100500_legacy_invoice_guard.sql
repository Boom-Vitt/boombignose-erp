-- Preserve adopted historical totals; keep W4-c source bindings and normal invoice arithmetic.
create or replace function private.guard_commercial_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer uuid;q public.quotes;subtotal numeric;line_count integer;totals jsonb;legacy boolean;
begin
  if tg_op='UPDATE' and new.amount_satang<>old.amount_satang and (old.issued_snapshot_id is not null or (old.source_quote_id is not null and old.quote_invoice_sealed)) then raise exception 'Retained invoice amount cannot be overwritten';end if;
  if tg_op='UPDATE' and old.issued_snapshot_id is not null and
    (new.wht_rate_bps<>old.wht_rate_bps or new.subtotal_satang<>old.subtotal_satang or new.vat_satang<>old.vat_satang or new.total_satang<>old.total_satang or new.wht_satang<>old.wht_satang or new.tax_breakdown<>old.tax_breakdown) then raise exception 'Issued tax content is frozen';end if;
  if tg_op='UPDATE' and new.wht_rate_bps<>old.wht_rate_bps and (old.status<>'draft' or exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') or exists(select 1 from public.payment_claims where org_id=old.org_id and invoice_id=old.id and status='pending')) then raise exception 'Payment evidence locks withholding';end if;
  if new.project_id is not null then
    select client_id into customer from public.projects where org_id=new.org_id and id=new.project_id;
    if not found or customer is distinct from new.client_id then raise exception 'Invoice and project customer must match';end if;
  end if;
  legacy:=tg_op='UPDATE' and exists(select 1 from public.invoice_snapshots s where s.org_id=new.org_id and s.invoice_id=new.id
    and s.id=new.issued_snapshot_id and s.snapshot->>'kind'='legacy_operational_invoice');
  if legacy and to_jsonb(new)-array['status','version','updated_at','issued_snapshot_id'] is distinct from
    to_jsonb(old)-array['status','version','updated_at','issued_snapshot_id'] then raise exception 'Adopted invoice content is frozen';end if;
  if not legacy then
    select coalesce(sum(amount_satang),0),count(*) into subtotal,line_count from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
    if subtotal>9007199254740991 then raise exception 'Invoice exceeds safe satang bounds';end if;
    if line_count>0 then
      select private.document_tax_totals(jsonb_agg(jsonb_build_object('amount_satang',amount_satang,'tax_rate_bps',tax_rate_bps)),new.discount_satang,new.prices_include_vat,new.wht_rate_bps) into totals from public.invoice_items where org_id=new.org_id and invoice_id=new.id;
      new.subtotal_satang:=(totals->>'subtotalSatang')::bigint;new.vat_satang:=(totals->>'vatSatang')::bigint;new.total_satang:=(totals->>'totalSatang')::bigint;new.wht_satang:=(totals->>'whtSatang')::bigint;new.amount_satang:=(totals->>'amountDueSatang')::bigint;new.tax_breakdown:=totals->'vatByRate';
    elsif tg_op='INSERT' or (tg_op='UPDATE' and old.issued_snapshot_id is null) then
      new.subtotal_satang:=case when new.amount_satang=0 then 0 else new.amount_satang+new.discount_satang end;new.total_satang:=new.amount_satang;new.vat_satang:=0;new.wht_satang:=0;new.tax_breakdown:='[]';
      if new.wht_rate_bps<>0 and new.amount_satang>0 then raise exception 'WHT requires priced lines';end if;
    end if;
  end if;
  if new.source_quote_id is not null then
    select * into q from public.quotes where org_id=new.org_id and id=new.source_quote_id;
    if not found or new.client_id<>q.client_id or new.project_id is distinct from q.project_id or new.prices_include_vat<>q.prices_include_vat then
      raise exception 'Source invoice customer/project binding is frozen';end if;
    if tg_op='UPDATE' and old.quote_invoice_sealed and
      (new.discount_satang<>old.discount_satang or new.total_satang<>old.total_satang or new.prices_include_vat<>old.prices_include_vat) then
      raise exception 'Converted invoice must preserve accepted source terms';end if;
  end if;
  if new.source_milestone_id is not null and not exists(select 1 from public.milestones where org_id=new.org_id and id=new.source_milestone_id and project_id=new.project_id and source_quote_id is not distinct from new.source_quote_id) then raise exception 'Source milestone must match invoice agreement and project';end if;
  if tg_op='UPDATE' and new.discount_satang<>old.discount_satang and exists(select 1 from public.payments where org_id=old.org_id and invoice_id=old.id and verification_state='verified') then raise exception 'Verified invoice discount is frozen';end if;
  return new;
end;
$$;

