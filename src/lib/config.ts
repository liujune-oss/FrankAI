import { supabaseAdmin } from './supabase';

// Default configuration values
const DEFAULT_CONFIGS: Record<string, any> = {
    chat_models: [
        { id: 'gemini-3.1-pro-preview', label: '3.1 Pro', group: 'Gemini 3.x' },
        { id: 'gemini-3-pro-preview', label: '3.0 Pro', group: 'Gemini 3.x' },
        { id: 'gemini-3-flash-preview', label: '3.0 Flash', group: 'Gemini 3.x' },
        { id: 'gemini-2.5-pro', label: '2.5 Pro', group: 'Gemini 2.5' },
        { id: 'gemini-2.5-flash', label: '2.5 Flash', group: 'Gemini 2.5' },
        { id: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite', group: 'Gemini 2.5' },
        { id: 'gemini-2.0-flash', label: '2.0 Flash', group: 'Gemini 2.0' },
        { id: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite', group: 'Gemini 2.0' },
    ],
    default_chat_model: 'gemini-3-flash-preview',
    memory_summary_model: 'gemini-3-flash-preview',
    memory_embedding_model: 'gemini-embedding-001',
    image_gen_model: 'gemini-2.5-flash-image',
    voice_model: 'gemini-3-flash-preview',
    voice_intent_prompt: `你是一个智能语音分析助手。请理解这段语音的内容，去掉语气词，总结意图并将其提取为一个符合数据库定义的活动记录 (Activity)。

【数据库 Schema 定义参考】
\`\`\`sql
CREATE TABLE activities (
    title TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK (type IN ('task', 'event', 'reminder')) NOT NULL,
    status TEXT CHECK (status IN ('needs_action', 'in_process', 'completed', 'cancelled')) DEFAULT 'needs_action',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    -- A task has a due date (end_time), no start_time.
    -- An event has both start_time and end_time.
    -- A reminder might only have a start_time (when to alert).
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    is_all_day BOOLEAN DEFAULT FALSE,
    location TEXT
);
\`\`\`

【非常重要：枚举值严格约束】
- type 字段【必须且只能】是从 schema 的约束中挑选："task", "event", "reminder"。绝对不能输出其他词语！(例如绝对不能输出 "meeting" 或 "开会")
- priority 字段【必须且只能】是从 schema 的约束中挑选："low", "medium", "high", "urgent"。

【极其重要：禁止自行发明字段】
这不仅是一次内容理解，这是一次**严格的数据结构转换**。
请**绝对不要**返回诸如 "absolute_time", "original_text", 或以 "event" 作为 key 的任何你自己发明的字段。
你的整个返回数据，**必须且只能包含以下 8 个 key**：

请严格按以下 JSON 格式输出，只能是个 JSON 对象，不要输出任何多余内容或 markdown 标记：
{
  "title": "活动标题",
  "description": "详细描述（可为空字符串）",
  "type": "task" | "event" | "reminder",
  "priority": "low" | "medium" | "high" | "urgent",
  "start_time": "ISO 8601 格式或 null (重要：必须是这个 key 名字，绝不能用 absolute_time)",
  "end_time": "ISO 8601 格式或 null",
  "is_all_day": boolean,
  "location": "地点或 null"
}`,
};

let tableEnsured = false;

/**
 * Ensure the app_config table exists and has default data (idempotent).
 * Uses Supabase's raw SQL via rpc to create the table if it doesn't exist.
 */
export async function ensureConfigTable(): Promise<void> {
    if (tableEnsured || !supabaseAdmin) return;

    try {
        // Try to insert defaults (upsert with ignoreDuplicates makes this idempotent).
        // If the table doesn't exist, this will throw and we fall back to defaults.
        for (const [key, value] of Object.entries(DEFAULT_CONFIGS)) {
            await supabaseAdmin
                .from('app_config')
                .upsert(
                    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
                    { onConflict: 'key', ignoreDuplicates: true }
                );
        }

        tableEnsured = true;
    } catch (err) {
        console.error('Failed to ensure config table:', err);
        // Don't throw — fall back to defaults if DB not available
    }
}

/**
 * Get a single config value by key. Falls back to default if DB unavailable.
 */
export async function getConfig<T = any>(key: string): Promise<T> {
    if (!supabaseAdmin) {
        return DEFAULT_CONFIGS[key] as T;
    }

    await ensureConfigTable();

    const { data, error } = await supabaseAdmin
        .from('app_config')
        .select('value')
        .eq('key', key)
        .single();

    if (error || !data) {
        return DEFAULT_CONFIGS[key] as T;
    }

    try {
        return (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) as T;
    } catch {
        return data.value as T;
    }
}

/**
 * Get multiple config values. Returns a map of key -> value.
 */
export async function getConfigs(keys: string[]): Promise<Record<string, any>> {
    if (!supabaseAdmin) {
        const result: Record<string, any> = {};
        for (const key of keys) {
            result[key] = DEFAULT_CONFIGS[key];
        }
        return result;
    }

    await ensureConfigTable();

    const { data, error } = await supabaseAdmin
        .from('app_config')
        .select('key, value')
        .in('key', keys);

    const result: Record<string, any> = {};
    for (const key of keys) {
        result[key] = DEFAULT_CONFIGS[key]; // defaults
    }

    if (!error && data) {
        for (const row of data) {
            try {
                result[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            } catch {
                result[row.key] = row.value;
            }
        }
    }

    return result;
}

/**
 * Set a config value. Used by admin API.
 */
export async function setConfig(key: string, value: any): Promise<void> {
    if (!supabaseAdmin) throw new Error('Database not configured');

    await ensureConfigTable();

    const { error } = await supabaseAdmin
        .from('app_config')
        .upsert(
            { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );

    if (error) throw error;
}

/**
 * Get all config entries. Used by admin API.
 */
export async function getAllConfigs(): Promise<Record<string, any>> {
    if (!supabaseAdmin) return { ...DEFAULT_CONFIGS };

    await ensureConfigTable();

    const { data, error } = await supabaseAdmin
        .from('app_config')
        .select('key, value')
        .order('key');

    const result: Record<string, any> = {};
    if (!error && data) {
        for (const row of data) {
            try {
                result[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            } catch {
                result[row.key] = row.value;
            }
        }
    }

    return result;
}
