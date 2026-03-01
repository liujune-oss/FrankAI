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
    voice_intent_prompt: `你是一个专业的语音转写助手。请将这段语音内容转化为准确、连贯的文字。
要求：
1. 修正语音识别中的明显口误和同音字错误。
2. 去除不必要的语气词（如“啊”、“呃”、“那个”等），保留核心语义信息。
3. 如果语音中包含明确的时间、地点或任务要求，请确保字面准确无误地转录。
4. **仅输出转换后的文字内容，不要输出任何额外的解释或 JSON 结构。**`,
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
