import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfigs } from '@/lib/config';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

export async function GET(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);

        if (!authPayload || !authPayload.uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data, error } = await supabaseAdmin
            .from('user_vectors')
            .select('id, content, created_at, metadata')
            .eq('user_id', authPayload.uid)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ success: true, memories: data });
    } catch (error: any) {
        console.error('Fetch memories error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch memories' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);

        if (!authPayload || !authPayload.uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        if (body.clearAll) {
            // Delete all memories for this user
            const { error } = await supabaseAdmin
                .from('user_vectors')
                .delete()
                .eq('user_id', authPayload.uid);
            if (error) throw error;
            return NextResponse.json({ success: true, message: 'All memories cleared' });
        } else if (body.id) {
            // Delete specific memory
            const { error } = await supabaseAdmin
                .from('user_vectors')
                .delete()
                .eq('user_id', authPayload.uid)
                .eq('id', body.id);
            if (error) throw error;
            return NextResponse.json({ success: true, message: 'Memory deleted' });
        } else {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Delete memory error:', error);
        return NextResponse.json({ error: error.message || 'Failed to delete memory' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);

        if (!authPayload || !authPayload.uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        if (!body.id || !body.content || !body.content.trim()) {
            return NextResponse.json({ error: 'Invalid request: ID and content are required' }, { status: 400 });
        }

        // Re-vectorize the updated content
        const configs = await getConfigs(['memory_embedding_model']);
        const embeddingModelName = configs.memory_embedding_model || 'gemini-embedding-001';

        const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName });
        const embedResult = await embeddingModel.embedContent(body.content);
        const embedding = embedResult.embedding.values;

        // Update the database record
        const { data, error } = await supabaseAdmin
            .from('user_vectors')
            .update({
                content: body.content,
                embedding: embedding
            })
            .eq('id', body.id)
            .eq('user_id', authPayload.uid)
            .select('id, content, created_at, metadata');

        if (error) throw error;

        return NextResponse.json({ success: true, memory: data[0] });

    } catch (error: any) {
        console.error('Update memory error:', error);
        return NextResponse.json({ error: error.message || 'Failed to update memory' }, { status: 500 });
    }
}
