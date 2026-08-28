-- ─────────────────────────────────────────────────────────────────────────
-- Grant standard Supabase table/sequence privileges to the API roles.
--
-- Tables in this project are created by the `postgres` role when migrations
-- run. In this environment `postgres`'s default privileges only grant
-- TRUNCATE/REFERENCES/TRIGGER to `anon`/`authenticated`, so the API roles end
-- up WITHOUT select/insert/update/delete — every authenticated read fails with
-- "permission denied for table ...". Row access is meant to be governed by RLS
-- (see 20260630091000_rls_policies.sql), not by withholding table privileges.
--
-- Grant the standard DML privileges (matching Supabase's own default ACL) and
-- set default privileges so future objects created by `postgres` inherit them.
-- RLS policies remain the real access boundary; without a permissive policy a
-- role still sees nothing.
-- ─────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
