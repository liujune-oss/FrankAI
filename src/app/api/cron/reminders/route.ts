import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getConfig } from '@/lib/config';

export const maxDuration = 30;

// 由 cron-job.org 每5分钟调用一次
// 请求需带 ?secret=xxx，与 app_config 中 cron_secret 一致
// 同时支持 GET 和 POST（cron-job.org 默认发 GET）
async function handler(req: NextRequest) {
    try {
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

    const signSecret = await getConfig<string>('dingtalk_sign_secret');
    const reminderUserId = await getConfig<string>('dingtalk_reminder_user_id');
    if (!reminderUserId) {
        return NextResponse.json({ skipped: true, reason: 'dingtalk_reminder_user_id not configured' });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const BUFFER = 30 * 1000; // ±30秒容错窗口

    // 10分钟提醒窗口：start_time 在 now+9.5min ~ now+10.5min
    const w10Start = new Date(nowMs + 9.5 * 60 * 1000).toISOString();
    const w10End   = new Date(nowMs + 10.5 * 60 * 1000).toISOString();

    // 5分钟提醒窗口：start_time 在 now+4.5min ~ now+5.5min
    const w5Start  = new Date(nowMs + 4.5 * 60 * 1000).toISOString();
    const w5End    = new Date(nowMs + 5.5 * 60 * 1000).toISOString();

    // 查两个窗口合并（用 or 逻辑在应用层区分）
    const { data: reminders10, error: err10 } = await supabaseAdmin
        .from('activities')
        .select('id, title, description, start_time, type')
        .eq('user_id', reminderUserId)
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .gte('start_time', w10Start)
        .lte('start_time', w10End);

    const { data: reminders5, error: err5 } = await supabaseAdmin
        .from('activities')
        .select('id, title, description, start_time, type')
        .eq('user_id', reminderUserId)
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .gte('start_time', w5Start)
        .lte('start_time', w5End);

    if (err10 || err5) {
        return NextResponse.json({ error: (err10 || err5)?.message }, { status: 500 });
    }

    // 发送钉钉消息
    const sendDingTalk = async (reminder: any, label: string): Promise<boolean> => {
        const timeStr = reminder.start_time
            ? new Date(reminder.start_time).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'
            })
            : '';

        const text = [
            `⏰ **${label}提醒**`,
            `📌 ${reminder.title}`,
            timeStr ? `🕐 ${timeStr}` : '',
            reminder.description ? `📝 ${reminder.description}` : '',
        ].filter(Boolean).join('\n');

        let sendUrl = webhookUrl;
        if (signSecret) {
            const timestamp = Date.now().toString();
            const stringToSign = `${timestamp}\n${signSecret}`;
            const hmac = createHmac('sha256', signSecret);
            hmac.update(stringToSign, 'utf8');
            const sign = encodeURIComponent(hmac.digest('base64'));
            sendUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
        }

        const res = await fetch(sendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgtype: 'markdown',
                markdown: { title: `${label}提醒：${reminder.title}`, text },
            }),
        });

        return res.ok;
    };

    let sent = 0;
    const failures: string[] = [];

    for (const r of reminders10 ?? []) {
        try {
            const ok = await sendDingTalk(r, '10分钟');
            if (ok) sent++; else failures.push(`${r.id}(10min)`);
        } catch (e: any) { failures.push(`${r.id}: ${e.message}`); }
    }

    for (const r of reminders5 ?? []) {
        try {
            const ok = await sendDingTalk(r, '5分钟');
            if (ok) sent++; else failures.push(`${r.id}(5min)`);
        } catch (e: any) { failures.push(`${r.id}: ${e.message}`); }
    }

    return NextResponse.json({ sent, failures: failures.length ? failures : undefined });
    } catch (e: any) {
        console.error('[cron/reminders] Unhandled error:', e);
        return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
    }
}

export const GET = handler;
export const POST = handler;
