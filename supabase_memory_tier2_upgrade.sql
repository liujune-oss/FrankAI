-- SQL Upgrade Script for 2-Tier Memory Architecture
-- Please run this in your Supabase SQL Editor.

-- 1. Enable pgvector if not already enabled (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create chat_messages table to store all raw chat logs for sliding window
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'model')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast session retrieval
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- 3. Create memories_tier1 table to store abstracted summaries and vectors
CREATE TABLE IF NOT EXISTS memories_tier1 (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    summary_text TEXT NOT NULL,
    embedding vector(768), -- Assumes usage of gemini-embedding model (768 dimensions)
    start_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    end_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS memories_tier1_embedding_idx ON memories_tier1 USING hnsw (embedding vector_cosine_ops);

-- 4. Create RPC function for finding the top-K matching summaries
CREATE OR REPLACE FUNCTION match_tier1_memories(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
RETURNS TABLE (
  id uuid,
  session_id uuid,
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
