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
        const { transcript, project_id: projectId } = await req.json();
        if (!transcript?.trim()) {
            return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });
        }

        const model = await getConfig<string>('voice_intent_model');
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

        const now = new Date();
        const localTime = new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
        const projectContext = projectId
            ? ` This is in a project context (project_id: ${projectId}).`
            : '';
        const systemInstruction =
            `Current UTC time: ${now.toISOString()} (Shanghai local: ${localTime}). ` +
            `Extract the user's intent and call the appropriate tool based on these STRICT rules:\n` +
            `1. If user says "项目" → upsert_project\n` +
            `2. EXPLICIT TYPE KEYWORDS (highest priority — must follow exactly):\n` +
            `   - "里程碑" → type=milestone\n` +
            `   - "会议"/"开会"/"meeting" → type=event\n` +
            `   - "待办"/"任务"/"todo" → type=task\n` +
            `   - "提醒"/"reminder" → type=reminder\n` +
            `   - "随手记"/"记录"/"log" → type=log\n` +
            `3. If no explicit keyword, infer from context (scheduled time+place → event, deadline → task, alert → reminder).\n` +
            `When the user explicitly states a type keyword, NEVER override it with a different type.\n` +
            `IMPORTANT: The type keyword and action verbs ("添加","创建","新建","设置","加一个") are INSTRUCTIONS, not the title. ` +
            `Extract the CONTENT (the actual thing being created) as the title, strip the instruction prefix entirely. ` +
            `e.g. "添加里程碑，6月1日开始全员实行新规定" → title="全员实行新规定", type=milestone, start_time=2026-06-01. ` +
            `e.g. "添加里程碑完成登录页" → title="完成登录页", type=milestone. ` +
            `e.g. "创建会议，明天下午三点需求评审" → title="需求评审", type=event. ` +
            `e.g. "添加随手记，今天心情不错" → title="今天心情不错", type=log. ` +
            `e.g. "记录一下，完成了用户调研" → title="完成了用户调研", type=log. No reply text needed.` +
            projectContext;

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

        return NextResponse.json({ success: true, transcript, activity: parsed });
    } catch (error: any) {
        console.error('voice-intent error:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}
