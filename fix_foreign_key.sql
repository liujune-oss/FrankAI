-- 1. Drop foreign key constraint on chat_messages
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey;

-- 2. Drop foreign key constraint on memories_tier1 as well to be safe
ALTER TABLE memories_tier1 DROP CONSTRAINT IF EXISTS memories_tier1_user_id_fkey;
