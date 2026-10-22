-- Per-client balances in SQL, so pages never sum receipts from a list capped at max_rows.
-- Same rules as the dashboard's unpaidTotal: issued invoices only, verified receipts only,
-- an overpaid invoice owes zero.
create view public.client_balances with (security_invoker = true) as
select i.org_id, i.client_id,
  sum(i.amount_satang)::bigint as invoiced_satang,
  sum(paid.satang)::bigint as paid_satang,
  sum(greatest(i.amount_satang - paid.satang, 0))::bigint as outstanding_satang
from public.invoices i
cross join lateral (
  select coalesce(sum(p.amount_satang), 0) as satang
  from public.payments p
  where p.invoice_id = i.id and p.verification_state = 'verified'
) paid
where i.status not in ('draft', 'cancelled')
group by i.org_id, i.client_id;

revoke all on public.client_balances from anon, authenticated;
grant select on public.client_balances to authenticated;
