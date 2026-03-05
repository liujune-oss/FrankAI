-- Memory Architecture v2 Migration
-- 参考：docs/memory-architecture-v2.md
-- 执行顺序：在 Supabase SQL Editor 中完整运行

-- ============================================================
-- 1. Core Memory 表（用户长期事实，每人一行）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_core_memory (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Memory Chunks 表（替代 memories_tier1，分块追加）
-- ============================================================
CREATE TABLE IF NOT EXISTS memories_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  chunk_index   INT NOT NULL DEFAULT 0,
  summary_text  TEXT NOT NULL,
  embedding     VECTOR(3072),
  message_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_chunks_user_time_idx
  ON memories_chunks (user_id, created_at DESC);

-- 注意：pgvector 的 ivfflat / hnsw 索引最多支持 2000 维
-- gemini-embedding-001 默认 3072 维，超出限制，因此不创建近似向量索引
-- 个人助手场景 chunks 数量有限，exact sequential scan 性能足够
-- 若未来数据量增大，可改用降维方案（outputDimensionality: 1536）再建索引

-- ============================================================
-- 3. 迁移现有 memories_tier1 数据到 memories_chunks
-- ============================================================
INSERT INTO memories_chunks (user_id, session_id, chunk_index, summary_text, embedding, message_count, created_at)
SELECT
  user_id,
  session_id,
  0 AS chunk_index,
  summary_text,
  embedding,
  0 AS message_count,
  created_at
FROM memories_tier1
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. 冷层向量搜索 RPC（排除温层已取的 chunk，避免重复）
-- ============================================================
CREATE OR REPLACE FUNCTION match_archival_memories(
  query_embedding VECTOR(3072),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID,
  exclude_ids     UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  id           UUID,
  session_id   TEXT,
  summary_text TEXT,
  similarity   FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    id,
    session_id,
    summary_text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memories_chunks
  WHERE user_id = p_user_id
    AND (cardinality(exclude_ids) = 0 OR id != ALL(exclude_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 5. app_config 新增配置项
-- ============================================================
INSERT INTO app_config (key, value) VALUES
  ('memory_recall_count',   '5'),   -- 温层取最近几条
  ('memory_archival_count', '3'),   -- 冷层向量搜索 top N
  ('memory_chunk_size',     '10'),  -- 每块消息数（客户端触发阈值）
  ('memory_archival_threshold', '0.6')  -- 冷层相似度阈值
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 验证
-- ============================================================
-- SELECT COUNT(*) FROM memories_chunks;  -- 应与 memories_tier1 行数一致
-- SELECT * FROM user_core_memory LIMIT 5;
-- SELECT * FROM app_config WHERE key LIKE 'memory_%';
