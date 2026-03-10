import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase';
import { appendLog } from './logger';
import { getConfig } from '@/lib/config';

// ─── Token budget helper ──────────────────────────────────────────────────────
// Gemini tokenises roughly 1 token per 3-4 chars (English) / 2 chars (Chinese).
// We use char counts as a lightweight proxy — no tokeniser required.

const MEMORY_BUDGET = {
    core: 800,       // user core memory
    recallChunk: 300, // per recall chunk (×5 max → 1500)
    archivalChunk: 300, // per archival chunk (×3 max → 900)
} as const;

function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '…';
}

// ─── Local types ─────────────────────────────────────────────────────────────

interface IncomingPart {
    type?: string;
    text?: string;
    content?: string;
    image?: string;
    mimeType?: string;
}

interface IncomingMessage {
    role: string;
    content?: string | IncomingPart[];
    parts?: IncomingPart[];
    text?: string;
}

interface UpsertActivityArgs {
    title?: string;
    description?: string;
    type?: string;
    start_time?: string | null;
    end_time?: string;
    is_all_day?: boolean;
    priority?: string;
    location?: string;
    id?: string;
    tags?: string[];
    status?: string;
    // Normalisation aliases the model may send
    activities?: UpsertActivityArgs[];
    activity?: UpsertActivityArgs;
    activity_type?: string;
    summary?: string;
    [key: string]: unknown;
}

interface MemoryChunk {
    id: string;
    summary_text: string;
    created_at: string;
}

interface GetActivitiesArgs {
    start_date?: string;
    end_date?: string;
    type?: string;
    status?: string;
    limit?: number;
}

interface ToolExecutionResult {
    toolName: string;
    args: UpsertActivityArgs | GetActivitiesArgs;
    result: string;
}

// Allow streaming responses up to 120 seconds (Pro models think longer)
export const maxDuration = 120;

// 鈹€鈹€鈹€ Tool Declarations 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const UPSERT_ACTIVITY_DECLARATION = {
    name: 'upsert_activity',
    description: 'Create or update a user activity. Use this tool when the user asks to schedule an event, set a reminder, or create a task/to-do item.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'A short, concise title for the activity.' },
            description: { type: 'string', description: 'Detailed description or notes.' },
            type: { type: 'string', description: 'Category: event, task, reminder, or log.' },
            start_time: { type: 'string', description: 'Local time in ISO 8601 format WITHOUT timezone suffix, e.g. "2026-03-09T14:00:00" for 2pm. Do NOT convert to UTC.' },
            end_time: { type: 'string', description: 'Local end time in ISO 8601 format WITHOUT timezone suffix, e.g. "2026-03-09T15:00:00". Do NOT convert to UTC.' },
            is_all_day: { type: 'boolean', description: 'True if the event lasts the entire day.' },
            priority: { type: 'string', description: 'low, medium, high, or urgent. Default: medium.' },
            location: { type: 'string', description: 'Physical location or virtual link.' },
            id: { type: 'string', description: 'UUID of existing activity to update. Omit when creating new.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Semantic tags you freely infer from the activity content. Always provide at least 1-3 tags. Examples: ["工作", "会议"], ["健身", "习惯"], ["项目A", "紧急"].' },
        },
        required: ['title', 'tags'],
    },
};

const GET_ACTIVITIES_DECLARATION = {
    name: 'get_activities',
    description: '查询用户在指定时间范围内的活动记录（tasks、events、reminders、logs 等）。当用户要求"总结本周工作"、"生成周报"、"查看本月日程"、"我这周做了什么"时，调用此工具获取数据后再生成结构化简报。',
    parameters: {
        type: 'object',
        properties: {
            start_date: { type: 'string', description: '开始日期，格式 YYYY-MM-DD，例如 "2026-03-04"（本周一）。' },
            end_date: { type: 'string', description: '结束日期（含当天），格式 YYYY-MM-DD，例如 "2026-03-10"（本周日）。' },
            type: { type: 'string', description: '按类型过滤：event、task、reminder、log、milestone。不填返回全部类型。' },
            status: { type: 'string', description: '按状态过滤：pending、in_progress、completed。不填返回全部状态。' },
            limit: { type: 'number', description: '最多返回条数，默认 100。' },
        },
        required: [],
    },
};

// ─── Execute get_activities locally ──────────────────────────────────────────
async function executeGetActivities(args: GetActivitiesArgs, userId: string): Promise<string> {
    appendLog(`[get_activities] TOOL CALLED. args: ${JSON.stringify(args)}`);
    if (!supabaseAdmin) {
        return 'Error: Database connection not configured.';
    }
    try {
        let query = supabaseAdmin
            .from('activities')
            .select('id, title, description, type, status, start_time, end_time, is_all_day, priority, location, tags, created_at, updated_at')
            .eq('user_id', userId)
            .order('start_time', { ascending: true });

        if (args.start_date) {
            query = query.gte('start_time', args.start_date);
        }
        if (args.end_date) {
            // Include the full end day by using < next day
            const endNext = new Date(args.end_date);
            endNext.setDate(endNext.getDate() + 1);
            query = query.lt('start_time', endNext.toISOString().slice(0, 10));
        }
        if (args.type) {
            query = query.eq('type', args.type);
        }
        if (args.status) {
            query = query.eq('status', args.status);
        }
        query = query.limit(args.limit || 100);

        const { data, error } = await query;
        if (error) {
            appendLog(`[get_activities] ERROR: ${JSON.stringify(error)}`);
            return `Error querying activities: ${error.message}`;
        }
        if (!data || data.length === 0) {
            return JSON.stringify({ count: 0, activities: [], message: '该时间范围内没有活动记录。' });
        }
        appendLog(`[get_activities] Found ${data.length} activities`);
        return JSON.stringify({ count: data.length, activities: data });
    } catch (error: any) {
        appendLog(`[get_activities] CATCH EXCEPTION: ${error.message || error}`);
        return `Error: ${error.message}`;
    }
}

// ─── Execute upsert_activity locally ─────────────────────────────────────────
async function executeUpsertActivity(args: UpsertActivityArgs, userId: string): Promise<string> {
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

        const payload: UpsertActivityArgs & { user_id: string } = { ...normalizedArgs, user_id: userId };

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
                queryText = (latestMessage.parts as IncomingPart[]).filter(p => p.type === 'text').map(p => p.text ?? '').join('\n');
            } else if (typeof latestMessage.content === 'string') {
                queryText = latestMessage.content;
            } else if (Array.isArray(latestMessage.content)) {
                const textPart = (latestMessage.content as IncomingPart[]).find(p => p.type === 'text');
                if (textPart) queryText = textPart.text ?? '';
            } else if (latestMessage.text) {
                queryText = latestMessage.text;
            }
        }

        if (queryText && supabaseAdmin) {
            try {
                const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });
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
                    genai.models.embedContent({ model: embeddingModelName, contents: queryText }),
                ]);

                const coreContent = coreResult.data?.content || '';
                const recallChunks = recallResult.data || [];
                const embedding = embedResult.embeddings?.[0]?.values ?? [];

                // Layer 3：冷层向量搜索（排除温层已有的 chunk）
                const recallIds = (recallChunks as MemoryChunk[]).map(c => c.id);
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
                    parts.push(`<core>\n${truncate(coreContent, MEMORY_BUDGET.core)}\n</core>`);
                }

                if (recallChunks.length > 0) {
                    const recallText = (recallChunks as MemoryChunk[])
                        .map(c => `[${c.created_at?.slice(0, 10)}] ${truncate(c.summary_text, MEMORY_BUDGET.recallChunk)}`)
                        .join('\n');
                    parts.push(`<recent>\n${recallText}\n</recent>`);
                }

                if (archivalChunks && archivalChunks.length > 0) {
                    const archivalText = (archivalChunks as MemoryChunk[])
                        .map(c => `[${c.created_at?.slice(0, 10) || ''}] ${truncate(c.summary_text, MEMORY_BUDGET.archivalChunk)}`)
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
        finalSystemInstruction += '\n\n[周报/简报工具] 当用户要求"总结本周工作"、"生成周报"、"我这周做了什么"等时：\n1. 先调用 get_activities 工具，传入本周的 start_date（周一）和 end_date（今天或周日）\n2. 拿到数据后，整理成结构化简报，按类型分组（事件/任务/日志等），列出完成情况\n3. 不要凭空捏造活动内容，必须基于工具返回的真实数据生成报告';

        // Convert messages to Google AI format
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

        // Build message history
        const history: any[] = [];
        for (const msg of (messages as IncomingMessage[]).slice(0, -1)) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            let parts: any[] = [];
            if (typeof msg.content === 'string') {
                parts = [{ text: msg.content }];
            } else if (Array.isArray(msg.content)) {
                parts = (msg.content as IncomingPart[]).flatMap<any>(p => {
                    if (p.type === 'text') return [{ text: p.text || p.content || '' }];
                    if (p.type === 'image' && p.image) return [{ inlineData: { mimeType: p.mimeType || 'image/jpeg', data: p.image } }];
                    return [];
                }).filter((p: any) => ('text' in p && p.text !== '') || 'inlineData' in p);
            } else if (msg.parts) {
                parts = (msg.parts as IncomingPart[])
                    .map(p => ({ text: p.text || '' }))
                    .filter(p => p.text !== '');
            }
            if (parts.length > 0) history.push({ role, parts });
        }

        // Last user message
        const lastMsg = messages[messages.length - 1] as IncomingMessage;
        let lastParts: any[] = [];
        if (typeof lastMsg.content === 'string') {
            lastParts = [{ text: lastMsg.content }];
        } else if (Array.isArray(lastMsg.content)) {
            lastParts = (lastMsg.content as IncomingPart[]).flatMap<any>(p => {
                if (p.type === 'text') return [{ text: p.text || p.content || '' }];
                if (p.type === 'image' && p.image) return [{ inlineData: { mimeType: p.mimeType || 'image/jpeg', data: p.image } }];
                return [];
            });
        } else if (lastMsg.parts) {
            lastParts = (lastMsg.parts as IncomingPart[])
                .map(p => ({ text: p.text || '' }))
                .filter(p => p.text);
        } else if (lastMsg.text) {
            lastParts = [{ text: lastMsg.text }];
        }

        // Build the SSE stream with tool-call loop
        const stream = new ReadableStream({
            async start(controller) {
                const enc = new TextEncoder();
                function send(data: object) { controller.enqueue(enc.encode(sseEvent(data))); }

                try {
                    send({ type: 'start' });
                    const MAX_STEPS = 5;

                    // Collect all tool results across steps for isolated confirmation
                    const allExecutedResults: ToolExecutionResult[] = [];
                    let anyToolsExecuted = false;
                    let anyTextStreamed = false;

                    // Extract original user text for the isolated confirmation call
                    const originalUserText = lastParts.filter((p: any) => 'text' in p).map((p: any) => p.text).join('\n');

                    // Full contents array: history + current user message
                    const allContents = [...history, { role: 'user', parts: lastParts }];

                    for (let step = 0; step < MAX_STEPS; step++) {
                        send({ type: 'start-step' });

                        const result = genai.models.generateContentStream({
                            model,
                            contents: allContents,
                            config: {
                                systemInstruction: finalSystemInstruction,
                                tools: [{ functionDeclarations: [UPSERT_ACTIVITY_DECLARATION, GET_ACTIVITIES_DECLARATION] }] as any,
                            },
                        });

                        let toolCalls: any[] = [];
                        let hasText = false;
                        let modelParts: any[] = [];

                        for await (const chunk of await result) {
                            const candidate = chunk.candidates?.[0];
                            if (!candidate) continue;

                            for (const part of candidate.content?.parts || []) {
                                if ((part as any).thought) {
                                    // Preserve thought/reasoning parts as-is (including thought_signature).
                                    // These MUST be kept in history for the model to accept functionResponse.
                                    // Do NOT stream thought content to the client.
                                    modelParts.push(part);
                                } else if (part.text) {
                                    modelParts.push({ text: part.text });
                                    // Only stream text directly if NO write-tools have been executed yet.
                                    // After write-tool execution, Phase 2 handles confirmation.
                                    if (!anyToolsExecuted) {
                                        if (!hasText) { send({ type: 'text-start', id: '0' }); hasText = true; }
                                        send({ type: 'text-delta', id: '0', delta: part.text });
                                        anyTextStreamed = true;
                                    }
                                } else if (part.functionCall) {
                                    const fc = part.functionCall;
                                    modelParts.push({ functionCall: fc });
                                    send({ type: 'tool-call', toolCallId: fc.name + '_' + step, toolName: fc.name, args: fc.args });
                                    toolCalls.push(fc);
                                }
                            }
                        }

                        if (hasText) send({ type: 'text-end', id: '0' });

                        if (toolCalls.length === 0) {
                            // No more tool calls — loop ends here
                            send({ type: 'finish-step', finishReason: 'stop' });
                            break;
                        }

                        send({ type: 'finish-step', finishReason: 'tool-calls' });

                        // Execute tools — track whether any write tools were called
                        let hasWriteTools = false;
                        const funcResponseParts: any[] = [];
                        for (const toolCall of toolCalls) {
                            let toolResult = 'Tool executed.';
                            if (toolCall.name === 'upsert_activity') {
                                hasWriteTools = true;
                                toolResult = await executeUpsertActivity(toolCall.args as UpsertActivityArgs, authPayload.uid);
                            } else if (toolCall.name === 'get_activities') {
                                toolResult = await executeGetActivities(toolCall.args as GetActivitiesArgs, authPayload.uid);
                            }
                            send({ type: 'tool-result', toolCallId: toolCall.name + '_' + step, toolName: toolCall.name, result: toolResult });
                            allExecutedResults.push({ toolName: toolCall.name, args: toolCall.args, result: toolResult });

                            let parsedResult: unknown = null;
                            try { parsedResult = JSON.parse(toolResult); } catch { }
                            funcResponseParts.push({
                                functionResponse: {
                                    name: toolCall.name,
                                    response: parsedResult || { result: toolResult }
                                }
                            });
                        }

                        if (hasWriteTools) {
                            // Write-tool path: break and let Phase 2 generate confirmation.
                            // This prevents duplicate upsert_activity calls.
                            anyToolsExecuted = true;
                            break;
                        }

                        // Read-only tool path (e.g. get_activities): feed results back so the
                        // model can synthesize a report. Do NOT use Phase 2 for this case.
                        allContents.push({ role: 'model', parts: modelParts });
                        allContents.push({ role: 'user', parts: funcResponseParts });
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

                        const confirmPrompt = 'User request: "' + originalUserText + '"\n\nWhat was just done:\n' + resultSummary + '\n\nWrite a brief, friendly confirmation to the user (1-3 sentences max).';
                        const confirmStream = genai.models.generateContentStream({
                            model,
                            contents: [{ role: 'user', parts: [{ text: confirmPrompt }] }],
                            config: {
                                systemInstruction: 'You are a helpful assistant. Write a short, friendly reply in the same language as the user. Be warm and personal. Do NOT add unnecessary lists or elaborate markdown unless the user asked for it.',
                            },
                        });

                        let confirmHasText = false;
                        for await (const chunk of await confirmStream) {
                            const candidate = chunk.candidates?.[0];
                            if (!candidate) continue;
                            for (const part of candidate.content?.parts || []) {
                                if (part.text) {
                                    if (!confirmHasText) { send({ type: 'text-start', id: '0' }); confirmHasText = true; }
                                    send({ type: 'text-delta', id: '0', delta: part.text });
                                }
                            }
                        }

                        // 兜底：流为空时发硬编码确认
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


