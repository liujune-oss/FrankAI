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

export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { username, maxUses = 3 } = await req.json();

        if (!username || typeof username !== 'string') {
            return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
        }

        // 1. Create the user
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .insert([{ username }])
            .select('id')
            .single();

        if (userError) {
            if (userError.code === '23505') { // Unique violation
                return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
            }
            throw userError;
        }

        // 2. Generate a unique 4-letter code
        let code = '';
        let isUnique = false;
        let attempts = 0;

        // Retry loop to ensure the 4-letter code is unique
        while (!isUnique && attempts < 10) {
            code = generateRandomCode(4);
            const { data: existingCode, error: checkError } = await supabaseAdmin
                .from('activation_codes')
                .select('id')
                .eq('code', code)
                .maybeSingle(); // Use maybeSingle to avoid 406 Error when not found

            if (!existingCode) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            // In a real prod with millions of users, 4 letters (456,976 combos) might saturate.
            throw new Error('Failed to generate a unique 4-letter code. The namespace might be saturated.');
        }

        // 3. Insert the activation code
        const { data: activationCode, error: codeError } = await supabaseAdmin
            .from('activation_codes')
            .insert([{
                code,
                user_id: user.id,
                max_uses: maxUses
            }])
            .select('*')
            .single();

        if (codeError) throw codeError;

        return NextResponse.json({
            success: true,
            user_id: user.id,
            username,
            code: activationCode.code
        });

    } catch (error: any) {
        console.error('Create user error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        // Fetch users with their activation codes and devices
        // Using Supabase foreign key relationships
        const { data, error } = await supabaseAdmin
            .from('users')
            .select(`
        id,
        username,
        is_active,
        created_at,
        activation_codes (
          id,
          code,
          max_uses,
          usage_count,
          is_active,
          created_at
        ),
        user_devices (
          id,
          device_fingerprint,
          is_active,
          last_active_at,
          created_at
        )
      `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ success: true, users: data });
    } catch (error: any) {
        console.error('Fetch users error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

// PATCH for turning a user on/off globally
export async function PATCH(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { user_id, is_active } = await req.json();

        if (!user_id || typeof is_active !== 'boolean') {
            return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('users')
            .update({ is_active })
            .eq('id', user_id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update user error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
