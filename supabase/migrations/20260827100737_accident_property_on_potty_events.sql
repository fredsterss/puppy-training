alter table public.puppy_events
  add column if not exists is_accident boolean not null default false;

-- The old model did not record whether a standalone accident was pee or poo.
-- Preserve its time and tags while treating it as a pee accident.
update public.puppy_events
set
  type = 'pee',
  is_accident = true,
  updated_at = now()
where type = 'accident';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'puppy_events_accident_property_check'
      and conrelid = 'public.puppy_events'::regclass
  ) then
    alter table public.puppy_events
      add constraint puppy_events_accident_property_check check (
        not is_accident or type in ('pee', 'poo')
      );
  end if;
end
$$;
