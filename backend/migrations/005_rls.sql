-- 005_rls.sql
-- Row Level Security (RLS) for every PolicyLens table plus the Supabase
-- Storage `policies` bucket path-prefix policy.
--
-- Model:
--   * The backend service-role key BYPASSES RLS (server-trusted). These policies
--     protect direct access made with the anon/authenticated key (e.g. the client
--     SDK / signed sessions), enforcing owner/broker scoping in the database itself.
--   * A profile row is the bridge between auth.users and domain data:
--       profiles.user_id = auth.uid()  <->  profiles.id = <owner_id | broker.profile_id>
--   * Customer-owned tables reference profiles(id) via owner_id/user_id.
--   * Child tables inherit ownership through their parent (policy_id / chat_id / broker_id).
--   * Broker tables are scoped to the broker whose profile maps to auth.uid().
--
-- Depends on: 002_profiles.sql, 003_customer.sql, 004_broker.sql.
-- Requirements: 15.2, 17.5, 21.1

-- ---------------------------------------------------------------------------
-- Ownership helper functions
--   SECURITY DEFINER so the ownership lookups can read profiles/parents even
--   when the caller's own RLS would otherwise hide those rows. Each function is
--   STABLE and side-effect free, and only ever compares against auth.uid().
-- ---------------------------------------------------------------------------

-- True when p_profile_id is a profile belonging to the current auth user.
create or replace function public.owns_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = p_profile_id
      and pr.user_id = auth.uid()
  );
$$;

-- True when p_policy_id is a policy whose owner profile belongs to the auth user.
create or replace function public.owns_policy(p_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policies p
    join public.profiles pr on pr.id = p.owner_id
    where p.id = p_policy_id
      and pr.user_id = auth.uid()
  );
$$;

-- True when p_chat_id is a chat whose owner profile belongs to the auth user.
create or replace function public.owns_chat(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.profiles pr on pr.id = c.owner_id
    where c.id = p_chat_id
      and pr.user_id = auth.uid()
  );
$$;

-- True when p_broker_id is a broker whose profile belongs to the auth user.
create or replace function public.owns_broker(p_broker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.brokers b
    join public.profiles pr on pr.id = b.profile_id
    where b.id = p_broker_id
      and pr.user_id = auth.uid()
  );
$$;

-- True when p_bp_id is a broker_policy owned (through its broker) by the auth user.
create or replace function public.owns_broker_policy(p_bp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.broker_policies bp
    join public.brokers b  on b.id = bp.broker_id
    join public.profiles pr on pr.id = b.profile_id
    where bp.id = p_bp_id
      and pr.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles
--   A user may read and update only their own profile row.
--   (Inserts are handled by the SECURITY DEFINER signup trigger in 002.)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (user_id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Customer-owned tables — owner_id maps to the caller's profile (R21.1).
-- ---------------------------------------------------------------------------
alter table public.family_members enable row level security;
drop policy if exists family_members_owner_all on public.family_members;
create policy family_members_owner_all on public.family_members
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

alter table public.policies enable row level security;
drop policy if exists policies_owner_all on public.policies;
create policy policies_owner_all on public.policies
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

alter table public.comparisons enable row level security;
drop policy if exists comparisons_owner_all on public.comparisons;
create policy comparisons_owner_all on public.comparisons
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

alter table public.claim_simulations enable row level security;
drop policy if exists claim_simulations_owner_all on public.claim_simulations;
create policy claim_simulations_owner_all on public.claim_simulations
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

alter table public.jobs enable row level security;
drop policy if exists jobs_owner_all on public.jobs;
create policy jobs_owner_all on public.jobs
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

alter table public.chats enable row level security;
drop policy if exists chats_owner_all on public.chats;
create policy chats_owner_all on public.chats
  for all using (public.owns_profile(owner_id))
  with check (public.owns_profile(owner_id));

-- notifications use user_id (references profiles.id) as the owner column.
alter table public.notifications enable row level security;
drop policy if exists notifications_owner_all on public.notifications;
create policy notifications_owner_all on public.notifications
  for all using (public.owns_profile(user_id))
  with check (public.owns_profile(user_id));

-- ---------------------------------------------------------------------------
-- Customer child tables — ownership enforced through the parent.
-- ---------------------------------------------------------------------------
-- policy_analysis, policy_chunks -> policies.owner_id
alter table public.policy_analysis enable row level security;
drop policy if exists policy_analysis_via_policy on public.policy_analysis;
create policy policy_analysis_via_policy on public.policy_analysis
  for all using (public.owns_policy(policy_id))
  with check (public.owns_policy(policy_id));

alter table public.policy_chunks enable row level security;
drop policy if exists policy_chunks_via_policy on public.policy_chunks;
create policy policy_chunks_via_policy on public.policy_chunks
  for all using (public.owns_policy(policy_id))
  with check (public.owns_policy(policy_id));

-- chat_messages -> chats.owner_id
alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_via_chat on public.chat_messages;
create policy chat_messages_via_chat on public.chat_messages
  for all using (public.owns_chat(chat_id))
  with check (public.owns_chat(chat_id));

-- ---------------------------------------------------------------------------
-- Broker tables — scoped to the broker whose profile maps to auth.uid().
-- Team-member permission checks are enforced additionally in the service layer.
-- ---------------------------------------------------------------------------
-- brokers -> profile_id directly maps to the caller's profile.
alter table public.brokers enable row level security;
drop policy if exists brokers_owner_all on public.brokers;
create policy brokers_owner_all on public.brokers
  for all using (public.owns_profile(profile_id))
  with check (public.owns_profile(profile_id));

-- Direct children of brokers (broker_id).
alter table public.clients enable row level security;
drop policy if exists clients_via_broker on public.clients;
create policy clients_via_broker on public.clients
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

alter table public.broker_policies enable row level security;
drop policy if exists broker_policies_via_broker on public.broker_policies;
create policy broker_policies_via_broker on public.broker_policies
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

alter table public.leads enable row level security;
drop policy if exists leads_via_broker on public.leads;
create policy leads_via_broker on public.leads
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

alter table public.team_members enable row level security;
drop policy if exists team_members_via_broker on public.team_members;
create policy team_members_via_broker on public.team_members
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

alter table public.documents enable row level security;
drop policy if exists documents_via_broker on public.documents;
create policy documents_via_broker on public.documents
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

alter table public.ai_insights enable row level security;
drop policy if exists ai_insights_via_broker on public.ai_insights;
create policy ai_insights_via_broker on public.ai_insights
  for all using (public.owns_broker(broker_id))
  with check (public.owns_broker(broker_id));

-- Grandchildren of brokers (broker_policy_id).
alter table public.renewals enable row level security;
drop policy if exists renewals_via_broker_policy on public.renewals;
create policy renewals_via_broker_policy on public.renewals
  for all using (public.owns_broker_policy(broker_policy_id))
  with check (public.owns_broker_policy(broker_policy_id));

alter table public.commissions enable row level security;
drop policy if exists commissions_via_broker_policy on public.commissions;
create policy commissions_via_broker_policy on public.commissions
  for all using (public.owns_broker_policy(broker_policy_id))
  with check (public.owns_broker_policy(broker_policy_id));

alter table public.claims enable row level security;
drop policy if exists claims_via_broker_policy on public.claims;
create policy claims_via_broker_policy on public.claims
  for all using (public.owns_broker_policy(broker_policy_id))
  with check (public.owns_broker_policy(broker_policy_id));

-- audit_log — a user may read/write only rows they are the actor of.
alter table public.audit_log enable row level security;
drop policy if exists audit_log_actor_all on public.audit_log;
create policy audit_log_actor_all on public.audit_log
  for all using (actor_id is not null and public.owns_profile(actor_id))
  with check (actor_id is not null and public.owns_profile(actor_id));

-- ---------------------------------------------------------------------------
-- Supabase Storage — `policies` bucket, owner-namespaced by path prefix.
--
--   Files are stored under `{user_id}/...` where {user_id} = auth.uid().
--   The policies below grant a user access ONLY to objects under their own
--   top-level folder in the `policies` bucket (R21.1).
--
--   These run against storage.objects, which exists on Supabase but may be
--   absent in a plain local Postgres. Wrapped in a guard so the migration is
--   safe to run in either environment. The bucket itself must be created via
--   the Supabase dashboard/API (e.g. a private bucket named `policies`).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    -- Read own files.
    execute $pol$
      drop policy if exists policies_bucket_select_own on storage.objects;
      create policy policies_bucket_select_own on storage.objects
        for select
        using (
          bucket_id = 'policies'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $pol$;

    -- Upload files only under own prefix.
    execute $pol$
      drop policy if exists policies_bucket_insert_own on storage.objects;
      create policy policies_bucket_insert_own on storage.objects
        for insert
        with check (
          bucket_id = 'policies'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $pol$;

    -- Update own files.
    execute $pol$
      drop policy if exists policies_bucket_update_own on storage.objects;
      create policy policies_bucket_update_own on storage.objects
        for update
        using (
          bucket_id = 'policies'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
        with check (
          bucket_id = 'policies'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $pol$;

    -- Delete own files (supports policy deletion cleanup, R21).
    execute $pol$
      drop policy if exists policies_bucket_delete_own on storage.objects;
      create policy policies_bucket_delete_own on storage.objects
        for delete
        using (
          bucket_id = 'policies'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $pol$;
  else
    raise notice 'storage.objects not found; skipping Storage RLS policies (create the `policies` bucket + these policies in Supabase).';
  end if;
end $$;
