\set ON_ERROR_STOP on
\ir customer_return_valuation_report.sql

do $$
begin
 if exists(select 1 from pg_temp.customer_return_valuation_preflight) then
  raise exception 'Historical customer-return valuation needs reconciliation; export the preflight report and follow docs/operations/customer-return-reconciliation.md';
 end if;
end;
$$;
