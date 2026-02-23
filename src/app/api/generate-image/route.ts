import { GoogleGenAI } from '@google/genai';

export const maxDuration = 120;

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });

export async function POST(req: Request) {
    try {
        const { prompt, history } = await req.json();

        // Build contents from history + current prompt
        const contents: any[] = [];
        if (history && Array.isArray(history)) {
            for (const msg of history) {
                const parts: any[] = [];
                if (msg.text) parts.push({ text: msg.text });
                if (msg.images) {
                    for (const img of msg.images) {
                        parts.push({
                            inlineData: { mimeType: img.mimeType, data: img.data }
                        });
                    }
                }
                if (parts.length > 0) {
                    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
                }
            }
        }
        // Add current prompt
        contents.push({ role: 'user', parts: [{ text: prompt }] });

        const response = await genai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents,
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
            },
        });

        const parts: any[] = [];

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) {
                    parts.push({ type: 'text', text: part.text });
                } else if (part.inlineData) {
                    parts.push({
                        type: 'image',
                        mimeType: part.inlineData.mimeType,
                        data: part.inlineData.data,
                    });
                }
            }
        }

        return Response.json({ parts });
    } catch (error: any) {
        console.error('Image Gen Error:', error);
        return Response.json(
            { error: error?.message || 'Image generation failed' },
            { status: 500 }
        );
    }
}
