create table public.gl_accounts (
  org_id uuid not null references public.organizations(id),
  code text not null check (code ~ '^[0-9]{4}$'),
  name_th text not null check (length(btrim(name_th)) between 1 and 200),
  name_en text not null check (length(btrim(name_en)) between 1 and 200),
  kind text not null check (kind in ('asset','liability','equity','income','expense')),
  primary key (org_id, code)
);
alter table public.gl_accounts enable row level security;
alter table public.gl_accounts force row level security;
revoke all on public.gl_accounts from public, anon, authenticated;
grant select on public.gl_accounts to authenticated;
create policy tenant_read on public.gl_accounts for select to authenticated using (private.is_org_member(org_id));

create function public.install_thai_sme_chart(p_org_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may install the chart of accounts'; end if;
  insert into public.gl_accounts(org_id, code, name_th, name_en, kind)
  select p_org_id, v.code, v.name_th, v.name_en, v.kind
  from (values
    ('1110','เงินสด','Cash','asset'),
    ('1120','เงินฝากธนาคาร','Bank','asset'),
    ('1130','ลูกหนี้การค้า','Accounts receivable','asset'),
    ('1140','ภาษีซื้อ','VAT input','asset'),
    ('1150','ภาษีถูกหัก ณ ที่จ่าย','Withholding receivable','asset'),
    ('2110','เจ้าหนี้การค้า','Accounts payable','liability'),
    ('2130','ภาษีขาย','VAT output','liability'),
    ('2140','ภาษีหัก ณ ที่จ่ายค้างจ่าย','Withholding payable','liability'),
    ('3100','ทุน','Owner equity','equity'),
    ('4100','รายได้จากการขาย','Sales','income'),
    ('5100','ต้นทุนขาย','Cost of goods sold','expense'),
    ('6100','ค่าใช้จ่ายในการดำเนินงาน','Operating expense','expense')
  ) as v(code, name_th, name_en, kind)
  where not exists (select 1 from public.gl_accounts existing where existing.org_id = p_org_id and existing.code = v.code);
end;
$$;
revoke all on function public.install_thai_sme_chart(uuid) from public, anon, service_role;
grant execute on function public.install_thai_sme_chart(uuid) to authenticated;
