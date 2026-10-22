-- Balances and totals in SQL, so pages never sum rows from a list capped at max_rows.
-- Same payment rules as the dashboard: verified receipts only, an overpaid invoice owes zero.
create view public.invoice_balances with (security_invoker = true) as
select i.org_id, i.id as invoice_id, i.client_id, i.status, i.amount_satang,
  paid.satang::bigint as paid_satang,
  greatest(i.amount_satang - paid.satang, 0)::bigint as outstanding_satang
from public.invoices i
cross join lateral (
  select coalesce(sum(p.amount_satang), 0) as satang
  from public.payments p
  where p.invoice_id = i.id and p.verification_state = 'verified'
) paid;

-- Issued invoices only, like the dashboard's unpaidTotal.
create view public.client_balances with (security_invoker = true) as
select org_id, client_id,
  sum(amount_satang)::bigint as invoiced_satang,
  sum(paid_satang)::bigint as paid_satang,
  sum(outstanding_satang)::bigint as outstanding_satang
from public.invoice_balances
where status not in ('draft', 'cancelled')
group by org_id, client_id;

create view public.project_time_totals with (security_invoker = true) as
select org_id, project_id, sum(minutes)::bigint as minutes
from public.time_entries
group by org_id, project_id;

revoke all on public.invoice_balances, public.client_balances, public.project_time_totals from anon, authenticated;
grant select on public.invoice_balances, public.client_balances, public.project_time_totals to authenticated;
