// @ts-nocheck
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
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
            return `[SUCCESS] Created ${payload.type} "${data.title}" (ID: ${data.id}). start_time: ${data.start_time}, end_time: ${data.end_time}. ALWAYS confirm this to the user in a friendly message.`;
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

    try {
        const { messages, systemInstruction } = await req.json();
        const url = new URL(req.url);
        const model = url.searchParams.get('model') || 'gemini-2.5-pro';

        let finalSystemInstruction = systemInstruction || '';

        // RAG Retrieval Flow
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
                const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName });
                const embedResult = await embeddingModel.embedContent(queryText);
                const embedding = embedResult.embedding.values;

                const { data: matchedMemories, error } = await supabaseAdmin.rpc('match_tier1_memories', {
                    query_embedding: embedding,
                    match_threshold: 0.5,
                    match_count: 3,
                    p_user_id: authPayload.uid
                });

                if (!error && matchedMemories && matchedMemories.length > 0) {
                    let memoryXml = '<retrieved_memories>\n  <!-- relevant memory chunks from 2-tier sliding window retrieval -->\n';
                    for (const memory of matchedMemories) {
                        try {
                            const { data: startMsg } = await supabaseAdmin.from('chat_messages').select('created_at').eq('id', memory.start_message_id).single();
                            const { data: endMsg } = await supabaseAdmin.from('chat_messages').select('created_at').eq('id', memory.end_message_id).single();
                            if (startMsg && endMsg) {
                                const { data: chunkMsgs } = await supabaseAdmin.from('chat_messages')
                                    .select('role, content, created_at')
                                    .eq('session_id', memory.session_id)
                                    .gte('created_at', startMsg.created_at)
                                    .lte('created_at', endMsg.created_at)
                                    .order('created_at', { ascending: true });
                                if (chunkMsgs && chunkMsgs.length > 0) {
                                    memoryXml += `  <memory_chunk session_id="${memory.session_id}" timestamp="${chunkMsgs[0].created_at}">\n`;
                                    memoryXml += `    <!-- Summary: ${memory.summary_text} -->\n`;
                                    for (const msg of chunkMsgs) {
                                        memoryXml += `    [${msg.role === 'user' ? 'User' : 'Assistant'}]: ${msg.content}\n`;
                                    }
                                    memoryXml += `  </memory_chunk>\n`;
                                }
                            }
                        } catch (e) { }
                    }
                    memoryXml += '</retrieved_memories>\n\n';
                    finalSystemInstruction = `<system_instructions>\n${finalSystemInstruction}\n</system_instructions>\n\n${memoryXml}`;
                    appendLog('Appended 2-Tier memory to instruction.');
                } else {
                    appendLog('Did not append. No 2-Tier matches found.');
                }
            } catch (err) {
                appendLog('2-Tier Catch Error: ' + err);
            }
        }

        // Build system instruction with time context and tool guidance
        const systemNow = new Date();
        const systemTimeStr = '[CRITICAL CONTEXT] Current UTC time: ' + systemNow.toISOString() + ' (Shanghai = UTC+8, so current local time is ' + new Date(systemNow.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00') + '). When the user says today/tomorrow/next week, calculate based on this timestamp.';
        finalSystemInstruction = systemTimeStr + '\n\n' + finalSystemInstruction;
        finalSystemInstruction += '\n\n[Tool Usage] When the user asks to create, schedule, remind, or log an activity, you MUST invoke the upsert_activity tool. After the tool executes successfully, reply with a friendly confirmation message summarizing what was created.';
        finalSystemInstruction += '\n\n[Time Zone] All timestamps passed to upsert_activity MUST be in UTC (Z suffix). Shanghai is UTC+8, so 3 PM local = 07:00Z.';

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

                function send(data: object) {
                    controller.enqueue(enc.encode(sseEvent(data)));
                }

                try {
                    send({ type: 'start' });
                    let currentParts = lastParts;
                    const MAX_STEPS = 5;

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
                                    if (!hasText) {
                                        send({ type: 'text-start', id: '0' });
                                        hasText = true;
                                    }
                                    send({ type: 'text-delta', id: '0', delta: part.text });
                                } else if (part.functionCall) {
                                    const fc = part.functionCall;
                                    send({ type: 'tool-call', toolCallId: fc.name + '_' + step, toolName: fc.name, args: fc.args });
                                    toolCalls.push(fc);
                                }
                            }
                        }

                        // Fallback: after stream exhausted, check the aggregated response.
                        // After tool results, the model confirmation text often only appears
                        // in result.response and NOT in individual stream chunks.
                        if (!hasText && toolCalls.length === 0) {
                            try {
                                const finalResp = await result.response;
                                const finalText = (finalResp.candidates?.[0]?.content?.parts || [])
                                    .filter((p: any) => p.text)
                                    .map((p: any) => p.text)
                                    .join('');
                                if (finalText) {
                                    send({ type: 'text-start', id: '0' });
                                    hasText = true;
                                    send({ type: 'text-delta', id: '0', delta: finalText });
                                    appendLog(`[step ${step}] Got text from result.response fallback (${finalText.length} chars)`);
                                }
                            } catch (e) {
                                appendLog(`[step ${step}] result.response fallback error: ${e}`);
                            }
                        }

                        if (hasText) {
                            send({ type: 'text-end', id: '0' });
                        }

                        if (toolCalls.length === 0) {
                            // No tool calls, we're done
                            send({ type: 'finish-step', finishReason: 'stop' });
                            send({ type: 'finish', finishReason: 'stop' });
                            break;
                        }

                        send({ type: 'finish-step', finishReason: 'tool-calls' });

                        // Execute tools and build function response parts for next turn
                        const funcResponseParts: any[] = [];
                        for (const toolCall of toolCalls) {
                            let toolResult = 'Tool executed.';
                            if (toolCall.name === 'upsert_activity') {
                                toolResult = await executeUpsertActivity(toolCall.args, authPayload.uid);
                            }
                            send({ type: 'tool-result', toolCallId: toolCall.name + '_' + step, toolName: toolCall.name, result: toolResult });
                            funcResponseParts.push({
                                functionResponse: {
                                    name: toolCall.name,
                                    response: { result: toolResult }
                                }
                            });
                        }

                        // Next step: send tool results back to model
                        currentParts = funcResponseParts;
                    }

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

