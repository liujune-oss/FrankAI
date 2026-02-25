import { NextRequest, NextResponse } from 'next/server';
import { getAllConfigs, setConfig } from '@/lib/config';

// GET — return all config entries
export async function GET() {
    try {
        const configs = await getAllConfigs();
        return NextResponse.json({ success: true, configs });
    } catch (error: any) {
        console.error('Config GET error:', error);
        return NextResponse.json({ error: error.message || 'Failed to load config' }, { status: 500 });
    }
}

// PATCH — update a specific config key
export async function PATCH(req: NextRequest) {
    try {
        const { key, value } = await req.json();

        if (!key || value === undefined) {
            return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
        }

        await setConfig(key, value);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Config PATCH error:', error);
        return NextResponse.json({ error: error.message || 'Failed to update config' }, { status: 500 });
    }
}
