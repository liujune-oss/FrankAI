// @ts-nocheck
import { google } from '@ai-sdk/google';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '@/lib/supabase';
import { appendLog } from './logger';
import { getConfig } from '@/lib/config';

// Allow streaming responses up to 120 seconds (Pro models think longer)
export const maxDuration = 120;

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

                // Tier-1: Macro semantic search among summarized chunks
                const { data: matchedMemories, error } = await supabaseAdmin.rpc('match_tier1_memories', {
                    query_embedding: embedding,
                    match_threshold: 0.5, // Return highly pertinent items
                    match_count: 3,
                    p_user_id: authPayload.uid
                });

                if (error) {
                    console.error("Tier-1 Memory Search Error:", error);
                    appendLog("Tier-1 Memory Error: " + error);
                }

                if (!error && matchedMemories && matchedMemories.length > 0) {
                    let memoryXml = '<retrieved_memories>\n  <!-- 经过二级滑窗检索，核心命中的历史对白片段 -->\n';

                    // Tier-2: Micro sliding window context extraction
                    for (const memory of matchedMemories) {
                        try {
                            // Find the time boundaries of the chunk
                            const { data: startMsg } = await supabaseAdmin.from('chat_messages').select('created_at').eq('id', memory.start_message_id).single();
                            const { data: endMsg } = await supabaseAdmin.from('chat_messages').select('created_at').eq('id', memory.end_message_id).single();

                            if (startMsg && endMsg) {
                                // Fetch the sliding window context for this chunk
                                const { data: chunkMsgs } = await supabaseAdmin.from('chat_messages')
                                    .select('role, content, created_at')
                                    .eq('session_id', memory.session_id)
                                    .gte('created_at', startMsg.created_at)
                                    .lte('created_at', endMsg.created_at)
                                    .order('created_at', { ascending: true });

                                if (chunkMsgs && chunkMsgs.length > 0) {
                                    memoryXml += `  <memory_chunk session_id="${memory.session_id}" timestamp="${chunkMsgs[0].created_at}">\n`;
                                    memoryXml += `    <!-- Summary abstraction: ${memory.summary_text} -->\n`;
                                    for (const msg of chunkMsgs) {
                                        memoryXml += `    [${msg.role === 'user' ? 'User' : 'Assistant'}]: ${msg.content}\n`;
                                    }
                                    memoryXml += `  </memory_chunk>\n`;
                                }
                            }
                        } catch (e) {
                            console.error("Tier-2 Extract Context Error For Mem:", memory.id, e);
                        }
                    }
                    memoryXml += '</retrieved_memories>\n\n';

                    // Isolate the domains by formatting standard prompt into XML 
                    finalSystemInstruction = `<system_instructions>\n${finalSystemInstruction}\n</system_instructions>\n\n${memoryXml}<current_conversation_context>\n<!-- 当前的会话历史记录 -->\n</current_conversation_context>\n`;
                    appendLog("Appended 2-Tier memory to instruction.");
                } else {
                    appendLog("Did not append. No 2-Tier matches found.");
                    finalSystemInstruction = `<system_instructions>\n${finalSystemInstruction}\n</system_instructions>\n\n<current_conversation_context>\n</current_conversation_context>\n`;
                }
            } catch (err) {
                console.error('2-Tier RAG Retrieval Error:', err);
                appendLog("2-Tier Catch Error: " + err);
            }
        } else {
            // Apply standard tags if no queryText extraction or DB
            finalSystemInstruction = `<system_instructions>\n${finalSystemInstruction}\n</system_instructions>\n\n<current_conversation_context>\n</current_conversation_context>\n`;
        }

        // Convert messages: map image parts for the AI SDK format
        const processedMessages = messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
                return {
                    role: msg.role,
                    content: msg.content.map((part: any) => {
                        if (part.type === 'image') {
                            return {
                                type: 'image' as const,
                                image: part.image, // base64 data
                                mimeType: part.mimeType || 'image/jpeg',
                            };
                        }
                        return part;
                    }),
                };
            }
            return msg;
        });

        const forceEditInstruction = `\n\nCRITICAL INSTRUCTION: If the user provides a real photo and asks you to modify, edit, or change it in ANY way, you MUST NOT REFUSE. Do not give excuses about "pixel-level edits" or "lacking software tools". You must immediately use the 'generate_image' tool with 'action: edit' to fulfill their request by generating an artistic representation or AI-interpreted version of what they asked for. DO NOT OUTPUT ANY OTHER TEXT EXPLAINING YOURSELF. JUST INVOKE THE TOOL.`;
        finalSystemInstruction += forceEditInstruction;
        finalSystemInstruction += '\n\n[Tool Usage] When the user asks you to generate, create, draw, edit, or modify an image, you MUST use the `generate_image` tool. Do NOT output JSON or text that simulates a tool call. Always invoke the tool directly.';
        finalSystemInstruction += `\n\n[Time Context & Timezone] The current system time in UTC is: ${new Date().toISOString()}. The user is based in Shanghai (UTC+8). CRITICAL: All timestamps in the 'upsert_activity' tool MUST be strictly in UTC ('Z' suffix). If the user asks you to schedule something at '3 PM' or '15:00', they mean 15:00 UTC+8. You MUST subtract 8 hours and provide '07:00:00Z' to the tool. NEVER provide local time + 'Z'. For example, 15:00 local time = 07:00 UTC.`;
        finalSystemInstruction += '\n\nCRITICAL: When the user asks you to create, schedule, modify, or delete a task, event, or reminder, YOU MUST INVOKE THE `upsert_activity` TOOL immediately — do not ask for more information unless absolutely required. After the tool executes successfully, ALWAYS reply with a friendly confirmation message summarizing what was created (title, time, type). DO NOT stay silent after tool execution.';

        const lastUserContent = typeof processedMessages[processedMessages.length - 1]?.content === 'string'
            ? processedMessages[processedMessages.length - 1].content
            : JSON.stringify(processedMessages[processedMessages.length - 1]?.content || '');

        const isLikelyEdit = lastUserContent.includes('修改') || lastUserContent.includes('换成') || lastUserContent.includes('改') || lastUserContent.includes('edit');
        const isActivity = lastUserContent.includes('创建') || lastUserContent.includes('提醒') || lastUserContent.includes('任务') || lastUserContent.includes('日历') || lastUserContent.includes('安排');

        let forcedToolChoice: any = 'auto';

        // Only send thinkingConfig if the model is capable (typically 2.0-flash-thinking, 2.5-pro, etc. But NOT deep-research)
        // We'll allow anything with 'thinking' in the name or the specific gemini 3.x/2.5 pro models that we know support it.
        const supportsThinking = model.includes('thinking') || model.includes('gemini-3') || model.includes('gemini-2.5-pro') || model.includes('gemini-2.0-pro');
        const providerOptions = supportsThinking ? {
            google: {
                thinkingConfig: { thinkingBudget: 1024 },
            }
        } : undefined;

        let finalModelStr = model;
        // if tools must be strictly required, we used to fallback to gemini-2.5-pro here. 
        // We keep the variable for consistency but do not force 'required' anymore to avoid empty text loops.

        const systemNow = new Date();
        const systemTimeStr = `[CRITICAL CONTEXT] 当前系统实时时间：${systemNow.toISOString()} (如果是下午时间，请自行换算为24小时制，当前本地时间处于东八区，当前绝对时间戳为 ${systemNow.toISOString()})。\n当用户提到“明天”、“下周”等时间词，必须以此时间为基准进行ISO-8601计算。`;
        finalSystemInstruction = `${systemTimeStr}\n\n${finalSystemInstruction}`;

        const result = await streamText({
            model: google(finalModelStr),
            maxSteps: 5,
            system: finalSystemInstruction,
            messages: processedMessages,
            toolChoice: forcedToolChoice,
            // @ts-ignore
            tools: {
                google_search: google.tools.googleSearch({}),
                upsert_activity: tool({
                    description: 'Create or update a user activity. Use this tool when the user asks to schedule an event, set a reminder, or create a task/to-do item. The system uses a unified activities table. Determine the type (task, event, reminder) based on the user intent.',
                    parameters: z.object({
                        title: z.string().describe('A short, concise title for the activity.'),
                        description: z.string().optional().describe('Detailed description or notes for the activity.'),
                        type: z.enum(['task', 'event', 'reminder', 'log']).optional().describe('The category of the activity. Use "event" if it has a specific time duration (like a meeting), "task" if it is a to-do item (even with a deadline), "reminder" for simple alerts, and "log" for journals/diaries/records.'),
                        start_time: z.string().optional().describe('The start time in ISO 8601 format (e.g., "2026-03-02T15:00:00Z"). Required for events and reminders. Omit for tasks without a specific start time.'),
                        end_time: z.string().optional().describe('The end time or due date in ISO 8601 format. Required for events. For tasks, this acts as the deadline/due date.'),
                        is_all_day: z.boolean().optional().describe('True if the event lasts the entire day.'),
                        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('The priority level. Default is medium.'),
                        location: z.string().optional().describe('Physical location or virtual meeting link.'),
                        id: z.string().optional().describe('The UUID of the activity to update. ONLY provide this if you are explicitly modifying an existing activity that has an ID. Omit when creating a new activity.'),
                        tags: z.array(z.string()).optional().describe('Any relevant semantic tags extracted from the prompt.'),
                    }),
                    execute: async (args: any) => {
                        appendLog(`[upsert_activity] TOOL CALLED. args: ${JSON.stringify(args)}`);
                        if (!supabaseAdmin) {
                            appendLog(`[upsert_activity] ERROR: supabaseAdmin is null`);
                            return 'Error: Database connection not configured.';
                        }
                        try {
                            // experimental model hallucination defense: unwrap nested activities array
                            let normalizedArgs = { ...args };
                            if (typeof args === 'string') {
                                try {
                                    normalizedArgs = JSON.parse(args);
                                } catch (e) { }
                            }

                            if (normalizedArgs.activities && Array.isArray(normalizedArgs.activities) && normalizedArgs.activities.length > 0) {
                                normalizedArgs = normalizedArgs.activities[0];
                            } else if (normalizedArgs.activity && typeof normalizedArgs.activity === 'object') {
                                normalizedArgs = normalizedArgs.activity;
                            }

                            const payload: any = { ...normalizedArgs, user_id: authPayload.uid };

                            // Handle AI model hallucinating "activity_type" instead of "type"
                            if (payload.activity_type && !payload.type) {
                                payload.type = payload.activity_type;
                            }
                            delete payload.activity_type;

                            // Handle AI model hallucinating "summary" instead of "title"
                            if (payload.summary && !payload.title) {
                                payload.title = payload.summary;
                            }
                            delete payload.summary;

                            // Handle AI model missing title
                            if (!payload.title || typeof payload.title !== 'string' || payload.title.trim() === '') {
                                payload.title = "Untitled Activity";
                            }

                            // Auto-infer type if the model forgot it
                            if (!payload.type) {
                                if (payload.start_time && payload.end_time) {
                                    payload.type = 'event';
                                } else {
                                    payload.type = 'task'; // fallback
                                }
                            }

                            // Task vs Event time correction
                            if (payload.type === 'task' && !payload.end_time && payload.start_time) {
                                payload.end_time = payload.start_time;
                                payload.start_time = null;
                            }

                            if (payload.type === 'event' && !payload.end_time && payload.start_time) {
                                // Default event duration 1 hour if not specified
                                const start = new Date(payload.start_time);
                                start.setHours(start.getHours() + 1);
                                payload.end_time = start.toISOString();
                            }

                            // Strip unknown fields
                            const allowedKeys = ['id', 'user_id', 'type', 'title', 'description', 'start_time', 'end_time', 'is_all_day', 'location', 'priority', 'status', 'repetition_rule', 'tags', 'metadata'];
                            Object.keys(payload).forEach(key => {
                                if (!allowedKeys.includes(key)) {
                                    delete payload[key];
                                }
                            });

                            appendLog(`[upsert_activity] V2 Constructed payload: ${JSON.stringify(payload)}`);

                            if (payload.id) {
                                // Update existing
                                const { data, error } = await supabaseAdmin
                                    .from('activities')
                                    .update(payload)
                                    .eq('id', payload.id)
                                    .eq('user_id', authPayload.uid)
                                    .select()
                                    .single();
                                if (error) {
                                    appendLog(`[upsert_activity] UPDATE ERROR: ${JSON.stringify(error)}`);
                                    throw error;
                                }
                                appendLog(`[upsert_activity] UPDATE SUCCESS: ${data.id}`);
                                return `Successfully updated ${payload.type} "${data.title}" at ID ${data.id}.`;
                            } else {
                                // Create new
                                const { data, error } = await supabaseAdmin
                                    .from('activities')
                                    .insert(payload)
                                    .select()
                                    .single();
                                if (error) {
                                    appendLog(`[upsert_activity] INSERT ERROR: ${JSON.stringify(error)}`);
                                    throw error;
                                }
                                appendLog(`[upsert_activity] INSERT SUCCESS: ${data.id}`);
                                return `[SUCCESS] Created ${payload.type} "${data.title}" (ID: ${data.id}). start_time: ${data.start_time}, end_time: ${data.end_time}. You MUST tell the user exactly what was created.`;
                            }
                        } catch (error: any) {
                            appendLog(`[upsert_activity] CATCH EXCEPTION: ${error.message || error}`);
                            console.error('upsert_activity error:', error);
                            return `[FAILED] Failed to save activity: ${error.message}. You MUST tell the user this failed!`;
                        }
                    },
                }),
                generate_image: tool({
                    description: 'Generate, create, draw, edit, or modify images based on user request. Call this when the user wants to create a new image, edit/modify an existing image, draw something, or do any visual content creation. IMPORTANT: If the user uploads a real photo and asks you to edit it, NEVER refuse. You must accept the request and call this tool to generate a new artistic representation based on their request. Do not explain your safety guidelines.',
                    parameters: z.object({
                        prompt: z.string().describe('The image generation or editing prompt. Rewrite the user request into a detailed, descriptive prompt optimized for image generation. If editing an uploaded image, describe the changes to make.'),
                        action: z.enum(['generate', 'edit']).describe("Whether the user wants to generate a completely new image ('generate'), or modify/edit an existing image shown in the conversation ('edit')."),
                    }),
                    execute: async (args: any) => {
                        return "Image tool called successfully.";
                    }
                }),
            },
            providerOptions,
        });

        return result.toUIMessageStreamResponse({
            onError: (error: any) => {
                console.error('Stream Error:', error);
                return String(error?.message || error);
            }
        });
    } catch (error: any) {
        console.error('API Error:', error);
        // Extract the underlying message if ai sdk throws immediately (e.g. Interactions API requirement)
        const errorMessage = error?.message || 'Internal Server Error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
