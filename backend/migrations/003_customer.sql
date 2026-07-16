-- 003_customer.sql
-- Customer-domain schema: policies, analysis, chunks (pgvector), family members,
-- chats/messages, comparisons, claim simulations, jobs, and notifications.
-- Depends on: 001_extensions.sql (vector extension), 002_profiles.sql (profiles table).
-- Requirements: 4.1, 6.1, 6.2, 6.6, 7.1, 8.1, 15.1, 16.1

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
do $$ begin
  create type policy_category as enum ('health', 'life', 'motor', 'travel', 'home');
exception when duplicate_object then null; end $$;

do $$ begin
  create type policy_status as enum ('uploaded', 'processing', 'analyzed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat_message_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('queued', 'running', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- family_members
--   A member of the owner's household that a policy can be associated with.
-- ---------------------------------------------------------------------------
create table if not exists family_members (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade,
  name        text not null,
  relation    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_family_members_owner_id on family_members (owner_id);

-- ---------------------------------------------------------------------------
-- policies
--   Uploaded insurance documents owned by a customer profile.
-- ---------------------------------------------------------------------------
create table if not exists policies (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references profiles (id) on delete cascade,
  family_member_id  uuid references family_members (id) on delete set null,
  category          policy_category not null,
  title             text not null,
  provider          text,
  premium_amount    numeric,
  premium_currency  text,
  sum_insured       numeric,
  storage_path      text,
  original_filename text,
  mime_type         text,
  status            policy_status not null default 'uploaded',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_policies_owner_id on policies (owner_id);
create index if not exists idx_policies_family_member_id on policies (family_member_id);
create index if not exists idx_policies_category on policies (category);
create index if not exists idx_policies_status on policies (status);

-- ---------------------------------------------------------------------------
-- policy_analysis
--   Structured AI analysis for a policy (one-to-one with policies).
-- ---------------------------------------------------------------------------
create table if not exists policy_analysis (
  id               uuid primary key default gen_random_uuid(),
  policy_id        uuid not null unique references policies (id) on delete cascade,
  health_score     integer,
  coverage         jsonb not null default '[]'::jsonb,
  exclusions       jsonb not null default '[]'::jsonb,
  waiting_periods  jsonb not null default '[]'::jsonb,
  financial_limits jsonb not null default '[]'::jsonb,
  co_pay           jsonb not null default '[]'::jsonb,
  deductibles      jsonb not null default '[]'::jsonb,
  hidden_clauses   jsonb not null default '[]'::jsonb,
  recommendations  jsonb not null default '[]'::jsonb,
  risk_flag_count  integer not null default 0,
  not_found        text[] not null default '{}',
  partial          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_policy_analysis_policy_id on policy_analysis (policy_id);

-- ---------------------------------------------------------------------------
-- policy_chunks
--   Chunked policy text with pgvector embeddings for RAG chat and search.
-- ---------------------------------------------------------------------------
create table if not exists policy_chunks (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null references policies (id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  section     text,
  page        integer,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_policy_chunks_policy_id on policy_chunks (policy_id);

-- Approximate nearest-neighbour index for cosine similarity retrieval (R15).
create index if not exists idx_policy_chunks_embedding
  on policy_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- chats
--   A conversation thread scoped to a policy and its owner.
-- ---------------------------------------------------------------------------
create table if not exists chats (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null references policies (id) on delete cascade,
  owner_id    uuid not null references profiles (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_chats_policy_id on chats (policy_id);
create index if not exists idx_chats_owner_id on chats (owner_id);

-- ---------------------------------------------------------------------------
-- chat_messages
--   Individual messages within a chat, with cited policy sections.
-- ---------------------------------------------------------------------------
create table if not exists chat_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references chats (id) on delete cascade,
  role           chat_message_role not null,
  content        text not null,
  cited_sections jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_chat_messages_chat_id on chat_messages (chat_id);

-- ---------------------------------------------------------------------------
-- comparisons
--   Side-by-side comparison of two policies with a recommendation.
-- ---------------------------------------------------------------------------
create table if not exists comparisons (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles (id) on delete cascade,
  policy_a_id    uuid not null references policies (id) on delete cascade,
  policy_b_id    uuid not null references policies (id) on delete cascade,
  result         jsonb not null default '{}'::jsonb,
  recommendation text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_comparisons_owner_id on comparisons (owner_id);
create index if not exists idx_comparisons_policy_a_id on comparisons (policy_a_id);
create index if not exists idx_comparisons_policy_b_id on comparisons (policy_b_id);

-- ---------------------------------------------------------------------------
-- claim_simulations
--   Simulated claim scenario evaluated against a policy.
-- ---------------------------------------------------------------------------
create table if not exists claim_simulations (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references profiles (id) on delete cascade,
  policy_id            uuid not null references policies (id) on delete cascade,
  scenario             text not null,
  approval_probability integer,
  reasons              jsonb not null default '[]'::jsonb,
  matched_exclusion    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_claim_simulations_owner_id on claim_simulations (owner_id);
create index if not exists idx_claim_simulations_policy_id on claim_simulations (policy_id);

-- ---------------------------------------------------------------------------
-- jobs
--   Background processing jobs (OCR -> embedding -> analysis) per policy.
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles (id) on delete cascade,
  policy_id      uuid not null references policies (id) on delete cascade,
  type           text not null,
  status         job_status not null default 'queued',
  stage          text,
  progress       integer not null default 0,
  queue_position integer,
  attempts       integer not null default 0,
  failed_stage   text,
  error          text,
  extended       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_jobs_owner_id on jobs (owner_id);
create index if not exists idx_jobs_policy_id on jobs (policy_id);
create index if not exists idx_jobs_status on jobs (status);

-- ---------------------------------------------------------------------------
-- notifications
--   In-app notifications delivered to a user profile.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on notifications (user_id);
create index if not exists idx_notifications_read on notifications (read);
