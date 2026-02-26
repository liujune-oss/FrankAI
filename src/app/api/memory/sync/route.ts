import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfigs } from '@/lib/config';

export const maxDuration = 120; // 2 minutes max depending on model speed

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

        const { messages, session_id } = await req.json();

        if (!session_id || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // 1. Prepare raw messages for Tier-2 extraction
        const messagesData = messages.map(m => {
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
            return {
                user_id: authPayload.uid,
                session_id: session_id,
                role: m.role,
                content: extractedText
            };
        });

        // Insert messages into raw chat logs
        const { data: insertedMessages, error: insertError } = await supabaseAdmin
            .from('chat_messages')
            .insert(messagesData)
            .select('id');

        if (insertError) {
            console.error('Insert chat_messages error:', insertError);
            throw insertError;
        }

        const start_message_id = insertedMessages?.[0]?.id || null;
        const end_message_id = insertedMessages?.[insertedMessages.length - 1]?.id || null;

        // 2. Generate Summary for the chunk
        const configs = await getConfigs(['memory_summary_model', 'memory_embedding_model']);
        const summaryModelName = configs.memory_summary_model || 'gemini-3-flash-preview';
        const embeddingModelName = configs.memory_embedding_model || 'gemini-embedding-001';

        const conversationText = messagesData.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

        const summaryModel = genAI.getGenerativeModel({ model: summaryModelName });
        const prompt = `Analyze the following conversation chunk and extract the user's core preferences, facts, actions, and important context that would be useful for an AI to remember in future conversations. Provide a highly condensed paragraph summarizing these points. Do not include pleasantries. \n\nConversation Chunk:\n${conversationText}`;

        const result = await summaryModel.generateContent(prompt);
        const summaryText = result.response.text();

        if (!summaryText.trim()) {
            throw new Error('Summary generation failed');
        }

        // 3. Generate Vector Embedding dynamically based on the returned array
        const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName });
        const embedResult = await embeddingModel.embedContent(summaryText);
        const embedding = embedResult.embedding.values;

        // 4. Store into Tier 1 Memory table
        const { error: tier1Error } = await supabaseAdmin
            .from('memories_tier1')
            .insert([{
                user_id: authPayload.uid,
                session_id: session_id,
                summary_text: summaryText,
                embedding: embedding,
                start_message_id: start_message_id,
                end_message_id: end_message_id
            }]);

        if (tier1Error) {
            console.error('Insert memories_tier1 error:', tier1Error);
            throw tier1Error;
        }

        return NextResponse.json({ success: true, count: messages.length });
    } catch (error: any) {
        console.error('Sync memory error:', error);
        return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
    }
}
