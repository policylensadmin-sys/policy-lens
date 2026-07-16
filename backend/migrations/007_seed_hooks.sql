-- 007_seed_hooks.sql
-- Optional demo-seed toggles and helpers.
--
-- The authoritative demo seed lives in the application layer (`backend/seed`,
-- wired to the root `seed` script) so it can create Supabase auth users and use
-- the service-role client. This migration provides lightweight, idempotent SQL
-- hooks the seed script (or an operator) can use to control demo data.
--
-- Nothing here inserts real data by default — it only defines toggles/helpers so
-- enabling or clearing demo data is a single, explicit call. This keeps prod-like
-- environments clean unless demo mode is deliberately turned on.
--
-- Depends on: 002_profiles.sql .. 004_broker.sql.
-- Requirements: 21.1

-- ---------------------------------------------------------------------------
-- Feature-flag table for environment toggles (e.g. demo seeding).
--   Seeded with `demo_seed_enabled = false`. Flip it on to signal that demo
--   data may be populated; the application seed script reads this flag.
-- ---------------------------------------------------------------------------
create table if not exists public.app_flags (
  key         text primary key,
  enabled     boolean not null default false,
  value       jsonb   not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_app_flags_updated_at on public.app_flags;
create trigger trg_app_flags_updated_at
  before update on public.app_flags
  for each row execute function public.set_updated_at();

-- Register the demo-seed toggle (defaults to disabled). Idempotent.
insert into public.app_flags (key, enabled, value)
values ('demo_seed_enabled', false, '{"description": "When true, the seed script may populate demo broker/customer data."}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Convenience readers/toggles used by the seed script and operators.
-- ---------------------------------------------------------------------------

-- Returns true when demo seeding is enabled.
create or replace function public.demo_seed_enabled()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select enabled from public.app_flags where key = 'demo_seed_enabled'),
    false
  );
$$;

-- Enable or disable the demo-seed toggle. Returns the new state.
create or replace function public.set_demo_seed_enabled(p_enabled boolean)
returns boolean
language sql
as $$
  insert into public.app_flags (key, enabled)
  values ('demo_seed_enabled', p_enabled)
  on conflict (key) do update set enabled = excluded.enabled, updated_at = now()
  returning enabled;
$$;

-- ---------------------------------------------------------------------------
-- RLS for app_flags: readable by any authenticated user; writes are reserved
-- for the service role (which bypasses RLS). No write policy is defined, so
-- anon/authenticated callers cannot modify flags directly.
-- ---------------------------------------------------------------------------
alter table public.app_flags enable row level security;

drop policy if exists app_flags_read on public.app_flags;
create policy app_flags_read on public.app_flags
  for select using (auth.uid() is not null);
