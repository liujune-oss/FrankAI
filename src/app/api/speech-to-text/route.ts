import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { createApiLogger, generateRequestId, Timer } from '@/lib/api-logger';

export async function POST(req: NextRequest) {
    const requestId = generateRequestId();
    const endpoint = 'POST /api/speech-to-text';
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
        
        if (!authPayload || !authPayload.uid) {
            logger.logAuthFailure('Invalid or missing token');
            return NextResponse.json({ 
                error: 'Unauthorized',
                requestId 
            }, { status: 401 });
        }
        
        // 更新 logger 的 userId
        const authLogger = createApiLogger(endpoint, requestId, authPayload.uid);
        authLogger.info('User authenticated');
        
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;

        if (!audioFile) {
            authLogger.warn('Missing audio file in request');
            return NextResponse.json({ 
                error: 'No audio file provided',
                requestId 
            }, { status: 400 });
        }

        // 记录音频信息（不含内容）
        authLogger.info('Audio file received', {
            fileName: audioFile.name,
            fileType: audioFile.type,
            fileSize: audioFile.size,
        });

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = audioFile.type || 'audio/webm';
        
        authLogger.debug('Audio processed', {
            mimeType,
            base64Length: base64Data.length,
        });

        // 获取配置
        const sttModel = await getConfig<string>('voice_stt_model');
        authLogger.debug('STT model loaded', { sttModel });

        // Gemini API 调用
        const apiTimer = new Timer();
        authLogger.logApiCallStart('Gemini STT', {
            model: sttModel,
            mimeType,
            audioSize: audioFile.size,
        });

        const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
        
        let response;
        try {
            response = await ai.models.generateContent({
                model: sttModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: base64Data, mimeType } },
                            { text: "请直接转写以下音频中的人声内容。如果是中文，直接输出中文转写文本，字与字之间不要加空格，保持正常中文排版。不要添加任何解释、问候语或markdown格式。如果音频是静音、噪音、或没有可识别的人声，只输出 '[null]'，禁止输出'好的'、'嗯'、'是的'等任何推测性内容。" }
                        ]
                    }
                ]
            });
            
            authLogger.logApiCallSuccess('Gemini STT', apiTimer.elapsed(), {
                responseLength: response.text?.length || 0,
            });
        } catch (apiError: any) {
            authLogger.logApiCallError('Gemini STT', apiTimer.elapsed(), apiError);
            throw apiError;
        }

        const transcript = response.text || '';

        // 检查空结果
        if (transcript.trim() === '[null]') {
            authLogger.info('Transcript is null (silence/noise detected)');
            authLogger.logResponseSuccess(timer.elapsed(), { transcript: '' });
            return NextResponse.json({ transcript: '' });
        }

        authLogger.info('Transcript generated', {
            transcriptLength: transcript.length,
            transcriptPreview: transcript.substring(0, 100) + (transcript.length > 100 ? '...' : ''),
        });
        
        authLogger.logResponseSuccess(timer.elapsed(), { 
            transcriptLength: transcript.length 
        });

        return NextResponse.json({ transcript: transcript.trim() });

    } catch (error: any) {
        logger.logResponseError(timer.elapsed(), error, 500);
        
        // 详细错误日志
        logger.error('Speech to text error', {
            errorMessage: error?.message,
            errorName: error?.name,
            errorCode: error?.code,
            errorStack: error?.stack,
            errorCause: error?.cause,
        });
        
        return NextResponse.json({ 
            error: error.message || 'Internal server error',
            requestId 
        }, { status: 500 });
    }
}