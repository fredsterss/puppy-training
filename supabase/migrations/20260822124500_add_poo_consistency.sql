alter table public.puppy_events
  add column if not exists consistency text;

do $$
begin
  alter table public.puppy_events
    add constraint puppy_events_poo_consistency_check check (
      consistency is null or (type = 'poo' and consistency in ('firm', 'normal', 'soft', 'watery'))
    );
exception when duplicate_object then null;
end $$;
