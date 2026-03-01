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

        const basePrompt = prompt || "请将以下语音内容提取为清晰、专业的文字笔记，并去除废话和语气词。";
        const finalPrompt = `${basePrompt}\n\n推断时间时，请以此为绝对基准当前时间：${new Date().toISOString()}`;

        const parts = [
            { text: finalPrompt },
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
