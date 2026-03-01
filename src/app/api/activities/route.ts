import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthFromHeaders, verifyToken } from '@/lib/auth';

/**
 * Get the authenticated user ID from the request headers
 */
async function getUserIdFromRequest(req: Request): Promise<string | null> {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const payload = await verifyToken(token, fingerprint);
    if (!payload || !payload.uid) return null;
    return payload.uid;
}

// GET: Retrieve activities for the user
export async function GET(req: Request) {
    try {
        const userId = await getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const type = searchParams.get('type');
        const status = searchParams.get('status');
        const startDate = searchParams.get('start');
        const endDate = searchParams.get('end');

        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        let query = supabase
            .from('activities')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (type) query = query.eq('type', type);
        if (status) query = query.eq('status', status);

        // Time range filtering
        if (startDate) query = query.gte('start_time', startDate);
        if (endDate) query = query.lte('end_time', endDate);

        const { data, error } = await query;

        if (error) throw error;

        return NextResponse.json({ activities: data });
    } catch (error: any) {
        console.error('Failed to fetch activities:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

// POST: Create a new activity
export async function POST(req: Request) {
    try {
        const userId = await getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        // Construct the insert payload, ensuring user_id is set
        const insertData = {
            ...body,
            user_id: userId,
        };

        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data, error } = await supabase
            .from('activities')
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ activity: data }, { status: 201 });
    } catch (error: any) {
        console.error('Failed to create activity:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

// PUT: Update an existing activity
export async function PUT(req: Request) {
    try {
        const userId = await getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { id, ...updateData } = body;

        if (!id) {
            return NextResponse.json({ error: 'Activity ID is required' }, { status: 400 });
        }

        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data, error } = await supabase
            .from('activities')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId) // Extra safety check, though RLS handles this
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ activity: data });
    } catch (error: any) {
        console.error('Failed to update activity:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE: Delete an activity
export async function DELETE(req: Request) {
    try {
        const userId = await getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Activity ID is required' }, { status: 400 });
        }

        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { error } = await supabase
            .from('activities')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Failed to delete activity:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
