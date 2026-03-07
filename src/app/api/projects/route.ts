import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';

export async function GET(req: NextRequest) {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin!
        .from('projects')
        .select('*')
        .eq('user_id', auth.uid)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ projects: data });
}

export async function POST(req: NextRequest) {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const payload = {
        user_id: auth.uid,
        title: body.title?.trim() || 'Untitled Project',
        description: body.description || null,
        status: body.status || 'planning',
        due_date: body.due_date || null,
        color: body.color || '#6366f1',
    };

    const { data, error } = await supabaseAdmin!
        .from('projects').insert(payload).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ project: data }, { status: 201 });
}
