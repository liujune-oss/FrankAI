import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { checkChatRateLimit } from '@/lib/ratelimit';
import { getConfig } from '@/lib/config';
import { executeUpsertActivity, UPSERT_ACTIVITY_DECLARATION, UpsertActivityArgs } from '@/lib/activity-tool';
import { executeUpsertProject, UPSERT_PROJECT_DECLARATION, UpsertProjectArgs } from '@/lib/project-tool';
import { createApiLogger, generateRequestId, Timer } from '@/lib/api-logger';

export const maxDuration = 30;

// Combined STT + intent endpoint: audio in → transcript + tool call out (one Gemini call)
export async function POST(req: NextRequest) {
    const requestId = generateRequestId();
    const endpoint = 'POST /api/voice-intent-audio';
    const timer = new Timer();
    const logger = createApiLogger(endpoint, requestId);
    
    try {
        // 记录请求开始
        logger.logRequestStart({
            method: 'POST',
            contentType: req.headers.get('content-type'),
        });

        // 认证
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);
        
        if (!authPayload?.uid) {
            logger.logAuthFailure('Invalid or missing token');
            return NextResponse.json({ 
                error: 'Unauthorized',
                requestId 
            }, { status: 401 });
        }
        
        // 更新 logger 的 userId
        const authLogger = createApiLogger(endpoint, requestId, authPayload.uid);
        authLogger.info('User authenticated');

        // 速率限制检查
        const rateLimitTimer = new Timer();
        const { limited } = await checkChatRateLimit(authPayload.uid);
        
        if (limited) {
            authLogger.logRateLimited();
            authLogger.logResponseError(rateLimitTimer.elapsed(), new Error('Rate limited'), 429);
            return NextResponse.json({ 
                error: 'Too Many Requests',
                requestId 
            }, { status: 429 });
        }
        
        authLogger.debug('Rate limit check passed', { 
            duration: rateLimitTimer.elapsed() 
        });

        // 解析表单数据
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        const projectId = formData.get('project_id') as string | null;
        
        if (!audioFile) {
            authLogger.warn('Missing audio file in request');
            return NextResponse.json({ 
                error: 'No audio file provided',
                requestId 
            }, { status: 400 });
        }

        // 记录请求参数
        authLogger.info('Request parameters', {
            audioFileName: audioFile.name,
            audioFileType: audioFile.type,
            audioFileSize: audioFile.size,
            projectId: projectId || null,
        });

        // 处理音频
        const audioProcessTimer = new Timer();
        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = audioFile.type || 'audio/webm';
        
        authLogger.debug('Audio processed', {
            mimeType,
            base64Length: base64Data.length,
            duration: audioProcessTimer.elapsed(),
        });

        // 获取模型配置
        const model = await getConfig<string>('voice_stt_model');
        authLogger.debug('Model configuration loaded', { model });

        // 构建系统指令
        const now = new Date();
        const localTime = new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
        const projectContext = projectId
            ? ` This is in a project context (project_id: ${projectId}).`
            : '';
        const systemInstruction =
            `Current UTC time: ${now.toISOString()} (Shanghai local: ${localTime}). ` +
            `First, accurately transcribe every word in the audio as-is (output the full transcript text). ` +
            `Then call the appropriate tool based on these STRICT rules:\n` +
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
            `e.g. "记录一下，完成了用户调研" → title="完成了用户调研", type=log.` +
            projectContext;

        authLogger.debug('System instruction prepared', {
            instructionLength: systemInstruction.length,
            projectId: projectId || null,
        });

        // Gemini API 调用
        const geminiTimer = new Timer();
        authLogger.logApiCallStart('Gemini Voice Intent', {
            model,
            mimeType,
            audioSize: audioFile.size,
            hasProjectContext: !!projectId,
        });

        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });
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
        let chunkCount = 0;

        try {
            for await (const chunk of await stream) {
                chunkCount++;
                for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                    if ((part as any).functionCall && !toolCall) {
                        toolCall = part;
                        authLogger.debug('Tool call detected in chunk', { 
                            chunkNumber: chunkCount,
                            toolName: (part as any).functionCall?.name 
                        });
                        break;
                    }
                    if ((part as any).text) {
                        transcript += (part as any).text;
                    }
                }
                if (toolCall) break;
            }
            
            authLogger.logApiCallSuccess('Gemini Voice Intent', geminiTimer.elapsed(), {
                chunkCount,
                transcriptLength: transcript.length,
                hasToolCall: !!toolCall,
                toolName: toolCall?.functionCall?.name || null,
            });
        } catch (apiError: any) {
            authLogger.logApiCallError('Gemini Voice Intent', geminiTimer.elapsed(), apiError);
            throw apiError;
        }

        // 检查工具调用
        if (!toolCall) {
            authLogger.warn('No tool call generated from Gemini response', {
                transcriptLength: transcript.length,
                transcriptPreview: transcript.substring(0, 100),
            });
            authLogger.logResponseSuccess(timer.elapsed(), { 
                success: false, 
                hasToolCall: false,
                transcriptLength: transcript.length 
            });
            return NextResponse.json({ 
                success: false, 
                error: 'No tool call generated', 
                transcript,
                requestId 
            });
        }

        const fc = toolCall.functionCall;
        authLogger.info('Tool call parsed', {
            toolName: fc.name,
            argsPreview: JSON.stringify(fc.args).substring(0, 200),
        });

        // 如果 transcript 为空但 args 中有 title，使用 title 作为 transcript
        if (!transcript.trim() && fc.args?.title) {
            transcript = fc.args.title as string;
            authLogger.debug('Using title as transcript', { title: fc.args.title });
        }

        // 如果在项目上下文中，强制添加 project_id
        if (projectId && fc.name !== 'upsert_project') {
            (fc.args as any).project_id = projectId;
            authLogger.debug('Injected project_id into args', { projectId });
        }

        // 执行工具调用
        const toolTimer = new Timer();
        let toolResult: string;
        
        authLogger.logApiCallStart(`Tool: ${fc.name}`, { args: fc.args });
        
        try {
            if (fc.name === 'upsert_project') {
                toolResult = await executeUpsertProject(fc.args as UpsertProjectArgs, authPayload.uid);
            } else {
                toolResult = await executeUpsertActivity(fc.args as UpsertActivityArgs, authPayload.uid);
            }
            
            authLogger.logApiCallSuccess(`Tool: ${fc.name}`, toolTimer.elapsed(), {
                resultPreview: toolResult.substring(0, 200),
            });
        } catch (toolError: any) {
            authLogger.logApiCallError(`Tool: ${fc.name}`, toolTimer.elapsed(), toolError);
            throw toolError;
        }

        // 检查工具执行结果
        if (toolResult.startsWith('[FAILED]') || toolResult.startsWith('Error:')) {
            authLogger.error('Tool execution failed', {
                toolName: fc.name,
                toolResult: toolResult.substring(0, 500),
            });
            authLogger.logResponseError(timer.elapsed(), new Error(toolResult), 500);
            return NextResponse.json({ 
                success: false, 
                error: toolResult,
                requestId 
            }, { status: 500 });
        }

        // 解析并返回结果
        const parsed = JSON.parse(toolResult);
        
        authLogger.info('Voice intent processed successfully', {
            toolName: fc.name,
            transcriptLength: transcript.length,
            activityId: parsed?.id || parsed?.activity_id || null,
        });
        
        authLogger.logResponseSuccess(timer.elapsed(), { 
            success: true,
            toolName: fc.name,
            activityId: parsed?.id || parsed?.activity_id,
        });

        return NextResponse.json({ 
            success: true, 
            transcript, 
            activity: parsed, 
            tool: fc.name,
            requestId 
        });

    } catch (error: any) {
        logger.logResponseError(timer.elapsed(), error, 500);
        
        // 详细错误日志
        logger.error('Voice intent audio error', {
            errorMessage: error?.message,
            errorName: error?.name,
            errorCode: error?.code,
            errorStack: error?.stack,
            errorCause: error?.cause,
        });
        
        return NextResponse.json({ 
            error: error.message || 'Internal error',
            requestId 
        }, { status: 500 });
    }
}