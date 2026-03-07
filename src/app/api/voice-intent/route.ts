import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { getConfig } from '@/lib/config';
import { executeUpsertActivity, UPSERT_ACTIVITY_DECLARATION, UpsertActivityArgs } from '@/lib/activity-tool';
import { executeUpsertProject, UPSERT_PROJECT_DECLARATION, UpsertProjectArgs } from '@/lib/project-tool';

export const maxDuration = 30;

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
        const { transcript } = await req.json();
        if (!transcript?.trim()) {
            return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });
        }

        const model = await getConfig<string>('voice_intent_model');
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

        const now = new Date();
        const localTime = new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
        const systemInstruction =
            `Current UTC time: ${now.toISOString()} (Shanghai local: ${localTime}). ` +
            `Extract the user's intent and call upsert_activity. No reply text needed.`;

        const stream = genai.models.generateContentStream({
            model,
            contents: [{ role: 'user', parts: [{ text: transcript }] }],
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: [UPSERT_ACTIVITY_DECLARATION, UPSERT_PROJECT_DECLARATION] }] as any,
            },
        });

        let toolCall: any = null;
        for await (const chunk of await stream) {
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                if ((part as any).functionCall && !toolCall) {
                    toolCall = part;
                    break;
                }
            }
            if (toolCall) break;
        }

        if (!toolCall) {
            return NextResponse.json({ success: false, error: 'No tool call generated', transcript });
        }

        const fc = toolCall.functionCall;
        let toolResult: string;
        if (fc.name === 'upsert_project') {
            toolResult = await executeUpsertProject(fc.args as UpsertProjectArgs, authPayload.uid);
        } else {
            toolResult = await executeUpsertActivity(fc.args as UpsertActivityArgs, authPayload.uid);
        }
        const parsed = JSON.parse(toolResult);

        return NextResponse.json({ success: true, transcript, activity: parsed });
    } catch (error: any) {
        console.error('voice-intent error:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}
