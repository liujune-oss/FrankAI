-- Quick fix script for vector dimensions 3072
ALTER TABLE user_vectors ALTER COLUMN embedding TYPE vector(3072);

-- Also we need to recreate the match_user_vectors function
DROP FUNCTION IF EXISTS match_user_vectors;

create or replace function match_user_vectors (
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    user_vectors.id,
    user_vectors.content,
    1 - (user_vectors.embedding <=> query_embedding) as similarity
  from user_vectors
  where 1 - (user_vectors.embedding <=> query_embedding) > match_threshold
    and user_vectors.user_id = p_user_id
  order by user_vectors.embedding <=> query_embedding
  limit match_count;
$$;
