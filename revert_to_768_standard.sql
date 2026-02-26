-- 1. Drop the existing HNSW index 
DROP INDEX IF EXISTS memories_tier1_embedding_idx;

-- 2. Alter the column type to strictly 768 dimensions (Standard for Google text-embedding-004)
ALTER TABLE memories_tier1 ALTER COLUMN embedding TYPE vector(768);

-- 3. Re-create the HNSW index for the standard 768 dimension column
CREATE INDEX IF NOT EXISTS memories_tier1_embedding_idx ON memories_tier1 USING hnsw (embedding vector_cosine_ops);

-- 4. Update the RPC function to expect the standard 768 query vector
DROP FUNCTION IF EXISTS match_tier1_memories;

CREATE OR REPLACE FUNCTION match_tier1_memories(
  query_embedding vector(768),
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
