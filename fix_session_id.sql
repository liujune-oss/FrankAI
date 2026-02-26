-- 1. Alter the column types from UUID to TEXT
ALTER TABLE chat_messages ALTER COLUMN session_id TYPE TEXT;
ALTER TABLE memories_tier1 ALTER COLUMN session_id TYPE TEXT;

-- 2. Drop and Recreate the RPC function to match the new return type
DROP FUNCTION IF EXISTS match_tier1_memories;

CREATE OR REPLACE FUNCTION match_tier1_memories(
  query_embedding vector(768),
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
