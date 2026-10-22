-- Earliest open activity per deal for the deals board, aggregated in the database so the
-- API's max_rows cap can't drop a deal's earliest date. security_invoker keeps activities RLS.
-- record_history's sync trigger mirrors record_type='deal' links into deal_id, so deal_id
-- covers both legacy and polymorphic activities.
create view public.deal_next_activity with (security_invoker = true) as
  select org_id, deal_id, min(due_date) as next_due_date, count(*)::integer as open_count
  from public.activities
  where not done and deal_id is not null
  group by org_id, deal_id;

revoke all on public.deal_next_activity from public, anon;
grant select on public.deal_next_activity to authenticated, service_role;
