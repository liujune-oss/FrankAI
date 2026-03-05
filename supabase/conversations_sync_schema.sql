-- B05: 对话历史云端同步
-- 执行此 SQL 后，conversations 表即可在多设备间同步对话历史

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '新会话',
    messages JSONB NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- RLS（可选，当前项目用 service role key，不依赖 RLS）
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
