alter table public.activities
  add column completed_by uuid references auth.users(id);

create function private.stamp_activity_completion()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.completed_at := case when new.done then now() end;
    new.completed_by := case when new.done then auth.uid() end;
  elsif new.done is distinct from old.done then
    new.completed_at := case when new.done then now() end;
    new.completed_by := case when new.done then auth.uid() end;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end;
$$;
create trigger stamp_activity_completion before insert or update on public.activities
  for each row execute function private.stamp_activity_completion();

alter table public.activities add constraint activities_completion_time check(done=(completed_at is not null));
create index activities_completed_history_idx on public.activities(org_id,record_type,record_id,completed_at desc,id) where done;
