import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';

export async function GET(req: NextRequest) {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const auth = await verifyToken(token, fingerprint);
    if (!auth?.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch projects
    const { data: projects, error } = await supabaseAdmin!
        .from('projects')
        .select('*')
        .eq('user_id', auth.uid)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch activity counts per project
    const { data: activities } = await supabaseAdmin!
        .from('activities')
        .select('project_id, status')
        .eq('user_id', auth.uid)
        .not('project_id', 'is', null);

    // Build activity stats map
    const statsMap: Record<string, { total: number; completed: number }> = {};
    for (const a of activities || []) {
        if (!a.project_id) continue;
        if (!statsMap[a.project_id]) statsMap[a.project_id] = { total: 0, completed: 0 };
        statsMap[a.project_id].total++;
        if (a.status === 'completed') statsMap[a.project_id].completed++;
    }

    // Attach stats to projects
    const projectsWithStats = (projects || []).map(p => ({
        ...p,
        activity_stats: statsMap[p.id] || { total: 0, completed: 0 },
    }));

    return NextResponse.json({ projects: projectsWithStats });
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
