import { google } from '@ai-sdk/google';
import { streamText } from 'ai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '@/lib/supabase';
import { appendLog } from './logger';

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
        const model = url.searchParams.get('model') || 'gemini-3.1-pro-preview';

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
                const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
                const embedResult = await embeddingModel.embedContent(queryText);
                const embedding = embedResult.embedding.values;

                const { data: matchedMemories, error } = await supabaseAdmin.rpc('match_user_vectors', {
                    query_embedding: embedding,
                    match_threshold: 0.4, // Return items that are moderately related
                    match_count: 5,
                    p_user_id: authPayload.uid
                });
                console.log("RAG Search Error:", error);
                console.log("RAG Match Results:", matchedMemories);
                appendLog("RAG Error: " + error);
                appendLog("RAG Matches: " + JSON.stringify(matchedMemories));

                if (!error && matchedMemories && matchedMemories.length > 0) {
                    const memoriesText = matchedMemories.map((m: any) => m.content).join('\n- ');
                    finalSystemInstruction = `[Relevant User Context/Memories (Use this info implicitly if relevant to the request)]:\n- ${memoriesText}\n\n---\n\n` + finalSystemInstruction;
                    appendLog("Appended to instruction.");
                } else {
                    appendLog("Did not append. Length: " + (matchedMemories?.length || 0));
                }
            } catch (err) {
                console.error('RAG Retrieval Error:', err);
                appendLog("RAG Catch Error: " + err);
            }
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

        const result = streamText({
            model: google(model),
            system: finalSystemInstruction || undefined,
            messages: processedMessages,
            tools: {
                google_search: google.tools.googleSearch({}),
            },
            providerOptions: {
                google: {
                    thinkingConfig: { thinkingBudget: 1024 },
                }
            },
        });

        return result.toUIMessageStreamResponse({
            onError: (error: any) => {
                console.error('Stream Error:', error);
                return String(error?.message || error);
            }
        });
    } catch (error) {
        console.error('API Error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
