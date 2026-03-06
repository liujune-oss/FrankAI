import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenAI } from '@google/genai';
import { getConfigs } from '@/lib/config';

export const maxDuration = 120;

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

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

        const { messages, session_id, chunk_index = 0 } = await req.json();

        if (!session_id || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // 1. 提取纯文本
        const messagesData = messages.map(m => {
            let text = '';
            if (m.parts && Array.isArray(m.parts)) {
                text = m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
            } else if (typeof m.content === 'string') {
                text = m.content;
            } else if (Array.isArray(m.content)) {
                text = m.content.find((p: any) => p.type === 'text')?.text || '';
            } else if (m.text) {
                text = m.text;
            }
            return { user_id: authPayload.uid, session_id, role: m.role, content: text };
        });

        // 2. 写入原始消息日志（仅用于管理后台，不用于 RAG）
        await supabaseAdmin.from('chat_messages').insert(messagesData);

        // 3. 生成摘要
        const configs = await getConfigs(['memory_summary_model', 'memory_embedding_model']);
        const summaryModelName = configs.memory_summary_model || 'gemini-2.0-flash';
        const embeddingModelName = configs.memory_embedding_model || 'gemini-embedding-001';

        const conversationText = messagesData
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n');

        const summaryPrompt = `Analyze the following conversation and extract the user's core preferences, facts, actions, ` +
            `and important context useful for an AI to remember in future conversations. ` +
            `Provide a highly condensed paragraph. Do not include pleasantries.\n\n` +
            `Conversation:\n${conversationText}`;
        const summaryResult = await genai.models.generateContent({
            model: summaryModelName,
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
        });
        const summaryText = (summaryResult.text || '').trim();

        if (!summaryText) {
            throw new Error('Summary generation failed');
        }

        // 4. 生成 embedding
        const embedResult = await genai.models.embedContent({
            model: embeddingModelName,
            contents: summaryText,
        });
        const embedding = embedResult.embeddings?.[0]?.values ?? [];

        // 5. 追加写入 memories_chunks（不删除旧数据）
        const { error: chunkError } = await supabaseAdmin
            .from('memories_chunks')
            .insert([{
                user_id: authPayload.uid,
                session_id,
                chunk_index,
                summary_text: summaryText,
                embedding,
                message_count: messages.length,
            }]);

        if (chunkError) {
            console.error('Insert memories_chunks error:', chunkError);
            throw chunkError;
        }

        // 6. 异步更新 core memory（不阻塞响应）
        updateCoreMemory(authPayload.uid, summaryText, summaryModelName).catch(e =>
            console.error('Core memory update failed:', e)
        );

        return NextResponse.json({ success: true, count: messages.length });
    } catch (error: any) {
        console.error('Sync memory error:', error);
        return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
    }
}

async function updateCoreMemory(userId: string, newChunkSummary: string, modelName: string) {
    if (!supabaseAdmin) return;

    const { data: existing } = await supabaseAdmin
        .from('user_core_memory')
        .select('content')
        .eq('user_id', userId)
        .single();

    const currentCore = existing?.content || '';

    const corePrompt = `已知用户核心记忆：\n${currentCore || '（暂无）'}\n\n` +
        `本次新对话摘要：\n${newChunkSummary}\n\n` +
        `判断：本次对话是否包含应该长期记住的新事实（如用户姓名、偏好、重要事件）？\n` +
        `- 若有：返回更新后的完整核心记忆（保持简洁，不超过300字，中文）\n` +
        `- 若无：仅返回 NO_UPDATE`;
    const result = await genai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: corePrompt }] }],
    });

    const response = (result.text || '').trim();
    if (response === 'NO_UPDATE') return;

    await supabaseAdmin
        .from('user_core_memory')
        .upsert({ user_id: userId, content: response, updated_at: new Date().toISOString() });
}
