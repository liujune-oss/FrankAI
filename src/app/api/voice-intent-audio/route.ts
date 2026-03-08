import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { getConfig } from '@/lib/config';
import { executeUpsertActivity, UPSERT_ACTIVITY_DECLARATION, UpsertActivityArgs } from '@/lib/activity-tool';
import { executeUpsertProject, UPSERT_PROJECT_DECLARATION, UpsertProjectArgs } from '@/lib/project-tool';

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

        const projectId = formData.get('project_id') as string | null;

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = audioFile.type || 'audio/webm';

        const model = await getConfig<string>('voice_stt_model');
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

        const now = new Date();
        const localTime = new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
        const projectContext = projectId
            ? ` This is in a project context (project_id: ${projectId}). ` +
              `Use type=milestone for key dates/achievements, type=event for meetings, type=task for todos, type=reminder for reminders.`
            : '';
        const systemInstruction =
            `Current UTC time: ${now.toISOString()} (Shanghai local: ${localTime}). ` +
            `First, accurately transcribe every word in the audio as-is (output the full transcript text). ` +
            `Then, based on the transcript, call the appropriate tool: ` +
            `upsert_project if the user wants to create/update a project, ` +
            `upsert_activity for tasks, events, milestones, reminders, or logs.` +
            projectContext;

        const stream = genai.models.generateContentStream({
            model,
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { data: base64Data, mimeType } },
                    { text: '请逐字转写音频，然后根据内容选择合适的工具：创建项目用 upsert_project，创建任务/日程/随手记用 upsert_activity。' }
                ]
            }],
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: [UPSERT_ACTIVITY_DECLARATION, UPSERT_PROJECT_DECLARATION] }] as any,
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
        if (!transcript.trim() && fc.args?.title) transcript = fc.args.title;

        // Force project_id onto activity args when in project context
        if (projectId && fc.name !== 'upsert_project') {
            (fc.args as any).project_id = projectId;
        }

        let toolResult: string;
        if (fc.name === 'upsert_project') {
            toolResult = await executeUpsertProject(fc.args as UpsertProjectArgs, authPayload.uid);
        } else {
            toolResult = await executeUpsertActivity(fc.args as UpsertActivityArgs, authPayload.uid);
        }

        if (toolResult.startsWith('[FAILED]') || toolResult.startsWith('Error:')) {
            return NextResponse.json({ success: false, error: toolResult }, { status: 500 });
        }

        const parsed = JSON.parse(toolResult);
        return NextResponse.json({ success: true, transcript, activity: parsed, tool: fc.name });
    } catch (error: any) {
        console.error('voice-intent-audio error:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}
