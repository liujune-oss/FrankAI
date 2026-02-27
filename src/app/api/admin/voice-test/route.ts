import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

export async function POST(req: NextRequest) {
    try {
        const { audioBase64, mimeType, prompt } = await req.json();

        if (!audioBase64 || !mimeType) {
            return NextResponse.json({ error: 'Missing audio data' }, { status: 400 });
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

        const parts = [
            { text: prompt || "请将以下语音内容提取为清晰、专业的文字笔记，并去除废话和语气词。" },
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
