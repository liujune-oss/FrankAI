import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/config';

export async function GET() {
    try {
        const prompt = await getConfig<string>('voice_intent_prompt');
        return NextResponse.json({ success: true, prompt });
    } catch (error: any) {
        console.error("Voice prompt GET error:", error);
        return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { prompt } = await req.json();
        if (typeof prompt !== 'string') {
            return NextResponse.json({ error: 'Invalid prompt format' }, { status: 400 });
        }
        await setConfig('voice_intent_prompt', prompt);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Voice prompt POST error:", error);
        return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
    }
}
