import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
    const token = req.headers.get('x-activation-token');
    const fingerprint = req.headers.get('x-device-fingerprint');
    const payload = await verifyToken(token, fingerprint);
    if (!payload || !payload.is_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ isAdmin: true });
}
