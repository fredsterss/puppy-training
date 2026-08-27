-- Close the deployment window between the initial backfill and the compatibility
-- trigger. Any old cached client writes are canonicalized by the trigger now.
update public.puppy_events
set
  type = 'pee',
  is_accident = true,
  updated_at = now()
where type = 'accident';
