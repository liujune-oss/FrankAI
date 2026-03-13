/**
 * API 日志工具
 * 提供统一的日志格式，便于生产环境排查问题
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    endpoint: string;
    requestId: string;
    userId?: string;
    [key: string]: any;
}

/**
 * 生成唯一的请求 ID
 */
export function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 格式化时间戳 (ISO 8601 with timezone)
 */
function formatTimestamp(): string {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
    const minutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
    
    // 转换为 ISO 格式并添加时区
    return now.toISOString().replace('Z', `${sign}${hours}:${minutes}`);
}

/**
 * 核心日志函数
 */
function log(level: LogLevel, context: LogContext, message: string, data?: any) {
    const logEntry = {
        timestamp: formatTimestamp(),
        level: level.toUpperCase(),
        requestId: context.requestId,
        endpoint: context.endpoint,
        userId: context.userId || 'anonymous',
        message,
        ...(data !== undefined && { data }),
    };
    
    const logString = JSON.stringify(logEntry);
    
    switch (level) {
        case 'error':
            console.error(logString);
            break;
        case 'warn':
            console.warn(logString);
            break;
        case 'debug':
            console.debug(logString);
            break;
        default:
            console.log(logString);
    }
}

/**
 * 创建 API 日志器
 */
export function createApiLogger(endpoint: string, requestId: string, userId?: string) {
    const baseContext = { endpoint, requestId, userId };
    
    return {
        debug: (message: string, data?: any) => log('debug', baseContext, message, data),
        info: (message: string, data?: any) => log('info', baseContext, message, data),
        warn: (message: string, data?: any) => log('warn', baseContext, message, data),
        error: (message: string, data?: any) => log('error', baseContext, message, data),
        
        /**
         * 记录请求开始
         */
        logRequestStart: (params?: any) => {
            log('info', baseContext, 'Request received', {
                params: sanitizeParams(params),
            });
        },
        
        /**
         * 记录 API 调用开始
         */
        logApiCallStart: (apiName: string, params?: any) => {
            log('info', baseContext, `API call starting: ${apiName}`, {
                api: apiName,
                params: sanitizeParams(params),
            });
        },
        
        /**
         * 记录 API 调用成功
         */
        logApiCallSuccess: (apiName: string, duration: number, result?: any) => {
            log('info', baseContext, `API call succeeded: ${apiName}`, {
                api: apiName,
                durationMs: duration,
                result: sanitizeResult(result),
            });
        },
        
        /**
         * 记录 API 调用失败
         */
        logApiCallError: (apiName: string, duration: number, error: any) => {
            log('error', baseContext, `API call failed: ${apiName}`, {
                api: apiName,
                durationMs: duration,
                error: {
                    message: error?.message || String(error),
                    name: error?.name,
                    code: error?.code,
                    stack: error?.stack,
                    cause: error?.cause,
                },
            });
        },
        
        /**
         * 记录请求成功响应
         */
        logResponseSuccess: (duration: number, responseData?: any) => {
            log('info', baseContext, 'Request completed successfully', {
                durationMs: duration,
                response: sanitizeResult(responseData),
            });
        },
        
        /**
         * 记录请求失败响应
         */
        logResponseError: (duration: number, error: any, statusCode?: number) => {
            log('error', baseContext, 'Request failed', {
                durationMs: duration,
                statusCode,
                error: {
                    message: error?.message || String(error),
                    name: error?.name,
                    code: error?.code,
                    stack: error?.stack,
                    cause: error?.cause,
                },
            });
        },
        
        /**
         * 记录认证失败
         */
        logAuthFailure: (reason: string) => {
            log('warn', baseContext, `Authentication failed: ${reason}`);
        },
        
        /**
         * 记录速率限制
         */
        logRateLimited: () => {
            log('warn', baseContext, 'Request rate limited');
        },
    };
}

/**
 * 敏感字段列表 - 这些字段的值会被替换为 [REDACTED]
 */
const SENSITIVE_FIELDS = [
    'password',
    'token',
    'apiKey',
    'api_key',
    'secret',
    'authorization',
    'credential',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'privateKey',
    'private_key',
];

/**
 * 清理敏感参数
 */
function sanitizeParams(params: any): any {
    if (!params || typeof params !== 'object') {
        return params;
    }
    
    const sanitized = Array.isArray(params) ? [...params] : { ...params };
    
    for (const key of Object.keys(sanitized)) {
        if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
            (sanitized as any)[key] = '[REDACTED]';
        } else if (typeof (sanitized as any)[key] === 'object' && (sanitized as any)[key] !== null) {
            (sanitized as any)[key] = sanitizeParams((sanitized as any)[key]);
        }
    }
    
    return sanitized;
}

/**
 * 清理响应结果（截断大对象，避免日志过大）
 */
function sanitizeResult(result: any): any {
    if (!result) return result;
    
    const resultStr = JSON.stringify(result);
    
    // 如果结果太大，只保留摘要
    if (resultStr.length > 2000) {
        if (Array.isArray(result)) {
            return { type: 'array', length: result.length, truncated: true };
        }
        if (typeof result === 'object') {
            return { type: 'object', keys: Object.keys(result), truncated: true };
        }
        return { type: typeof result, length: resultStr.length, truncated: true };
    }
    
    return result;
}

/**
 * 计时器辅助类
 */
export class Timer {
    private startTime: number;
    
    constructor() {
        this.startTime = Date.now();
    }
    
    elapsed(): number {
        return Date.now() - this.startTime;
    }
    
    reset(): void {
        this.startTime = Date.now();
    }
}