import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { createApiLogger, generateRequestId, Timer } from '@/lib/api-logger';

// GET — return a short-lived Deepgram token for browser WebSocket connections
export async function GET(req: NextRequest) {
    const requestId = generateRequestId();
    const endpoint = 'GET /api/speech-token';
    const timer = new Timer();
    const logger = createApiLogger(endpoint, requestId);
    
    try {
        // 记录请求开始
        logger.logRequestStart({
            method: 'GET',
            userAgent: req.headers.get('user-agent'),
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

        // 检查 Deepgram API Key 配置
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            authLogger.error('Deepgram API key not configured');
            authLogger.logResponseError(timer.elapsed(), new Error('Deepgram not configured'), 500);
            return NextResponse.json({ 
                error: 'Deepgram not configured',
                requestId 
            }, { status: 500 });
        }

        authLogger.debug('Deepgram API key found', {
            keyPrefix: apiKey.substring(0, 8) + '...',
            keyLength: apiKey.length,
        });

        // 返回 token
        // 注意：token 直接返回，受我们自己的认证中间件保护
        // 客户端将其作为 WebSocket 子协议 token 使用，不会存储在 localStorage 或 URL 中可见
        authLogger.info('Deepgram token issued successfully');
        authLogger.logResponseSuccess(timer.elapsed(), { tokenIssued: true });

        return NextResponse.json({ token: apiKey });

    } catch (error: any) {
        logger.logResponseError(timer.elapsed(), error, 500);
        
        // 详细错误日志
        logger.error('Speech token error', {
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