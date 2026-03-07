import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';
import { getConfigs } from '@/lib/config';

// GET — public (auth-protected) endpoint returning chat models and default model
export async function GET(req: NextRequest) {
    // Auth check
    const { token, fingerprint } = getAuthFromHeaders(req);
    const authPayload = await verifyToken(token, fingerprint);
    if (!authPayload || !authPayload.uid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const configs = await getConfigs(['chat_models', 'default_chat_model', 'voice_intent_model']);
        return NextResponse.json({
            success: true,
            chatModels: configs.chat_models,
            defaultChatModel: configs.default_chat_model,
            voiceIntentModel: configs.voice_intent_model,
        });
    } catch (error: any) {
        console.error('Config GET error:', error);
        return NextResponse.json({ error: error.message || 'Failed to load config' }, { status: 500 });
    }
}
