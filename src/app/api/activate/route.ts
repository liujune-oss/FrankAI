import { signToken } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { code, fingerprint } = await req.json();

        if (!code || !fingerprint) {
            return Response.json({ error: '请输入激活码' }, { status: 400 });
        }

        const upperCode = code.toUpperCase();

        // 1. Validate code via Supabase
        if (!supabaseAdmin) {
            return Response.json({ error: 'Database not configured' }, { status: 500 });
        }

        const { data: activationCode, error: codeError } = await supabaseAdmin
            .from('activation_codes')
            .select('id, user_id, max_uses, usage_count, is_active, users!inner(is_active)')
            .eq('code', upperCode)
            .maybeSingle();

        if (codeError || !activationCode) {
            return Response.json({ error: '激活码无效或不存在' }, { status: 403 });
        }

        const userIsActive = Array.isArray(activationCode.users)
            ? activationCode.users[0]?.is_active
            : (activationCode.users as any)?.is_active;

        if (!activationCode.is_active || !userIsActive) {
            return Response.json({ error: '此激活码或账户已被停用' }, { status: 403 });
        }

        // 2. Check Device & Usage Count
        // Let's see if this device already exists for this code/user
        const { data: existingDevice } = await supabaseAdmin
            .from('user_devices')
            .select('id, is_active')
            .eq('activation_code_id', activationCode.id)
            .eq('device_fingerprint', fingerprint)
            .maybeSingle();

        if (existingDevice) {
            if (!existingDevice.is_active) {
                return Response.json({ error: '您的设备已被管理员封禁' }, { status: 403 });
            }
            // Update last seen
            await supabaseAdmin.from('user_devices').update({ last_active_at: new Date().toISOString() }).eq('id', existingDevice.id);
        } else {
            // New Device Activation
            if (activationCode.usage_count >= activationCode.max_uses) {
                return Response.json({ error: '此激活码的绑定设备数已达上限' }, { status: 403 });
            }

            // Record new device
            await supabaseAdmin.from('user_devices').insert([{
                user_id: activationCode.user_id,
                activation_code_id: activationCode.id,
                device_fingerprint: fingerprint
            }]);

            // Increment usage count
            await supabaseAdmin.from('activation_codes').update({
                usage_count: activationCode.usage_count + 1
            }).eq('id', activationCode.id);
        }

        // 3. Issue Token
        const token = await signToken(fingerprint, activationCode.user_id);
        return Response.json({ token, user_id: activationCode.user_id });

    } catch (error: any) {
        console.error('Activation Error:', error);
        return Response.json({ error: '激活失败' }, { status: 500 });
    }
}
