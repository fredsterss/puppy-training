create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  access_key_hash bytea not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table if not exists public.puppy_events (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('pee', 'poo', 'food', 'accident', 'water', 'sleep', 'wake')),
  occurred_at timestamptz not null,
  amount numeric,
  consistency text,
  is_accident boolean not null default false,
  note text,
  tags text[],
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint puppy_events_poo_consistency_check check (
    consistency is null or (type = 'poo' and consistency in ('normal', 'soft'))
  ),
  constraint puppy_events_accident_property_check check (
    not is_accident or type in ('pee', 'poo')
  )
);

-- Keep old cached PWA clients compatible while storing only the new canonical
-- pee/poo event shape.
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

create index if not exists puppy_events_household_time_idx
  on public.puppy_events (household_id, occurred_at desc);
create index if not exists households_created_by_idx
  on public.households (created_by);
create index if not exists puppy_events_created_by_idx
  on public.puppy_events (created_by);

create or replace function private.is_household_member(household_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = household_id_input and user_id = auth.uid()
  );
$$;

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

create or replace function public.keep_newest_event_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then return old; end if;
  new.id := old.id;
  new.household_id := old.household_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists puppy_events_keep_newest on public.puppy_events;
create trigger puppy_events_keep_newest
before update on public.puppy_events
for each row execute function public.keep_newest_event_version();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.puppy_events enable row level security;

drop policy if exists "Members read household" on public.households;
create policy "Members read household" on public.households
for select to authenticated using ((select private.is_household_member(id)));

drop policy if exists "Members read membership" on public.household_members;
create policy "Members read membership" on public.household_members
for select to authenticated using ((select private.is_household_member(household_id)));

drop policy if exists "Members read events" on public.puppy_events;
create policy "Members read events" on public.puppy_events
for select to authenticated using ((select private.is_household_member(household_id)));
drop policy if exists "Members create events" on public.puppy_events;
create policy "Members create events" on public.puppy_events
for insert to authenticated with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
drop policy if exists "Members update events" on public.puppy_events;
create policy "Members update events" on public.puppy_events
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

grant select on public.households, public.household_members, public.puppy_events to authenticated;
grant insert, update on public.puppy_events to authenticated;
grant usage on schema private to authenticated;
revoke execute on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;
revoke execute on function public.bootstrap_household(text, text) from public, anon;
grant execute on function public.bootstrap_household(text, text) to authenticated;
revoke execute on function public.keep_newest_event_version() from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.puppy_events;
exception when duplicate_object then null;
end $$;
