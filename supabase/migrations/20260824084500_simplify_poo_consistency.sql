alter table public.puppy_events
  drop constraint if exists puppy_events_poo_consistency_check;

update public.puppy_events
set
  consistency = case when consistency in ('soft', 'watery') then 'soft' else 'normal' end,
  updated_at = now()
where type = 'poo';

alter table public.puppy_events
  add constraint puppy_events_poo_consistency_check check (
    consistency is null or (type = 'poo' and consistency in ('normal', 'soft'))
  );
