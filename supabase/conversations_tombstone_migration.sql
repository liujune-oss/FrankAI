-- 对话云同步墓碑方案迁移
-- 执行时间：v1.8.107
-- 作用：为 conversations 表添加 deleted_at 字段，支持增量同步和删除传播

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- 为增量查询加索引（updated_at 已有索引则跳过）
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
    ON conversations (user_id, updated_at DESC);
