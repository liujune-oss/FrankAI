-- 1. Drop the HNSW index which prevents inserting > 2000 dimensions
DROP INDEX IF EXISTS memories_tier1_embedding_idx;

-- 2. Alter the column type to strictly 3072 dimensions natively
ALTER TABLE memories_tier1 ALTER COLUMN embedding TYPE vector(3072);

-- Note: We DO NOT re-create the HNSW index here.
-- pgvector has a hard limit of 2000 dimensions for HNSW and IVFFlat indexes on standard vector types.
-- However, exact nearest neighbor search (sequential scan) works perfectly on 3072 dimensions and guarantees 100% recall.
-- Since this is personal chat memory (typically < 100k rows per user), exact search will be instantaneous.

-- 3. Update the RPC function to expect the raw 3072 query vector
DROP FUNCTION IF EXISTS match_tier1_memories;

CREATE OR REPLACE FUNCTION match_tier1_memories(
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
RETURNS TABLE (
  id uuid,
  session_id text,
  summary_text text,
  similarity float,
  start_message_id uuid,
  end_message_id uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.session_id,
    m.summary_text,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.start_message_id,
    m.end_message_id
  FROM memories_tier1 m
  WHERE m.user_id = p_user_id
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
