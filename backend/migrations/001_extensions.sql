-- 001_extensions.sql
-- Enable required PostgreSQL extensions for PolicyLens.
--
-- pgvector: powers semantic search / RAG retrieval over policy_chunks
--           (embedding vector(1536) + ivfflat cosine index).
-- pgcrypto: provides gen_random_uuid() for uuid primary key defaults.
--
-- _Requirements: 17.1, 18.1_

-- Vector similarity search (pgvector).
create extension if not exists vector;

-- UUID generation via gen_random_uuid().
create extension if not exists pgcrypto;
