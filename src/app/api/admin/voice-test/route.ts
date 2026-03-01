import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { getConfig } from '@/lib/config';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

export async function POST(req: NextRequest) {
    try {
        const { audioBase64, mimeType, prompt } = await req.json();

        if (!audioBase64 || !mimeType) {
            return NextResponse.json({ error: 'Missing audio data' }, { status: 400 });
        }

        const modelName = await getConfig<string>('voice_model') || 'gemini-3-flash-preview';
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const systemPrompt = `你是一个智能语音分析助手。请理解这段语音的内容，去掉语气词，总结意图并将其提取为一个活动记录 (Activity)。

【非常重要：枚举值严格约束】
- type 字段【必须且只能】是以下三个字符串之一："task"（待办/无明确时间的任务）、"event"（日程/有具体起止时间的会议或活动）、"reminder"（单次提醒）。绝对不能输出其他词语！
- priority 字段【必须且只能】是以下四个字符串之一："low"、"medium"、"high"、"urgent"。如果没有明显优先级，默认为 "medium"。

请严格按以下 JSON schema 格式输出：
{
  "title": "活动简要标题",
  "description": "如果有详细说明可以放这里",
  "type": "task" | "event" | "reminder",
  "priority": "low" | "medium" | "high" | "urgent",
  "start_time": "ISO 8601格式的时间戳 (例如: 2026-03-02T15:00:00Z)，没有明确开始时间则留空 null",
  "end_time": "ISO 8601格式的时间戳，作为日程的结束时间或待办的截止时间，没有则留空 null",
  "is_all_day": boolean,
  "location": "地点，没有留空 null"
}

推断时间时，请以此为基准当前时间：${new Date().toISOString()}`;

        const parts = [
            { text: prompt || systemPrompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: audioBase64,
                }
            }
        ];

        const result = await model.generateContent(parts);
        const responseText = result.response.text();

        return NextResponse.json({ result: responseText });
    } catch (error: any) {
        console.error("Voice test API error:", error);
        return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
    }
}
