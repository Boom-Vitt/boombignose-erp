-- Any member could delete or rewrite a colleague's logged hours, or log hours
-- in a colleague's name. Members now write only their own entries; owners and
-- admins can still correct any.
drop policy tenant_insert on public.time_entries;
drop policy tenant_update on public.time_entries;
drop policy tenant_delete on public.time_entries;
create policy tenant_insert on public.time_entries for insert to authenticated
  with check(private.is_org_staff(org_id) or (private.is_org_member(org_id) and user_id=(select auth.uid())));
create policy tenant_update on public.time_entries for update to authenticated
  using(private.is_org_staff(org_id) or (private.is_org_member(org_id) and user_id=(select auth.uid())))
  with check(private.is_org_staff(org_id) or (private.is_org_member(org_id) and user_id=(select auth.uid())));
create policy tenant_delete on public.time_entries for delete to authenticated
  using(private.is_org_staff(org_id) or (private.is_org_member(org_id) and user_id=(select auth.uid())));
