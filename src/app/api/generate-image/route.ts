import { GoogleGenAI } from '@google/genai';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const maxDuration = 120;

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });

export async function POST(req: Request) {
    // Auth check
    const { token, fingerprint } = getAuthFromHeaders(req);
    if (!await verifyToken(token, fingerprint)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { prompt, history, images } = await req.json();

        // Build contents from history (text only)
        // Only include history if we are NOT editing an image. 
        // Including history with inlineData causes issues with gemini-2.5-flash-image models.
        const contents: any[] = [];
        if (!images || images.length === 0) {
            if (history && Array.isArray(history)) {
                for (const msg of history) {
                    const parts: any[] = [];
                    if (msg.text) parts.push({ text: msg.text });
                    if (parts.length > 0) {
                        contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
                    }
                }
            }
        }
        // Add current prompt with optional uploaded images
        let finalPrompt = prompt;
        const promptParts: any[] = [];
        if (images && Array.isArray(images) && images.length > 0) {
            // When images are provided, instruct the model to edit them
            finalPrompt = `Edit the provided image based on this instruction: ${prompt}. Keep everything else unchanged.`;
            for (const img of images) {
                promptParts.push({
                    inlineData: { mimeType: img.mimeType, data: img.data }
                });
            }
        }
        promptParts.unshift({ text: finalPrompt });
        contents.push({ role: 'user', parts: promptParts });

        const imageModelName = await getConfig<string>('image_gen_model') || 'gemini-2.5-flash-image';
        const response = await genai.models.generateContent({
            model: imageModelName,
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
