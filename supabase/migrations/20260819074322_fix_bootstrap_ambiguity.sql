create or replace function public.bootstrap_household(access_key_input text, display_name_input text)
returns table (household_id uuid, household_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.households%rowtype;
  normalized_key text := trim(access_key_input);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(normalized_key) < 32 then raise exception 'Invalid household access key'; end if;

  select h.* into target
  from public.households h
  where h.access_key_hash = extensions.digest(normalized_key, 'sha256');

  if target.id is null then
    begin
      insert into public.households (name, access_key_hash, created_by)
      values ('Our puppy', extensions.digest(normalized_key, 'sha256'), auth.uid())
      returning * into target;
    exception when unique_violation then
      select h.* into target
      from public.households h
      where h.access_key_hash = extensions.digest(normalized_key, 'sha256');
    end;
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.user_id = auth.uid() and hm.household_id <> target.id
  ) then
    raise exception 'This device already belongs to another household';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
  values (target.id, auth.uid(), coalesce(nullif(trim(display_name_input), ''), 'Caregiver'))
  on conflict on constraint household_members_pkey
  do update set display_name = excluded.display_name;

  return query select target.id, target.name;
end;
$$;

revoke execute on function public.bootstrap_household(text, text) from public, anon;
grant execute on function public.bootstrap_household(text, text) to authenticated;
