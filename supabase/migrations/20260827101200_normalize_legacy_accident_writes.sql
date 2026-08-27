create or replace function public.normalize_legacy_accident_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'accident' then
    new.type := 'pee';
    new.is_accident := true;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_legacy_accident_event on public.puppy_events;
create trigger normalize_legacy_accident_event
before insert or update on public.puppy_events
for each row execute function public.normalize_legacy_accident_event();
