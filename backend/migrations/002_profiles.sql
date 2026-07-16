-- 002_profiles.sql
-- User profiles keyed to Supabase auth.users, plus a trigger that
-- automatically provisions a profile row on signup.
--
-- role  drives frontend RoleRoute + backend rbacMiddleware (customer|broker|corporate).
-- tier  drives freemium enforcement (free|premium), defaults to 'free'.
--
-- _Requirements: 17.1, 18.1_

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'customer'
                check (role in ('customer', 'broker', 'corporate')),
  tier        text not null default 'free'
                check (tier in ('free', 'premium')),
  broker_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id)
);

-- Lookups by auth user id and by owning broker.
create index if not exists idx_profiles_user_id on public.profiles (user_id);
create index if not exists idx_profiles_broker_id on public.profiles (broker_id);

-- Keep updated_at fresh on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Create a profile row automatically whenever a new auth user signs up.
-- full_name/role/tier are read from raw_user_meta_data when present,
-- otherwise sensible defaults are applied.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, email, role, tier)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'customer'),
    coalesce(new.raw_user_meta_data ->> 'tier', 'free')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
