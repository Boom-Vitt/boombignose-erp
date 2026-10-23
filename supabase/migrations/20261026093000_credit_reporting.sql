create view public.credit_note_revenue with (security_invoker=true) as
select n.org_id,n.id,n.invoice_id,n.issue_date,i.project_id,i.client_id,c.name client_name,
  (n.snapshot->'document'->>'baseSatang')::bigint base_satang,(n.snapshot->'document'->>'totalSatang')::bigint total_satang
from public.credit_notes n join public.invoices i on i.org_id=n.org_id and i.id=n.invoice_id
join public.clients c on c.org_id=i.org_id and c.id=i.client_id;
revoke all on public.credit_note_revenue from anon,authenticated;
grant select on public.credit_note_revenue to authenticated;
