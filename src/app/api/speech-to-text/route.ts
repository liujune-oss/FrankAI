import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export async function POST(req: NextRequest) {
    try {
        const { token, fingerprint } = getAuthFromHeaders(req);
        const authPayload = await verifyToken(token, fingerprint);
        if (!authPayload || !authPayload.uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = audioFile.type || 'audio/webm';

        const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
        const sttModel = await getConfig<string>('voice_stt_model');

        const response = await ai.models.generateContent({
            model: sttModel,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: base64Data, mimeType } },
                        { text: "请直接转写以下音频。如果是中文，直接输出中文转写文本，字与字之间不要加空格，保持正常中文排版。不要添加任何解释、问候语或markdown格式。如果听不到任何内容，只输出 '[null]'。" }
                    ]
                }
            ]
        });

        const transcript = response.text || '';

        if (transcript.trim() === '[null]') {
            return NextResponse.json({ transcript: '' });
        }

        return NextResponse.json({ transcript: transcript.trim() });

    } catch (error: any) {
        console.error('Speech to text error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
