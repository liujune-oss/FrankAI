import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminToken, getAuthFromHeaders } from '@/lib/auth';

export async function GET(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const adminToken = req.cookies.get('admin_token')?.value || '';
        const isAdmin = await verifyAdminToken(adminToken);

        if (!isAdmin) {
            return NextResponse.json({ error: 'Unauthorized Admin' }, { status: 401 });
        }

        // Fetch memories with user info
        const { data, error } = await supabaseAdmin
            .from('user_vectors')
            .select(`
                id,
                content,
                created_at,
                metadata,
                user_id,
                users (
                    username
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Format the return data
        const formattedData = data.map((row: any) => ({
            id: row.id,
            user_id: row.user_id,
            username: row.users?.username || 'Unknown',
            content: row.content,
            created_at: row.created_at,
            metadata: row.metadata
        }));

        return NextResponse.json({ success: true, memories: formattedData });
    } catch (error: any) {
        console.error('Admin Fetch memories error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch memories' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const adminToken = req.cookies.get('admin_token')?.value || '';
        const isAdmin = await verifyAdminToken(adminToken);

        if (!isAdmin) {
            return NextResponse.json({ error: 'Unauthorized Admin' }, { status: 401 });
        }

        const body = await req.json();

        if (body.clear_user_id) {
            // Clear all memories for a specific user
            const { error } = await supabaseAdmin
                .from('user_vectors')
                .delete()
                .eq('user_id', body.clear_user_id);
            if (error) throw error;
            return NextResponse.json({ success: true, message: `All memories cleared for user ${body.clear_user_id}` });

        } else if (body.id) {
            // Delete specific memory
            const { error } = await supabaseAdmin
                .from('user_vectors')
                .delete()
                .eq('id', body.id);
            if (error) throw error;
            return NextResponse.json({ success: true, message: 'Memory deleted' });
        } else {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }

    } catch (error: any) {
        console.error('Admin Delete memory error:', error);
        return NextResponse.json({ error: error.message || 'Failed to delete memory' }, { status: 500 });
    }
}
