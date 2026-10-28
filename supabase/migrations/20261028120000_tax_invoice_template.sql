alter table public.org_settings add column tax_invoice_template jsonb not null default '{}'::jsonb;

create function public.save_tax_invoice_template(p_org_id uuid, p_template jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare phone text; branch text; copy text; cleaned jsonb;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may save the tax invoice template'; end if;
  if p_template is null or jsonb_typeof(p_template) <> 'object' then raise exception 'Invalid tax invoice template'; end if;
  if exists (select 1 from jsonb_object_keys(p_template) as key where key not in ('seller_phone','branch_code','copy_label')) then
    raise exception 'Invalid tax invoice template';
  end if;
  phone := btrim(coalesce(p_template->>'seller_phone',''));
  branch := btrim(coalesce(p_template->>'branch_code',''));
  copy := btrim(coalesce(p_template->>'copy_label',''));
  if length(phone) > 40 or length(copy) > 40 then raise exception 'Invalid tax invoice template'; end if;
  if branch <> '' and branch !~ '^[0-9]{5}$' then raise exception 'Invalid tax invoice template'; end if;
  cleaned := jsonb_build_object('seller_phone', phone, 'branch_code', branch, 'copy_label', copy);
  insert into public.org_settings(org_id, tax_invoice_template) values(p_org_id, cleaned)
    on conflict(org_id) do update set tax_invoice_template = excluded.tax_invoice_template;
end;
$$;
revoke all on function public.save_tax_invoice_template(uuid, jsonb) from public, anon, service_role;
grant execute on function public.save_tax_invoice_template(uuid, jsonb) to authenticated;
