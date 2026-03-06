import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getConfig } from '@/lib/config';

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });

// Define the exact schema we want the model to output
const activitySchema = {
    type: 'object',
    properties: {
        title: {
            type: 'string',
            description: "The main title or summary of the activity.",
        },
        description: {
            type: 'string',
            description: "Detailed description or notes about the activity.",
        },
        type: {
            type: 'string',
            description: "Must be exactly one of: 'task', 'event', 'reminder'.",
            format: "enum",
            enum: ["task", "event", "reminder"]
        },
        priority: {
            type: 'string',
            description: "Must be exactly one of: 'low', 'medium', 'high', 'urgent'.",
            format: "enum",
            enum: ["low", "medium", "high", "urgent"]
        },
        start_time: {
            type: 'string',
            description: "ISO 8601 formatted absolute timestamp, or null if not specified.",
            nullable: true
        },
        end_time: {
            type: 'string',
            description: "ISO 8601 formatted absolute timestamp, or null if not specified.",
            nullable: true
        },
        is_all_day: {
            type: 'boolean',
            description: "True if the event lasts all day without specific times.",
        },
        location: {
            type: 'string',
            description: "The location of the event, or null if not specified.",
            nullable: true
        }
    },
    required: ["title", "type", "priority", "is_all_day"],
};

export async function POST(req: NextRequest) {
    try {
        const { text } = await req.json();

        if (!text) {
            return NextResponse.json({ error: 'Missing text input' }, { status: 400 });
        }

        const modelName = await getConfig<string>('default_chat_model') || 'gemini-3-flash-preview';

        const systemInstruction = `你是一个日程管理大师。请阅读用户提供的一句话（可能是语音识别转写的文本），从中提取出确切的日程、待办或提醒事件信息。
你的输出必须严格符合我要求的 JSON Schema。
请注意相对时间（如”明天下午三点”）需要转为绝对时间。
当前的基准时间是：${new Date().toISOString()}`;

        const promptText = `${systemInstruction}\n\n用户文本: ${text}`;
        const result = await genai.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: {
                responseMimeType: 'application/json',
                responseSchema: activitySchema as any,
            },
        });
        const responseText = result.text || '';

        // At this point, responseText is guaranteed (by the API) to match the schema
        const parsedData = JSON.parse(responseText);

        return NextResponse.json({ result: parsedData });
    } catch (error: any) {
        console.error("Voice extract API error:", error);
        return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
    }
}
