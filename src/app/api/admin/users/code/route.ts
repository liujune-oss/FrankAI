import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

function generateRandomCode(length: number = 4): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// POST: Generate a NEW code for an existing user
export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { user_id, maxUses = 3 } = await req.json();

        if (!user_id) {
            return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 });
        }

        let code = '';
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            code = generateRandomCode(4);
            const { data: existingCode } = await supabaseAdmin
                .from('activation_codes')
                .select('id')
                .eq('code', code)
                .maybeSingle();

            if (!existingCode) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            throw new Error('Failed to generate a unique 4-letter code.');
        }

        const { data: activationCode, error: codeError } = await supabaseAdmin
            .from('activation_codes')
            .insert([{
                code,
                user_id,
                max_uses: maxUses
            }])
            .select('*')
            .single();

        if (codeError) throw codeError;

        return NextResponse.json({ success: true, code: activationCode });
    } catch (error: any) {
        console.error('Create new code error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

// PATCH: Toggle code active status (Deactivate a leaked code without deleting it)
export async function PATCH(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { code_id, is_active } = await req.json();

        if (!code_id || typeof is_active !== 'boolean') {
            return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('activation_codes')
            .update({ is_active })
            .eq('id', code_id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update code error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
