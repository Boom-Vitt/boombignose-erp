create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  booked_on date not null check (isfinite(booked_on)),
  amount_satang bigint not null check (amount_satang <> 0 and amount_satang between -9007199254740991 and 9007199254740991),
  reference text not null check (length(btrim(reference)) between 1 and 200),
  matched_payment_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, matched_payment_id) references public.payments(org_id, id),
  unique (org_id, matched_payment_id)
);
alter table public.bank_lines enable row level security;
alter table public.bank_lines force row level security;
revoke all on public.bank_lines from public, anon, authenticated;
grant select on public.bank_lines to authenticated;
create policy tenant_read on public.bank_lines for select to authenticated using (private.is_org_member(org_id));

create function public.add_bank_line(p_org_id uuid, p_booked_on date, p_amount_satang bigint, p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
declare line_id uuid;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may add a bank line'; end if;
  if p_booked_on is null or not isfinite(p_booked_on) then raise exception 'Invalid bank line date'; end if;
  if p_amount_satang is null or p_amount_satang = 0 or p_amount_satang < -9007199254740991 or p_amount_satang > 9007199254740991 then raise exception 'Invalid bank line amount'; end if;
  if p_reference is null or length(btrim(p_reference)) < 1 or length(btrim(p_reference)) > 200 then raise exception 'Invalid bank line reference'; end if;
  insert into public.bank_lines(org_id, booked_on, amount_satang, reference)
    values (p_org_id, p_booked_on, p_amount_satang, btrim(p_reference))
    returning id into line_id;
  return line_id;
end;
$$;
revoke all on function public.add_bank_line(uuid, date, bigint, text) from public, anon, service_role;
grant execute on function public.add_bank_line(uuid, date, bigint, text) to authenticated;

create function public.match_bank_line(p_org_id uuid, p_line_id uuid, p_payment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare line public.bank_lines; payment public.payments; matches int;
begin
  if not private.is_org_staff(p_org_id) then raise exception 'Only staff may match a bank line'; end if;
  select * into line from public.bank_lines where org_id = p_org_id and id = p_line_id for update;
  if not found then raise exception 'Bank line not found'; end if;
  if line.matched_payment_id is not null then raise exception 'Bank line is already matched'; end if;
  select * into payment from public.payments where org_id = p_org_id and id = p_payment_id;
  if not found or payment.verification_state <> 'verified' or payment.reversal_of is not null then raise exception 'Verified receipt required'; end if;
  if payment.amount_satang <> line.amount_satang or btrim(coalesce(payment.verification_reference, '')) <> btrim(line.reference) then raise exception 'Receipt does not match this bank line'; end if;
  select count(*) into matches from public.payments candidate
    where candidate.org_id = p_org_id
      and candidate.verification_state = 'verified'
      and candidate.reversal_of is null
      and candidate.amount_satang = line.amount_satang
      and btrim(coalesce(candidate.verification_reference, '')) = btrim(line.reference);
  if matches <> 1 then raise exception 'More than one receipt has that amount and reference'; end if;
  if exists (select 1 from public.bank_lines other where other.org_id = p_org_id and other.matched_payment_id = p_payment_id) then raise exception 'Receipt is already matched'; end if;
  update public.bank_lines set matched_payment_id = p_payment_id where org_id = p_org_id and id = p_line_id;
end;
$$;
revoke all on function public.match_bank_line(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.match_bank_line(uuid, uuid, uuid) to authenticated;
