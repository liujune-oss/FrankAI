import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendLog } from '../chat/logger';
import { getConfigs } from '@/lib/config';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    try {
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);

        if (!authPayload || !authPayload.uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { messages, conv_id } = await req.json();

        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }
        appendLog("VECTORIZE RECEIVED MESSAGES:\n" + JSON.stringify(messages, null, 2));

        // Read model names from config
        const configs = await getConfigs(['memory_summary_model', 'memory_embedding_model']);
        const summaryModelName = configs.memory_summary_model || 'gemini-3-flash-preview';
        const embeddingModelName = configs.memory_embedding_model || 'gemini-embedding-001';

        // 1. Generate Summary using configured model
        const summaryModel = genAI.getGenerativeModel({ model: summaryModelName });

        // Format conversation for the prompt
        let conversationText = messages.map(m => {
            let extractedText = '';
            if (m.parts && Array.isArray(m.parts)) {
                extractedText = m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
            } else if (typeof m.content === 'string') {
                extractedText = m.content;
            } else if (Array.isArray(m.content)) {
                extractedText = m.content.find((p: any) => p.type === 'text')?.text || '';
            } else if (m.text) {
                extractedText = m.text;
            }
            return `${m.role === 'user' ? 'User' : 'Assistant'}: ${extractedText}`;
        }).join('\n');

        const prompt = `Analyze the following conversation and extract the user's core preferences, facts, and important context that would be useful for an AI to remember in future conversations. Provide a concise paragraph summarizing these points. \n\nConversation:\n${conversationText}`;

        const result = await summaryModel.generateContent(prompt);
        const summaryText = result.response.text();

        if (!summaryText.trim()) {
            throw new Error('Summary generation failed');
        }

        // 2. Generate Vector Embedding using standard 768 dimensions
        const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName });
        const embedResult = await embeddingModel.embedContent(summaryText);

        const embedding = embedResult.embedding.values;

        // 3. Store in Supabase pgvector
        const { error } = await supabaseAdmin
            .from('user_vectors')
            .insert([{
                user_id: authPayload.uid,
                content: summaryText,
                embedding: embedding,
                metadata: { source: 'conversation_summary', conv_id: conv_id || null }
            }]);

        if (error) throw error;

        return NextResponse.json({ success: true, summary: summaryText });
    } catch (error: any) {
        console.error('Vectorization error:', error);
        return NextResponse.json({ error: error.message || 'Optimization failed' }, { status: 500 });
    }
}
