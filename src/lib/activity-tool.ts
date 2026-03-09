import { supabaseAdmin } from './supabase';

export interface UpsertActivityArgs {
    title?: string;
    description?: string;
    type?: string;
    start_time?: string | null;
    end_time?: string;
    is_all_day?: boolean;
    priority?: string;
    location?: string;
    id?: string;
    tags?: string[];
    status?: string;
    activities?: UpsertActivityArgs[];
    activity?: UpsertActivityArgs;
    activity_type?: string;
    summary?: string;
    [key: string]: unknown;
}

export const UPSERT_ACTIVITY_DECLARATION = {
    name: 'upsert_activity',
    description: 'Create or update a user activity. Use this tool when the user asks to schedule an event, set a reminder, or create a task/to-do item.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'A short, concise title for the activity.' },
            description: { type: 'string', description: 'Detailed description or notes.' },
            type: { type: 'string', description: 'Category: event (meetings, appointments), task (todos), reminder, log, or milestone (key date/achievement in a project).' },
            start_time: { type: 'string', description: 'Local time in ISO 8601 format WITHOUT timezone suffix, e.g. "2026-03-09T14:00:00" for 2pm. Do NOT convert to UTC.' },
            end_time: { type: 'string', description: 'Local end time in ISO 8601 format WITHOUT timezone suffix, e.g. "2026-03-09T15:00:00". Do NOT convert to UTC.' },
            is_all_day: { type: 'boolean', description: 'True if the event lasts the entire day.' },
            priority: { type: 'string', description: 'low, medium, high, or urgent. Default: medium.' },
            location: { type: 'string', description: 'Physical location or virtual link.' },
            id: { type: 'string', description: 'UUID of existing activity to update. Omit when creating new.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Semantic tags you freely infer from the activity content. Always provide at least 1-3 tags. Examples: ["工作", "会议"], ["健身", "习惯"], ["项目A", "紧急"].' },
        },
        required: ['title', 'tags'],
    },
};

/**
 * 将时间字符串标准化为 UTC ISO 字符串。
 * AI 输出的是上海本地时间（无时区后缀），统一加 +08:00 转 UTC。
 * 若已有 Z 或 +/- 时区信息则直接解析。
 */
function toUTCString(timeStr: string | null | undefined): string | null | undefined {
    if (!timeStr) return timeStr;
    if (timeStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(timeStr)) {
        return new Date(timeStr).toISOString();
    }
    // 无时区 → 视为上海本地时间 +08:00
    return new Date(timeStr + '+08:00').toISOString();
}

export async function executeUpsertActivity(args: UpsertActivityArgs, userId: string): Promise<string> {
    if (!supabaseAdmin) return 'Error: Database connection not configured.';
    try {
        let normalizedArgs = { ...args };
        if (normalizedArgs.activities?.length) normalizedArgs = normalizedArgs.activities[0];
        else if (normalizedArgs.activity && typeof normalizedArgs.activity === 'object') normalizedArgs = normalizedArgs.activity;

        const payload: UpsertActivityArgs & { user_id: string } = { ...normalizedArgs, user_id: userId };

        if (payload.activity_type && !payload.type) { payload.type = payload.activity_type; }
        delete payload.activity_type;
        if (payload.summary && !payload.title) { payload.title = payload.summary; }
        delete payload.summary;
        if (!payload.title || typeof payload.title !== 'string' || payload.title.trim() === '') payload.title = 'Untitled Activity';
        if (!payload.type) payload.type = (payload.start_time && payload.end_time) ? 'event' : 'task';

        // 先转 UTC（AI 输出本地时间无时区后缀 → 视为 +08:00）
        // 必须在时间补算之前执行，否则补算出的 end_time 会带 Z 跳过转换
        if (payload.start_time) payload.start_time = toUTCString(payload.start_time) ?? undefined;
        if (payload.end_time)   payload.end_time   = toUTCString(payload.end_time)   ?? undefined;

        if (payload.type === 'task' && !payload.end_time && payload.start_time) {
            payload.end_time = payload.start_time;
            payload.start_time = null;
        }
        if (payload.type === 'event' && !payload.end_time && payload.start_time) {
            const start = new Date(payload.start_time);
            start.setHours(start.getHours() + 1);
            payload.end_time = start.toISOString();
        }
        // milestone: prefer start_time; if only end_time set, move it to start_time
        if (payload.type === 'milestone') {
            if (!payload.start_time && payload.end_time) {
                payload.start_time = payload.end_time;
                payload.end_time = undefined;
            }
        }

        const allowedKeys = ['id', 'user_id', 'type', 'title', 'description', 'start_time', 'end_time', 'is_all_day', 'location', 'priority', 'status', 'repetition_rule', 'tags', 'metadata', 'project_id'];
        Object.keys(payload).forEach(key => { if (!allowedKeys.includes(key)) delete (payload as Record<string, unknown>)[key]; });

        if (payload.id) {
            const { data, error } = await supabaseAdmin.from('activities').update(payload).eq('id', payload.id).eq('user_id', userId).select().single();
            if (error) throw error;
            return JSON.stringify({ status: 'success', action: 'updated', type: data.type, title: data.title, id: data.id });
        } else {
            const { data, error } = await supabaseAdmin.from('activities').insert(payload).select().single();
            if (error) throw error;
            return JSON.stringify({ status: 'success', action: 'created', type: data.type, title: data.title, id: data.id, start_time: data.start_time, end_time: data.end_time });
        }
    } catch (error: any) {
        return `[FAILED] ${error.message}`;
    }
}
