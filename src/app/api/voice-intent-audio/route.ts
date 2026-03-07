import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { getConfig } from '@/lib/config';
import { executeUpsertActivity, UPSERT_ACTIVITY_DECLARATION, UpsertActivityArgs } from '@/lib/activity-tool';

export const maxDuration = 30;

// Combined STT + intent endpoint: audio in → transcript + tool call out (one Gemini call)
export async function POST(req: NextRequest) {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const authPayload = await verifyToken(token, fingerprint);
    if (!authPayload?.uid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { limited } = await checkChatRateLimit(authPayload.uid);
    if (limited) {
        return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

    try {
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = audioFile.type || 'audio/webm';

        // Use the audio-capable model (voice_stt_model supports audio input)
        const model = await getConfig<string>('voice_stt_model');
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

        const now = new Date();
        const localTime = new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
        const systemInstruction =
            `Current UTC time: ${now.toISOString()} (Shanghai local: ${localTime}). ` +
            `Transcribe the audio, then extract the user's intent and call upsert_activity. ` +
            `Reply only with the tool call. No extra text.`;

        const stream = genai.models.generateContentStream({
            model,
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { data: base64Data, mimeType } },
                    { text: '请转写音频内容，并调用 upsert_activity 工具创建对应的任务/日程/随手记。' }
                ]
            }],
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: [UPSERT_ACTIVITY_DECLARATION] }] as any,
            },
        });

        let toolCall: any = null;
        let transcript = '';

        for await (const chunk of await stream) {
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                if ((part as any).functionCall && !toolCall) {
                    toolCall = part;
                    break;
                }
                if ((part as any).text) {
                    transcript += (part as any).text;
                }
            }
            if (toolCall) break;
        }

        if (!toolCall) {
            return NextResponse.json({ success: false, error: 'No tool call generated', transcript });
        }

        const fc = toolCall.functionCall;
        // Use title as transcript fallback if Gemini didn't emit text
        if (!transcript.trim() && fc.args?.title) {
            transcript = fc.args.title;
        }

        const toolResult = await executeUpsertActivity(fc.args as UpsertActivityArgs, authPayload.uid);
        const parsed = JSON.parse(toolResult);

        return NextResponse.json({ success: true, transcript, activity: parsed });
    } catch (error: any) {
        console.error('voice-intent-audio error:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}
