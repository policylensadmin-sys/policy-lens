-- 004_broker.sql
-- Broker-domain schema: brokers, clients, broker_policies, renewals, commissions,
-- claims, leads, team_members, documents, ai_insights, and audit_log.
-- Depends on: 001_extensions.sql (pgcrypto for gen_random_uuid()),
--             002_profiles.sql (profiles table, set_updated_at() trigger fn).
-- Requirements: 9.1, 10.1, 11.1, 12.1, 13.1, 19.4, 19.5, 19.6

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
do $$ begin
  create type broker_policy_status as enum ('active', 'pending_renewal', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type commission_status as enum ('paid', 'pending', 'overdue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_status as enum ('approved', 'under_review', 'pending', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_insight_type as enum ('upsell', 'risk_alert', 'renewal_opt', 'coverage_improvement');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- brokers
--   A brokerage account tied to a broker-role profile.
-- ---------------------------------------------------------------------------
create table if not exists brokers (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  agency_name text,
  plan        text,
  currency    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_brokers_profile_id on brokers (profile_id);

-- ---------------------------------------------------------------------------
-- clients
--   A client managed by a broker.
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  broker_id   uuid not null references brokers (id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  risk_flags  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_clients_broker_id on clients (broker_id);

-- ---------------------------------------------------------------------------
-- broker_policies
--   Insurance policies a broker manages on behalf of a client.
-- ---------------------------------------------------------------------------
create table if not exists broker_policies (
  id                uuid primary key default gen_random_uuid(),
  broker_id         uuid not null references brokers (id) on delete cascade,
  client_id         uuid not null references clients (id) on delete cascade,
  policy_type       text not null,
  insurer           text,
  start_date        date,
  end_date          date,
  premium_amount    numeric,
  payment_frequency text,
  status            broker_policy_status not null default 'active',
  sum_insured       numeric,
  deductible        numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_broker_policies_broker_id on broker_policies (broker_id);
create index if not exists idx_broker_policies_client_id on broker_policies (client_id);
create index if not exists idx_broker_policies_status on broker_policies (status);

-- ---------------------------------------------------------------------------
-- renewals
--   Scheduled renewal for a broker policy.
-- ---------------------------------------------------------------------------
create table if not exists renewals (
  id               uuid primary key default gen_random_uuid(),
  broker_policy_id uuid not null references broker_policies (id) on delete cascade,
  renewal_date     date,
  premium_amount   numeric,
  reminder_sent    boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_renewals_broker_policy_id on renewals (broker_policy_id);
create index if not exists idx_renewals_renewal_date on renewals (renewal_date);

-- ---------------------------------------------------------------------------
-- commissions
--   Commission earned on a broker policy.
-- ---------------------------------------------------------------------------
create table if not exists commissions (
  id               uuid primary key default gen_random_uuid(),
  broker_policy_id uuid not null references broker_policies (id) on delete cascade,
  amount           numeric,
  status           commission_status not null default 'pending',
  scheduled_date   date,
  paid_date        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_commissions_broker_policy_id on commissions (broker_policy_id);
create index if not exists idx_commissions_status on commissions (status);

-- ---------------------------------------------------------------------------
-- claims
--   Insurance claim filed against a broker policy for a client.
-- ---------------------------------------------------------------------------
create table if not exists claims (
  id               uuid primary key default gen_random_uuid(),
  broker_policy_id uuid not null references broker_policies (id) on delete cascade,
  client_id        uuid not null references clients (id) on delete cascade,
  claim_type       text not null,
  claimed_amount   numeric,
  status           claim_status not null default 'pending',
  submitted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_claims_broker_policy_id on claims (broker_policy_id);
create index if not exists idx_claims_client_id on claims (client_id);
create index if not exists idx_claims_status on claims (status);

-- ---------------------------------------------------------------------------
-- leads
--   Sales lead tracked by a broker through the pipeline.
-- ---------------------------------------------------------------------------
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  broker_id   uuid not null references brokers (id) on delete cascade,
  name        text not null,
  contact     text,
  stage       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_leads_broker_id on leads (broker_id);

-- ---------------------------------------------------------------------------
-- team_members
--   A member of a broker's team with role-based permissions.
-- ---------------------------------------------------------------------------
create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  broker_id   uuid not null references brokers (id) on delete cascade,
  name        text not null,
  role        text,
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_team_members_broker_id on team_members (broker_id);

-- ---------------------------------------------------------------------------
-- documents
--   Files stored by a broker, optionally linked to a client and/or policy.
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  broker_id        uuid not null references brokers (id) on delete cascade,
  client_id        uuid references clients (id) on delete set null,
  broker_policy_id uuid references broker_policies (id) on delete set null,
  name             text not null,
  storage_path     text,
  category         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_documents_broker_id on documents (broker_id);
create index if not exists idx_documents_client_id on documents (client_id);
create index if not exists idx_documents_broker_policy_id on documents (broker_policy_id);

-- ---------------------------------------------------------------------------
-- ai_insights
--   AI-generated portfolio insights delivered to a broker.
-- ---------------------------------------------------------------------------
create table if not exists ai_insights (
  id           uuid primary key default gen_random_uuid(),
  broker_id    uuid not null references brokers (id) on delete cascade,
  type         ai_insight_type not null,
  message      text not null,
  client_ids   uuid[] not null default '{}',
  evidence     jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_ai_insights_broker_id on ai_insights (broker_id);
create index if not exists idx_ai_insights_type on ai_insights (type);

-- ---------------------------------------------------------------------------
-- audit_log
--   Append-only record of significant actions across the broker domain.
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_audit_log_actor_id on audit_log (actor_id);
create index if not exists idx_audit_log_entity on audit_log (entity, entity_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse public.set_updated_at() from 002_profiles.sql)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_brokers_updated_at on brokers;
create trigger trg_brokers_updated_at
  before update on brokers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on clients;
create trigger trg_clients_updated_at
  before update on clients
  for each row execute function public.set_updated_at();

drop trigger if exists trg_broker_policies_updated_at on broker_policies;
create trigger trg_broker_policies_updated_at
  before update on broker_policies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_renewals_updated_at on renewals;
create trigger trg_renewals_updated_at
  before update on renewals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_commissions_updated_at on commissions;
create trigger trg_commissions_updated_at
  before update on commissions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_claims_updated_at on claims;
create trigger trg_claims_updated_at
  before update on claims
  for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
  before update on leads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_team_members_updated_at on team_members;
create trigger trg_team_members_updated_at
  before update on team_members
  for each row execute function public.set_updated_at();

drop trigger if exists trg_documents_updated_at on documents;
create trigger trg_documents_updated_at
  before update on documents
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ai_insights_updated_at on ai_insights;
create trigger trg_ai_insights_updated_at
  before update on ai_insights
  for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_log_updated_at on audit_log;
create trigger trg_audit_log_updated_at
  before update on audit_log
  for each row execute function public.set_updated_at();
