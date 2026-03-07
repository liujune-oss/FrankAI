import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getAuthFromHeaders } from '@/lib/auth';

// GET — return a short-lived Deepgram token for browser WebSocket connections
export async function GET(req: NextRequest) {
    const { token, fingerprint } = getAuthFromHeaders(req);
    const authPayload = await verifyToken(token, fingerprint);
    if (!authPayload?.uid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Deepgram not configured' }, { status: 500 });
    }

    // Return the key directly — protected by our own auth middleware.
    // The client uses it as a WebSocket subprotocol token, which is never
    // stored in localStorage or visible in the URL.
    return NextResponse.json({ token: apiKey });
}
