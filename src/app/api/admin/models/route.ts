import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });

// GET — fetch all available models from Gemini API
export async function GET() {
    try {
        const models: { id: string; displayName: string; description: string; supportedActions: string[] }[] = [];

        const pager = await genai.models.list({ config: { pageSize: 100 } });

        for await (const model of pager) {
            models.push({
                id: model.name?.replace('models/', '') || '',
                displayName: model.displayName || model.name || '',
                description: model.description || '',
                supportedActions: (model as any).supportedGenerationMethods || [],
            });
        }

        return NextResponse.json({ success: true, models });
    } catch (error: any) {
        console.error('List models error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch models' },
            { status: 500 }
        );
    }
}
