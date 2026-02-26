-- 1. Drop the existing HNSW index that depends on the 768 dimension constraint
DROP INDEX IF EXISTS memories_tier1_embedding_idx;

-- 2. Alter the column type to support 3072 dimensions
ALTER TABLE memories_tier1 ALTER COLUMN embedding TYPE vector(3072);

-- 3. Re-create the HNSW index for the new 3072 dimension column
CREATE INDEX IF NOT EXISTS memories_tier1_embedding_idx ON memories_tier1 USING hnsw (embedding vector_cosine_ops);

-- 4. Also update the RPC function to expect the new 3072 dimension query vector
DROP FUNCTION IF EXISTS match_tier1_memories;

CREATE OR REPLACE FUNCTION match_tier1_memories(
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  p_user_id text
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
