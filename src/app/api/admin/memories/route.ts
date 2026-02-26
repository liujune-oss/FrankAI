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

        // Fetch memories WITHOUT implicit user info join since FK was removed
        const { data: memoriesData, error: memoriesError } = await supabaseAdmin
            .from('memories_tier1')
            .select('*')
            .order('created_at', { ascending: false });

        if (memoriesError) throw memoriesError;

        // Fetch user mapping manually
        const userIds = [...new Set(memoriesData.map((m: any) => m.user_id).filter(Boolean))];
        let userMap: Record<string, string> = {};

        if (userIds.length > 0) {
            const { data: usersData } = await supabaseAdmin
                .from('users')
                .select('id, username')
                .in('id', userIds);

            if (usersData) {
                usersData.forEach((u: any) => {
                    userMap[u.id] = u.username;
                });
            }
        }

        // Format the return data
        const formattedData = memoriesData.map((row: any) => ({
            id: row.id,
            user_id: row.user_id,
            session_id: row.session_id,
            username: userMap[row.user_id] || 'Unknown',
            summary_text: row.summary_text,
            start_message_id: row.start_message_id,
            end_message_id: row.end_message_id,
            created_at: row.created_at
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
                .from('memories_tier1')
                .delete()
                .eq('user_id', body.clear_user_id);
            if (error) throw error;
            return NextResponse.json({ success: true, message: `All memories cleared for user ${body.clear_user_id}` });

        } else if (body.id) {
            // Delete specific memory
            const { error } = await supabaseAdmin
                .from('memories_tier1')
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
