begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select is((select count(*) from pg_constraint con join pg_class child on child.oid=con.conrelid join pg_class parent on parent.oid=con.confrelid
  join pg_namespace nc on nc.oid=child.relnamespace and nc.nspname='public' join pg_namespace np on np.oid=parent.relnamespace and np.nspname='public'
  where con.contype='f' and array_length(con.conkey,1)=1
    and exists(select 1 from pg_attribute where attrelid=child.oid and attname='org_id' and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid=parent.oid and attname='org_id' and not attisdropped)),0::bigint,'no unqualified FK between tenant-owned tables remains');
select is((select count(*) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and con.contype='f' and array_length(con.conkey,1)>1 and not con.convalidated),0::bigint,'all composite tenant FKs validated');
select * from finish();
rollback;
