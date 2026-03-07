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
                        { text: "Please transcribe the following audio directly. Just output the transcript in Chinese if it is spoken in Chinese, without any additional conversational padding, markdown, or greetings. If you cannot hear anything, just say '[null]'." }
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
