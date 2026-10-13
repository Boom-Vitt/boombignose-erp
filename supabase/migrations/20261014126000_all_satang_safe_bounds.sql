-- The JS/API contract applies to all integer-satang fields, not only receipts.
-- Existing records are preserved; validation is an explicit upgrade preflight.
do $$
declare field record;
begin
  for field in select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_attribute a on a.attrelid=c.oid and not a.attisdropped and a.attnum>0 and a.atttypid='bigint'::regtype
    where c.relkind='r' and right(a.attname,7)='_satang'
  loop
    execute format('alter table public.%I add constraint %I check(%I between -9007199254740991 and 9007199254740991) not valid',field.relname,field.relname||'_'||field.attname||'_safe_integer',field.attname);
  end loop;
end $$;
