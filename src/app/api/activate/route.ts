import { signToken, isValidCode } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const { code, fingerprint } = await req.json();

        if (!code || !fingerprint) {
            return Response.json({ error: '请输入激活码' }, { status: 400 });
        }

        if (!isValidCode(code)) {
            return Response.json({ error: '激活码无效' }, { status: 403 });
        }

        const token = await signToken(fingerprint);
        return Response.json({ token });
    } catch (error: any) {
        console.error('Activation Error:', error);
        return Response.json({ error: '激活失败' }, { status: 500 });
    }
}
