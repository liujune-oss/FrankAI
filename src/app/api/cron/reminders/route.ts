import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getConfig } from '@/lib/config';

export const maxDuration = 30;

// 由 cron-job.org 每5分钟调用一次
// 请求需带 ?secret=xxx，与 app_config 中 cron_secret 一致
export async function POST(req: NextRequest) {
    const secret = req.nextUrl.searchParams.get('secret');
    const configSecret = await getConfig<string>('cron_secret');

    if (!configSecret || secret !== configSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
    }

    const webhookUrl = await getConfig<string>('dingtalk_webhook_url');
    if (!webhookUrl) {
        return NextResponse.json({ skipped: true, reason: 'dingtalk_webhook_url not configured' });
    }

    // 加签密钥（可选）
    const signSecret = await getConfig<string>('dingtalk_sign_secret');

    // 查找5分钟内到期的提醒（start_time 在 now-5min ~ now+30s 之间）
    const now = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + 30 * 1000).toISOString();

    const { data: reminders, error } = await supabaseAdmin
        .from('activities')
        .select('id, title, description, start_time, end_time, type, metadata')
        .eq('type', 'reminder')
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .gte('start_time', windowStart)
        .lte('start_time', windowEnd);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!reminders || reminders.length === 0) {
        return NextResponse.json({ sent: 0 });
    }

    let sent = 0;
    const failures: string[] = [];

    for (const reminder of reminders) {
        // 跳过已发送的
        const meta = (reminder.metadata as Record<string, unknown>) ?? {};
        if (meta.dingtalk_sent) continue;

        const time = reminder.start_time
            ? new Date(reminder.start_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
            : '';

        const text = [
            `⏰ **提醒**`,
            `📌 ${reminder.title}`,
            time ? `🕐 ${time}` : '',
            reminder.description ? `📝 ${reminder.description}` : '',
        ].filter(Boolean).join('\n');

        // 构建带加签的 URL（如果配置了加签密钥）
        let sendUrl = webhookUrl;
        if (signSecret) {
            const timestamp = Date.now().toString();
            const stringToSign = `${timestamp}\n${signSecret}`;
            const hmac = createHmac('sha256', signSecret);
            hmac.update(stringToSign, 'utf8');
            const sign = encodeURIComponent(hmac.digest('base64'));
            sendUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: 'markdown',
                    markdown: { title: `提醒：${reminder.title}`, text },
                }),
            });

            if (!res.ok) {
                const body = await res.text();
                failures.push(`${reminder.id}: ${res.status} ${body}`);
                continue;
            }

            // 标记已发送
            await supabaseAdmin
                .from('activities')
                .update({ metadata: { ...meta, dingtalk_sent: true, dingtalk_sent_at: now.toISOString() } })
                .eq('id', reminder.id);

            sent++;
        } catch (e: any) {
            failures.push(`${reminder.id}: ${e.message}`);
        }
    }

    return NextResponse.json({ sent, failures: failures.length ? failures : undefined });
}
