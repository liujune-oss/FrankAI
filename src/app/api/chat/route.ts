// @ts-nocheck
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { supabaseAdmin } from '@/lib/supabase';
import { appendLog } from './logger';
import { getConfig } from '@/lib/config';

// Allow streaming responses up to 120 seconds (Pro models think longer)
export const maxDuration = 120;

// 鈹€鈹€鈹€ Tool Declarations 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const UPSERT_ACTIVITY_DECLARATION = {
    name: 'upsert_activity',
    description: 'Create or update a user activity. Use this tool when the user asks to schedule an event, set a reminder, or create a task/to-do item.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            title: { type: SchemaType.STRING, description: 'A short, concise title for the activity.' },
            description: { type: SchemaType.STRING, description: 'Detailed description or notes.' },
            type: { type: SchemaType.STRING, description: 'Category: event, task, reminder, or log.' },
            start_time: { type: SchemaType.STRING, description: 'ISO 8601 UTC start time (e.g. 2026-03-05T07:00:00Z for 3pm Shanghai).' },
            end_time: { type: SchemaType.STRING, description: 'ISO 8601 UTC end time or deadline.' },
            is_all_day: { type: SchemaType.BOOLEAN, description: 'True if the event lasts the entire day.' },
            priority: { type: SchemaType.STRING, description: 'low, medium, high, or urgent. Default: medium.' },
            location: { type: SchemaType.STRING, description: 'Physical location or virtual link.' },
            id: { type: SchemaType.STRING, description: 'UUID of existing activity to update. Omit when creating new.' },
            tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Relevant semantic tags.' },
        },
        required: ['title'],
    },
};

// 鈹€鈹€鈹€ Execute upsert_activity locally 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function executeUpsertActivity(args: any, userId: string): Promise<string> {
    appendLog(`[upsert_activity] TOOL CALLED. args: ${JSON.stringify(args)}`);
    if (!supabaseAdmin) {
        appendLog(`[upsert_activity] ERROR: supabaseAdmin is null`);
        return 'Error: Database connection not configured.';
    }
    try {
        let normalizedArgs = { ...args };
        if (normalizedArgs.activities && Array.isArray(normalizedArgs.activities) && normalizedArgs.activities.length > 0) {
            normalizedArgs = normalizedArgs.activities[0];
        } else if (normalizedArgs.activity && typeof normalizedArgs.activity === 'object') {
            normalizedArgs = normalizedArgs.activity;
        }

        const payload: any = { ...normalizedArgs, user_id: userId };

        if (payload.activity_type && !payload.type) { payload.type = payload.activity_type; }
        delete payload.activity_type;
        if (payload.summary && !payload.title) { payload.title = payload.summary; }
        delete payload.summary;
        if (!payload.title || typeof payload.title !== 'string' || payload.title.trim() === '') {
            payload.title = 'Untitled Activity';
        }
        if (!payload.type) {
            payload.type = (payload.start_time && payload.end_time) ? 'event' : 'task';
        }
        if (payload.type === 'task' && !payload.end_time && payload.start_time) {
            payload.end_time = payload.start_time;
            payload.start_time = null;
        }
        if (payload.type === 'event' && !payload.end_time && payload.start_time) {
            const start = new Date(payload.start_time);
            start.setHours(start.getHours() + 1);
            payload.end_time = start.toISOString();
        }

        const allowedKeys = ['id', 'user_id', 'type', 'title', 'description', 'start_time', 'end_time', 'is_all_day', 'location', 'priority', 'status', 'repetition_rule', 'tags', 'metadata'];
        Object.keys(payload).forEach(key => { if (!allowedKeys.includes(key)) delete payload[key]; });

        appendLog(`[upsert_activity] Constructed payload: ${JSON.stringify(payload)}`);

        if (payload.id) {
            const { data, error } = await supabaseAdmin.from('activities').update(payload).eq('id', payload.id).eq('user_id', userId).select().single();
            if (error) { appendLog(`[upsert_activity] UPDATE ERROR: ${JSON.stringify(error)}`); throw error; }
            appendLog(`[upsert_activity] UPDATE SUCCESS: ${data.id}`);
            return `Successfully updated ${payload.type} "${data.title}" (ID: ${data.id}).`;
        } else {
            const { data, error } = await supabaseAdmin.from('activities').insert(payload).select().single();
            if (error) { appendLog(`[upsert_activity] INSERT ERROR: ${JSON.stringify(error)}`); throw error; }
            appendLog(`[upsert_activity] INSERT SUCCESS: ${data.id}`);
            return JSON.stringify({ status: 'success', action: 'created', type: data.type, title: data.title, id: data.id, start_time: data.start_time, end_time: data.end_time });
        }
    } catch (error: any) {
        appendLog(`[upsert_activity] CATCH EXCEPTION: ${error.message || error}`);
        return `[FAILED] Failed to save activity: ${error.message}. Tell the user this failed.`;
    }
}

// 鈹€鈹€鈹€ SSE Helper 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function sseEvent(data: object): string {
    return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
    // Auth check
    const { token, fingerprint } = getAuthFromHeaders(req);
    const authPayload = await verifyToken(token, fingerprint);
    if (!authPayload || !authPayload.uid) {
        return new Response('Unauthorized', { status: 401 });
    }

    const { limited } = await checkChatRateLimit(authPayload.uid);
    if (limited) {
        return new Response('Too Many Requests', { status: 429 });
    }

    try {
        const { messages, systemInstruction } = await req.json();
        const url = new URL(req.url);
        const model = url.searchParams.get('model') || 'gemini-2.5-pro';

        let finalSystemInstruction = systemInstruction || '';

        // ── 三层记忆 RAG ────────────────────────────────────────────
        const latestMessage = messages[messages.length - 1];
        let queryText = '';
        if (latestMessage && latestMessage.role === 'user') {
            if (latestMessage.parts && Array.isArray(latestMessage.parts)) {
                queryText = latestMessage.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
            } else if (typeof latestMessage.content === 'string') {
                queryText = latestMessage.content;
            } else if (Array.isArray(latestMessage.content)) {
                const textPart = latestMessage.content.find((p: any) => p.type === 'text');
                if (textPart) queryText = textPart.text;
            } else if (latestMessage.text) {
                queryText = latestMessage.text;
            }
        }

        if (queryText && supabaseAdmin) {
            try {
                const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
                const embeddingModelName = await getConfig<string>('memory_embedding_model') || 'gemini-embedding-001';

                // Layer 1 + Layer 2：并行查询（无需 embedding）
                const [coreResult, recallResult, embedResult] = await Promise.all([
                    // 热层：用户核心记忆
                    supabaseAdmin
                        .from('user_core_memory')
                        .select('content')
                        .eq('user_id', authPayload.uid)
                        .single(),
                    // 温层：最近 5 条摘要
                    supabaseAdmin
                        .from('memories_chunks')
                        .select('id, summary_text, created_at')
                        .eq('user_id', authPayload.uid)
                        .order('created_at', { ascending: false })
                        .limit(5),
                    // 同时 embed 查询文本，供冷层使用
                    genAI.getGenerativeModel({ model: embeddingModelName }).embedContent(queryText),
                ]);

                const coreContent = coreResult.data?.content || '';
                const recallChunks = recallResult.data || [];
                const embedding = embedResult.embedding.values;

                // Layer 3：冷层向量搜索（排除温层已有的 chunk）
                const recallIds = recallChunks.map((c: any) => c.id);
                const { data: archivalChunks } = await supabaseAdmin.rpc('match_archival_memories', {
                    query_embedding: embedding,
                    match_threshold: 0.6,
                    match_count: 3,
                    p_user_id: authPayload.uid,
                    exclude_ids: recallIds,
                });

                // 组装注入
                const parts: string[] = [];

                if (coreContent) {
                    parts.push(`<core>\n${coreContent}\n</core>`);
                }

                if (recallChunks.length > 0) {
                    const recallText = recallChunks
                        .map((c: any) => `[${c.created_at?.slice(0, 10)}] ${c.summary_text}`)
                        .join('\n');
                    parts.push(`<recent>\n${recallText}\n</recent>`);
                }

                if (archivalChunks && archivalChunks.length > 0) {
                    const archivalText = archivalChunks
                        .map((c: any) => `[${c.created_at?.slice(0, 10) || ''}] ${c.summary_text}`)
                        .join('\n');
                    parts.push(`<relevant>\n${archivalText}\n</relevant>`);
                }

                if (parts.length > 0) {
                    const memoryXml = `<memory>\n${parts.join('\n')}\n</memory>`;
                    finalSystemInstruction = `<system_instructions>\n${finalSystemInstruction}\n</system_instructions>\n\n${memoryXml}`;
                    appendLog(`Memory injected: core=${!!coreContent}, recall=${recallChunks.length}, archival=${archivalChunks?.length || 0}`);
                } else {
                    appendLog('No memory found for this user.');
                }
            } catch (err) {
                appendLog('Memory RAG error: ' + err);
            }
        }

        // Build system instruction with time context and tool guidance
        const systemNow = new Date();
        const systemTimeStr = '[CRITICAL CONTEXT] Current UTC time: ' + systemNow.toISOString() + ' (Shanghai = UTC+8, so current local time is ' + new Date(systemNow.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00') + '). When the user says today/tomorrow/next week, calculate based on this timestamp.';
        finalSystemInstruction = systemTimeStr + '\n\n' + finalSystemInstruction;
        // Inject current request text to prevent model from re-creating previous activities
        const currentRequestText = queryText || '';
        finalSystemInstruction += '\n\n[ANTI-DUPLICATE RULE — HIGHEST PRIORITY]\n' +
            'The user\'s CURRENT request (the one you must respond to right now) is:\n' +
            '"""\n' + currentRequestText + '\n"""\n\n' +
            'ABSOLUTE RULES:\n' +
            '- You may ONLY call upsert_activity for items explicitly mentioned in the CURRENT request above.\n' +
            '- Every activity mentioned in EARLIER conversation turns is ALREADY SAVED TO THE DATABASE. Do NOT call upsert_activity for those items again.\n' +
            '- Count carefully: the number of upsert_activity calls must equal the number of NEW items in the CURRENT request only.\n' +
            '- After all tool calls complete, confirm ONLY what was created in this turn.';
        finalSystemInstruction += '\n\n[Time Zone] All timestamps MUST be in UTC (Z suffix). Shanghai is UTC+8, so 8 PM local = 12:00Z.';

        // Convert messages to Google AI format
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
        const geminiModel = genAI.getGenerativeModel({
            model,
            systemInstruction: finalSystemInstruction,
            tools: [{ functionDeclarations: [UPSERT_ACTIVITY_DECLARATION] }],
        });

        // Build message history
        const history: any[] = [];
        for (const msg of messages.slice(0, -1)) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            let parts: any[] = [];
            if (typeof msg.content === 'string') {
                parts = [{ text: msg.content }];
            } else if (Array.isArray(msg.content)) {
                parts = msg.content.map((p: any) => {
                    if (p.type === 'text') return { text: p.text || p.content || '' };
                    if (p.type === 'image') return { inlineData: { mimeType: p.mimeType || 'image/jpeg', data: p.image } };
                    return { text: '' };
                }).filter((p: any) => p.text !== '' || p.inlineData);
            } else if (msg.parts) {
                parts = msg.parts.map((p: any) => {
                    if (p.type === 'text') return { text: p.text || '' };
                    return { text: '' };
                }).filter((p: any) => p.text !== '');
            }
            if (parts.length > 0) history.push({ role, parts });
        }

        // Last user message
        const lastMsg = messages[messages.length - 1];
        let lastParts: any[] = [];
        if (typeof lastMsg.content === 'string') {
            lastParts = [{ text: lastMsg.content }];
        } else if (Array.isArray(lastMsg.content)) {
            lastParts = lastMsg.content.map((p: any) => {
                if (p.type === 'text') return { text: p.text || p.content || '' };
                if (p.type === 'image') return { inlineData: { mimeType: p.mimeType || 'image/jpeg', data: p.image } };
                return null;
            }).filter(Boolean);
        } else if (lastMsg.parts) {
            lastParts = lastMsg.parts.map((p: any) => ({ text: p.text || '' })).filter((p: any) => p.text);
        } else if (lastMsg.text) {
            lastParts = [{ text: lastMsg.text }];
        }

        const chat = geminiModel.startChat({ history });

        // Build the SSE stream with tool-call loop
        const stream = new ReadableStream({
            async start(controller) {
                const enc = new TextEncoder();
                function send(data: object) { controller.enqueue(enc.encode(sseEvent(data))); }

                try {
                    send({ type: 'start' });
                    let currentParts = lastParts;
                    const MAX_STEPS = 5;

                    // Collect all tool results across steps for isolated confirmation
                    const allExecutedResults: { toolName: string; args: any; result: string }[] = [];
                    let anyToolsExecuted = false;
                    let anyTextStreamed = false;

                    // Extract original user text for the isolated confirmation call
                    const originalUserText = lastParts.filter((p: any) => p.text).map((p: any) => p.text).join('\n');

                    for (let step = 0; step < MAX_STEPS; step++) {
                        send({ type: 'start-step' });

                        const result = await chat.sendMessageStream(currentParts);

                        let toolCalls: any[] = [];
                        let hasText = false;

                        for await (const chunk of result.stream) {
                            const candidate = chunk.candidates?.[0];
                            if (!candidate) continue;

                            for (const part of candidate.content?.parts || []) {
                                if (part.text) {
                                    // Only stream text directly if NO tools have been executed yet.
                                    // After tool execution, we use isolated confirmation (see Phase 2 below).
                                    if (!anyToolsExecuted) {
                                        if (!hasText) { send({ type: 'text-start', id: '0' }); hasText = true; }
                                        send({ type: 'text-delta', id: '0', delta: part.text });
                                        anyTextStreamed = true;
                                    }
                                } else if (part.functionCall) {
                                    const fc = part.functionCall;
                                    send({ type: 'tool-call', toolCallId: fc.name + '_' + step, toolName: fc.name, args: fc.args });
                                    toolCalls.push(fc);
                                }
                            }
                        }

                        // result.response fallback: only for pure-text steps with no tools run yet
                        if (!anyToolsExecuted && !hasText && toolCalls.length === 0) {
                            try {
                                const finalResp = await result.response;
                                const finalText = (finalResp.candidates?.[0]?.content?.parts || [])
                                    .filter((p: any) => p.text).map((p: any) => p.text).join('');
                                if (finalText) {
                                    send({ type: 'text-start', id: '0' }); hasText = true;
                                    send({ type: 'text-delta', id: '0', delta: finalText });
                                    anyTextStreamed = true;
                                }
                            } catch (e) { appendLog(`result.response fallback error: ${e}`); }
                        }

                        if (hasText) send({ type: 'text-end', id: '0' });

                        if (toolCalls.length === 0) {
                            // No more tool calls — loop ends here
                            send({ type: 'finish-step', finishReason: 'stop' });
                            break;
                        }

                        send({ type: 'finish-step', finishReason: 'tool-calls' });

                        // Execute tools
                        const funcResponseParts: any[] = [];
                        for (const toolCall of toolCalls) {
                            let toolResult = 'Tool executed.';
                            if (toolCall.name === 'upsert_activity') {
                                toolResult = await executeUpsertActivity(toolCall.args, authPayload.uid);
                            }
                            send({ type: 'tool-result', toolCallId: toolCall.name + '_' + step, toolName: toolCall.name, result: toolResult });
                            allExecutedResults.push({ toolName: toolCall.name, args: toolCall.args, result: toolResult });

                            let parsedResult: any = null;
                            try { parsedResult = JSON.parse(toolResult); } catch { }
                            funcResponseParts.push({
                                functionResponse: {
                                    name: toolCall.name,
                                    response: parsedResult || { result: toolResult }
                                }
                            });
                        }

                        anyToolsExecuted = true;
                        currentParts = funcResponseParts;
                    }

                    // Phase 2: Isolated confirmation (only when tools were run)
                    // Uses a FRESH model with NO history — only user message + current tool results.
                    // This completely prevents the model from referencing previous turns.
                    if (anyToolsExecuted) {
                        send({ type: 'start-step' });

                        const resultSummary = allExecutedResults.map(r => {
                            try {
                                const p = JSON.parse(r.result);
                                const timeStr = p.start_time ? ` at ${p.start_time}` : '';
                                return `- Created ${p.type}: "${p.title}"${timeStr}`;
                            } catch { return `- ${r.toolName} executed`; }
                        }).join('\n');

                        const confirmModel = genAI.getGenerativeModel({
                            model,
                            systemInstruction: 'You are a helpful assistant. Write a short, friendly reply in the same language as the user. Be warm and personal. Do NOT add unnecessary lists or elaborate markdown unless the user asked for it.',
                        });

                        const confirmPrompt = 'User request: "' + originalUserText + '"\n\nWhat was just done:\n' + resultSummary + '\n\nWrite a brief, friendly confirmation to the user (1-3 sentences max).';
                        const confirmResult = await confirmModel.generateContentStream({
                            contents: [{ role: 'user', parts: [{ text: confirmPrompt }] }]
                        });

                        let confirmHasText = false;
                        for await (const chunk of confirmResult.stream) {
                            const candidate = chunk.candidates?.[0];
                            if (!candidate) continue;
                            for (const part of candidate.content?.parts || []) {
                                if (part.text) {
                                    if (!confirmHasText) { send({ type: 'text-start', id: '0' }); confirmHasText = true; }
                                    send({ type: 'text-delta', id: '0', delta: part.text });
                                }
                            }
                        }

                        // 兜底1：流为空时尝试 result.response
                        if (!confirmHasText) {
                            try {
                                const finalResp = await confirmResult.response;
                                const fallbackText = (finalResp?.candidates?.[0]?.content?.parts || [])
                                    .filter((p: any) => p.text).map((p: any) => p.text).join('');
                                if (fallbackText) {
                                    send({ type: 'text-start', id: '0' });
                                    send({ type: 'text-delta', id: '0', delta: fallbackText });
                                    confirmHasText = true;
                                }
                            } catch (e) { appendLog('Phase 2 response fallback error: ' + e); }
                        }

                        // 兜底2：两层都空时发硬编码确认
                        if (!confirmHasText) {
                            const fallback = allExecutedResults.map(r => {
                                try { const p = JSON.parse(r.result); return `"${p.title}" 已创建成功。`; }
                                catch { return '操作已完成。'; }
                            }).join(' ');
                            send({ type: 'text-start', id: '0' });
                            send({ type: 'text-delta', id: '0', delta: fallback });
                            confirmHasText = true;
                        }

                        if (confirmHasText) send({ type: 'text-end', id: '0' });
                        send({ type: 'finish-step', finishReason: 'stop' });
                    }

                    send({ type: 'finish', finishReason: 'stop' });
                    controller.enqueue(enc.encode('data: [DONE]\n\n'));
                } catch (err: any) {
                    appendLog('Stream error: ' + err.message);
                    send({ errorText: err.message || 'Stream error' });
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            }
        });

    } catch (error: any) {
        console.error('API Error:', error);
        const errorMessage = error?.message || 'Internal Server Error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}


