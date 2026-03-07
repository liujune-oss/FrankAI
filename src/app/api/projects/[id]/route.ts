import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin!
        .from('projects').select('*').eq('id', id).eq('user_id', auth.uid).single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ project: data });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const allowed = ['title', 'description', 'status', 'due_date', 'color'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
        if (key in body) payload[key] = body[key];
    }

    const { data, error } = await supabaseAdmin!
        .from('projects').update(payload).eq('id', id).eq('user_id', auth.uid).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ project: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabaseAdmin!
        .from('projects').delete().eq('id', id).eq('user_id', auth.uid);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
