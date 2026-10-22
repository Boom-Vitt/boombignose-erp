-- Project labour cost and profit are management information: members keep hours but read no labour total,
-- since a single contributor or a one-hour change to their own entry would reveal an individual rate.
create or replace function private.project_labour_totals(p_org_id uuid)
returns table(org_id uuid,project_id uuid,labour_cost_satang bigint)
language sql stable security definer set search_path='' as $$
  select t.org_id,t.project_id,sum(div(t.minutes::numeric*coalesce(r.cost_rate_satang,0)+30,60))::bigint
  from public.time_entries t
  left join public.member_cost_rates r on r.org_id=t.org_id and r.user_id=t.user_id
  where t.org_id=p_org_id and private.is_org_staff(p_org_id)
  group by t.org_id,t.project_id;
$$;
revoke all on function private.project_labour_totals(uuid) from public,anon,authenticated;
grant execute on function private.project_labour_totals(uuid) to authenticated;
