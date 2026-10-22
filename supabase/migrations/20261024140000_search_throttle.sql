-- Per-user budget for the command palette's record search, which fans out six substring scans per call.
-- Kept in Postgres so every app instance shares one count.
create table private.search_throttle (
  user_id uuid not null references auth.users(id) on delete cascade,
  minute timestamptz not null,
  hits integer not null,
  primary key(user_id,minute)
);
revoke all on private.search_throttle from public,anon,authenticated;

create function public.take_search_slot() returns boolean
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then return false; end if;
  delete from private.search_throttle where user_id=uid and minute<date_trunc('minute',now());
  insert into private.search_throttle as t(user_id,minute,hits) values(uid,date_trunc('minute',now()),1)
    on conflict(user_id,minute) do update set hits=t.hits+1
    returning hits into used;
  return used<=60;
end;
$$;
revoke all on function public.take_search_slot() from public,anon;
grant execute on function public.take_search_slot() to authenticated;
