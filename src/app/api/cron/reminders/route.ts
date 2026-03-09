import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getConfig } from '@/lib/config';

export const maxDuration = 30;

// 由 cron-job.org 每5分钟调用一次
// 请求需带 ?secret=xxx，与 app_config 中 cron_secret 一致
// 同时支持 GET 和 POST（cron-job.org 默认发 GET）
async function handler(req: NextRequest) {
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

    // 查找未来 11 分钟内 + 过去 1 分钟内的提醒（覆盖 10min 和 5min 两个窗口）
    const now = new Date();
    const nowMs = now.getTime();
    const windowStart = new Date(nowMs - 1 * 60 * 1000).toISOString();
    const windowEnd = new Date(nowMs + 11 * 60 * 1000).toISOString();

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
        const meta = (reminder.metadata as Record<string, unknown>) ?? {};
        const startMs = new Date(reminder.start_time as string).getTime();
        const diffMin = (startMs - nowMs) / 60000; // 距离开始还有多少分钟（负数=已过）

        // 10分钟提醒：距离开始 5~11 分钟
        const need10 = diffMin >= 5 && diffMin < 11 && !meta.dingtalk_sent_10min && !meta.dingtalk_sent;
        // 5分钟提醒：距离开始 -1~6 分钟
        const need5 = diffMin >= -1 && diffMin < 6 && !meta.dingtalk_sent_5min && !meta.dingtalk_sent;

        if (!need10 && !need5) continue;

        const timeStr = reminder.start_time
            ? new Date(reminder.start_time as string).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'
            })
            : '';

        // 发送单条提醒
        const sendDingTalk = async (label: string): Promise<boolean> => {
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

            if (!res.ok) {
                const body = await res.text();
                failures.push(`${reminder.id}(${label}): ${res.status} ${body}`);
                return false;
            }
            return true;
        };

        try {
            if (need10) {
                const ok = await sendDingTalk('10分钟');
                if (ok) {
                    await supabaseAdmin.from('activities').update({
                        metadata: { ...meta, dingtalk_sent_10min: true, dingtalk_sent_10min_at: now.toISOString() }
                    }).eq('id', reminder.id);
                    sent++;
                }
            }

            if (need5) {
                // 读取最新 meta（可能刚被 10min 写入更新过）
                const { data: fresh } = await supabaseAdmin
                    .from('activities').select('metadata').eq('id', reminder.id).single();
                const freshMeta = (fresh?.metadata as Record<string, unknown>) ?? meta;

                const ok = await sendDingTalk('5分钟');
                if (ok) {
                    await supabaseAdmin.from('activities').update({
                        metadata: { ...freshMeta, dingtalk_sent_5min: true, dingtalk_sent_5min_at: now.toISOString() }
                    }).eq('id', reminder.id);
                    sent++;
                }
            }
        } catch (e: any) {
            failures.push(`${reminder.id}: ${e.message}`);
        }
    }

    return NextResponse.json({ sent, failures: failures.length ? failures : undefined });
}

export const GET = handler;
export const POST = handler;
