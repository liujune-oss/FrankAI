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

        const systemPrompt = `你是一个智能语音分析助手。请理解这段语音的内容，去掉语气词，总结意图并将其提取为一个符合数据库定义的活动记录 (Activity)。

【数据库 Schema 定义参考】
\`\`\`sql
CREATE TABLE activities (
    title TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK (type IN ('task', 'event', 'reminder')) NOT NULL,
    status TEXT CHECK (status IN ('needs_action', 'in_process', 'completed', 'cancelled')) DEFAULT 'needs_action',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    -- A task has a due date (end_time), no start_time.
    -- An event has both start_time and end_time.
    -- A reminder might only have a start_time (when to alert).
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    is_all_day BOOLEAN DEFAULT FALSE,
    location TEXT
);
\`\`\`

【非常重要：枚举值严格约束】
- type 字段【必须且只能】是从 schema 的约束中挑选："task", "event", "reminder"。绝对不能输出其他词语！(例如绝对不能输出 "meeting" 或 "开会")
- priority 字段【必须且只能】是从 schema 的约束中挑选："low", "medium", "high", "urgent"。

【极其重要：禁止自行发明字段】
这不仅是一次内容理解，这是一次**严格的数据结构转换**。
请**绝对不要**返回诸如 "absolute_time", "original_text", 或以 "event" 作为 key 的任何你自己发明的字段。
你的整个返回数据，**必须且只能包含以下 8 个 key**：

请严格按以下 JSON 格式输出，只能是个 JSON 对象，不要输出任何多余内容或 markdown 标记：
{
  "title": "活动标题",
  "description": "详细描述（可为空字符串）",
  "type": "task" | "event" | "reminder",
  "priority": "low" | "medium" | "high" | "urgent",
  "start_time": "ISO 8601 格式或 null (重要：必须是这个 key 名字，绝不能用 absolute_time)",
  "end_time": "ISO 8601 格式或 null",
  "is_all_day": boolean,
  "location": "地点或 null"
}

推断时间时，请以此为绝对基准当前时间：${new Date().toISOString()}`;

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
