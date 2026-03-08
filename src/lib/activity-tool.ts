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
            start_time: { type: 'string', description: 'ISO 8601 UTC start time (e.g. 2026-03-05T07:00:00Z for 3pm Shanghai).' },
            end_time: { type: 'string', description: 'ISO 8601 UTC end time or deadline.' },
            is_all_day: { type: 'boolean', description: 'True if the event lasts the entire day.' },
            priority: { type: 'string', description: 'low, medium, high, or urgent. Default: medium.' },
            location: { type: 'string', description: 'Physical location or virtual link.' },
            id: { type: 'string', description: 'UUID of existing activity to update. Omit when creating new.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Relevant semantic tags.' },
        },
        required: ['title'],
    },
};

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
        if (payload.type === 'task' && !payload.end_time && payload.start_time) {
            payload.end_time = payload.start_time;
            payload.start_time = null;
        }
        if (payload.type === 'event' && !payload.end_time && payload.start_time) {
            const start = new Date(payload.start_time);
            start.setHours(start.getHours() + 1);
            payload.end_time = start.toISOString();
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
