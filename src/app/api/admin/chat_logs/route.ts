import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminToken } from '@/lib/auth';

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

        // Fetch raw messages WITHOUT implicit user joins since FK was removed
        const { data: messagesData, error: messagesError } = await supabaseAdmin
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000); // Limit to recent 1000 for performance

        if (messagesError) throw messagesError;

        // Fetch user mapping manually
        const userIds = [...new Set(messagesData.map((m: any) => m.user_id).filter(Boolean))];
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

        const formattedData = messagesData.map((row: any) => ({
            id: row.id,
            user_id: row.user_id,
            session_id: row.session_id,
            username: userMap[row.user_id] || 'Unknown',
            role: row.role,
            content: row.content,
            created_at: row.created_at,
        }));

        return NextResponse.json({ success: true, messages: formattedData });
    } catch (error: any) {
        console.error('Admin Fetch chat messages error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch messages' }, { status: 500 });
    }
}
