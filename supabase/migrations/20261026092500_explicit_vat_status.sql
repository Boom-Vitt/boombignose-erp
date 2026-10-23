create function public.update_tax_business_profile(p_org_id uuid,p_legal_name text,p_business_address text,p_tax_id text,p_tax_status text,p_vat_rate_bps integer,p_prices_include_vat boolean,p_branch_label text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may edit business profile';end if;
  if p_tax_status is null or p_tax_status not in ('registered','not_registered','unknown') or p_vat_rate_bps is null or p_vat_rate_bps not between 0 and 10000 or p_prices_include_vat is null or length(p_branch_label)>200 then raise exception 'Invalid tax profile';end if;
  perform public.update_business_profile(p_org_id,p_legal_name,p_business_address,p_tax_id,p_tax_status);
  update public.org_settings set vat_rate_bps=p_vat_rate_bps,prices_include_vat=p_prices_include_vat,branch_label=nullif(btrim(p_branch_label),'') where org_id=p_org_id;
end;
$$;
revoke all on function public.update_tax_business_profile(uuid,text,text,text,text,integer,boolean,text) from public,anon,service_role;
grant execute on function public.update_tax_business_profile(uuid,text,text,text,text,integer,boolean,text) to authenticated;
