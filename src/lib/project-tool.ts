import { supabaseAdmin } from './supabase';

export interface UpsertProjectArgs {
    title: string;
    description?: string;
    status?: string;
    due_date?: string;
    id?: string;
    [key: string]: unknown;
}

export const UPSERT_PROJECT_DECLARATION = {
    name: 'upsert_project',
    description: 'Create or update a project. Use this when the user asks to create a project, initiative, or goal that may contain multiple tasks.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Project name.' },
            description: { type: 'string', description: 'Optional description or goal.' },
            status: { type: 'string', description: 'planning, in_progress, completed, or on_hold. Default: planning.' },
            due_date: { type: 'string', description: 'ISO 8601 deadline (e.g. 2026-04-01T00:00:00Z).' },
            id: { type: 'string', description: 'UUID of existing project to update. Omit when creating.' },
        },
        required: ['title'],
    },
};

export async function executeUpsertProject(args: UpsertProjectArgs, userId: string): Promise<string> {
    if (!supabaseAdmin) return 'Error: Database connection not configured.';
    try {
        const payload = {
            title: args.title?.trim() || 'Untitled Project',
            description: args.description || null,
            status: args.status || 'planning',
            due_date: args.due_date || null,
            color: '#6366f1',
            user_id: userId,
        };

        if (args.id) {
            const { data, error } = await supabaseAdmin
                .from('projects').update(payload).eq('id', args.id).eq('user_id', userId).select().single();
            if (error) throw error;
            return JSON.stringify({ status: 'success', action: 'updated', title: data.title, id: data.id });
        } else {
            const { data, error } = await supabaseAdmin
                .from('projects').insert(payload).select().single();
            if (error) throw error;
            return JSON.stringify({ status: 'success', action: 'created', title: data.title, id: data.id });
        }
    } catch (error: any) {
        return `[FAILED] ${error.message}`;
    }
}
