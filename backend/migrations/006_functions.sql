-- 006_functions.sql
-- Retrieval helper for RAG chat and semantic search over policy_chunks.
--
-- match_policy_chunks performs cosine-similarity nearest-neighbour search
-- (pgvector `<=>` cosine distance) scoped to a single policy. Similarity is
-- expressed as `1 - (embedding <=> query_embedding)` so that 1.0 == identical
-- and 0.0 == orthogonal; results are filtered at >= match_threshold, ordered
-- by similarity descending, and capped at match_count.
--
-- Used by ChatService (top-5 retrieval) and semantic search (top-10, >= 0.7).
--
-- Depends on: 001_extensions.sql (vector), 003_customer.sql (policy_chunks).
-- Requirements: 15.2, 17.5

create or replace function public.match_policy_chunks(
  p_policy_id     uuid,
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
returns table (
  id          uuid,
  policy_id   uuid,
  chunk_index integer,
  content     text,
  section     text,
  page        integer,
  similarity  float
)
language sql
stable
as $$
  select
    pc.id,
    pc.policy_id,
    pc.chunk_index,
    pc.content,
    pc.section,
    pc.page,
    1 - (pc.embedding <=> query_embedding) as similarity
  from public.policy_chunks pc
  where pc.policy_id = p_policy_id
    and pc.embedding is not null
    and 1 - (pc.embedding <=> query_embedding) >= match_threshold
  order by pc.embedding <=> query_embedding asc
  limit match_count;
$$;

-- Note: ordering by the raw cosine distance ascending is equivalent to ordering
-- by `similarity` descending, but lets the planner use the ivfflat cosine index
-- (idx_policy_chunks_embedding) created in 003_customer.sql.
