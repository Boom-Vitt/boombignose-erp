-- VAT registration is tax_status='registered'; derive the flag so the two can never disagree.
alter table public.org_settings drop column vat_registered;
alter table public.org_settings add column vat_registered boolean generated always as (tax_status='registered') stored;

-- The checkbox cannot express "unknown", so an unchecked save keeps an undeclared status.
create or replace function public.update_tax_business_profile(p_org_id uuid,p_legal_name text,p_business_address text,p_tax_id text,p_vat_registered boolean,p_vat_rate_bps integer,p_prices_include_vat boolean,p_branch_label text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may edit business profile';end if;
  if p_vat_registered is null or p_vat_rate_bps is null or p_vat_rate_bps not between 0 and 10000 or p_prices_include_vat is null or length(p_branch_label)>200 then raise exception 'Invalid tax profile';end if;
  perform public.update_business_profile(p_org_id,p_legal_name,p_business_address,p_tax_id,case when p_vat_registered then 'registered'
    when coalesce((select tax_status from public.org_settings where org_id=p_org_id),'unknown')='unknown' then 'unknown' else 'not_registered' end);
  update public.org_settings set vat_rate_bps=p_vat_rate_bps,prices_include_vat=p_prices_include_vat,branch_label=nullif(btrim(p_branch_label),'') where org_id=p_org_id;
end;
$$;

-- Numeric division rounds its quotient, so floor()/round() over it can round twice.
-- div() and mod() are exact; half-up is div(2n+d,2d), as in lib/tax/totals.ts.
create or replace function private.document_tax_totals(p_lines jsonb,p_discount bigint,p_inclusive boolean,p_wht integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare subtotal numeric;discount numeric;vat numeric:=0;base numeric:=0;tax numeric;net numeric;divisor numeric;remaining integer;g record;parts jsonb:='[]';wht numeric;total numeric;
begin
  if p_discount is null or p_discount not between 0 and 9007199254740991 or p_wht is null or p_wht not in (0,100,200,300,500) or p_inclusive is null then raise exception 'Invalid tax inputs';end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l where (l->>'amount_satang')::numeric not between 0 and 9007199254740991 or (l->>'tax_rate_bps')::integer not between 0 and 10000) then raise exception 'Invalid tax line';end if;
  select coalesce(sum((l->>'amount_satang')::numeric),0) into subtotal from jsonb_array_elements(p_lines) l;
  if subtotal>9007199254740991 then raise exception 'Unsafe subtotal';end if;
  -- Drafts can carry a discount before lines are entered; issue validates it strictly.
  discount:=least(p_discount,subtotal);
  select (discount-coalesce(sum(div(discount*amount,nullif(subtotal,0))),0))::integer into remaining
    from (select sum((l->>'amount_satang')::numeric) amount from jsonb_array_elements(p_lines) l group by (l->>'tax_rate_bps')::integer) buckets;
  for g in
    with buckets as (select (l->>'tax_rate_bps')::integer rate,sum((l->>'amount_satang')::numeric) amount from jsonb_array_elements(p_lines) l group by 1)
    select *,row_number() over(order by coalesce(mod(discount*amount,nullif(subtotal,0)),0) desc,rate) rank from buckets order by rate
  loop
    net:=g.amount-coalesce(div(discount*g.amount,nullif(subtotal,0)),0)-case when g.rank<=remaining then 1 else 0 end;
    divisor:=case when p_inclusive then 10000+g.rate else 10000 end;
    tax:=div(2*net*g.rate+divisor,2*divisor);
    vat:=vat+tax;
    base:=base+net-case when p_inclusive then tax else 0 end;
    parts:=parts||jsonb_build_array(jsonb_build_object('rateBps',g.rate,'baseSatang',net-case when p_inclusive then tax else 0 end,'vatSatang',tax));
  end loop;
  total:=base+vat;wht:=div(2*base*p_wht+10000,20000);
  if total>9007199254740991 then raise exception 'Unsafe total';end if;
  return jsonb_build_object('subtotalSatang',subtotal,'baseSatang',base,'vatSatang',vat,'totalSatang',total,'whtSatang',wht,'amountDueSatang',total-wht,'vatByRate',parts);
end;
$$;
