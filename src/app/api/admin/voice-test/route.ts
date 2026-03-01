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
请严格返回以下格式的 JSON 对象：
{
  "title": "活动简要标题",
  "description": "如果有详细说明可以放这里",
  "type": "task" | "event" | "reminder",
  "priority": "low" | "medium" | "high" | "urgent" (默认 medium),
  "start_time": "ISO时间戳，如2026-03-02T15:00:00Z，没有则留空",
  "end_time": "ISO时间戳，截止日期或结束时间，没有则留空",
  "is_all_day": boolean,
  "location": "地点，没有留空"
}
当前时间(参考)：${new Date().toISOString()}`;

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
