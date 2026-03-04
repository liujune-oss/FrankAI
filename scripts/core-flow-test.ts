import fs from 'fs';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const LOG_FILE = path.join(process.cwd(), 'core_flow_test_log.md');

function appendLog(text: string) {
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '');
    }
    fs.appendFileSync(LOG_FILE, text + '\n');
    console.log(text);
}

async function runTest() {
    appendLog(`\n# 核心流程测试日志 - ${new Date().toISOString()}`);

    // 步骤一：生成模拟指令
    appendLog('\n## 步骤一：生成结构化口语模拟指令');
    const systemNow = new Date();
    const systemTimeStr = `当前系统实时时间：${systemNow.toISOString()} (如果是下午时间，请换算为24小时制的时区+8北京时间，当前UTC是 ${systemNow.toISOString()} )`;

    const { text: simulatedText } = await generateText({
        model: google('gemini-3-flash-preview'),
        prompt: "请生成10条模拟人类语气的日常口语化指令，用于要求AI创建待办任务(task)、提醒或会议日程(event)以及日记/随手记/日志(log)。要求：尽量模拟人类的真实口头表达习惯，语序不需要非常严格地规范，可以带有废话，口语色彩浓厚。例如“哎帮我记一下明天下午要开个评审会”。每条指令输出一行，不要带序号前缀和特殊标点符号。"
    });

    const prompts = simulatedText.split('\n').map(p => p.trim()).filter(Boolean).slice(0, 10);
    appendLog('生成指令如下：');
    prompts.forEach((p, i) => appendLog(`${i + 1}. ${p}`));

    // 寻找存在的 user_id 来绑定数据库数据
    const { data: existingAct } = await supabase.from('activities').select('user_id').limit(1);
    const userId = existingAct?.[0]?.user_id || '00000000-0000-0000-0000-000000000000';

    for (let i = 0; i < prompts.length; i++) {
        const p = prompts[i];
        appendLog(`\n---\n### 测试用例 ${i + 1} / 10`);
        appendLog(`**输入原始口令**: ${p}`);

        let extractionSuccess = false;
        let attempts = 0;
        const maxAttempts = 2; // Allow 1 retry

        while (!extractionSuccess && attempts < maxAttempts) {
            attempts++;
            try {
                if (attempts > 1) {
                    appendLog(`\n🔄 [重试触发] 白盒未通过，正在进行第 ${attempts} 次尝试重抽...`);
                }

                // 步骤二：语义梳理
                appendLog('\n#### 步骤二：语义梳理 (调用 Gemini模型)');
                const { text: semanticText } = await generateText({
                    model: google('gemini-3-flash-preview'),
                    prompt: `${systemTimeStr}\n\n请对以下用户的口语化输入进行高度清晰的语义梳理，分离出：时间、地点、核心意图（类型）及具体内容/主题描述。\n\n输入： "${p}"`
                });
                appendLog(`**梳理结果**:\n${semanticText.trim()}`);

                // 步骤三：核心字段提取
                appendLog('\n#### 步骤三：核心字段提取 JSON (调用模型结构化提取)');
                const { object: extracted } = await generateObject({
                    model: google('gemini-3-flash-preview'),
                    schema: z.object({
                        type: z.enum(['event', 'task', 'log']),
                        title: z.string().describe('The core activity title or summary. CANNOT BE EMPTY.'),
                        start_time: z.string().nullable().describe('ISO-8601 string in local time or UTC based on input. For tasks, this might be null if no clear schedule. If it is an event, both start and end time should be deduced.'),
                        end_time: z.string().nullable().describe('ISO-8601 string. Tasks usually have an end_time as deadline. Events usually have both start and end.'),
                        location: z.string().nullable().describe('Specific location, null if not provided'),
                        description: z.string().nullable().describe('Detailed original text or additional details')
                    }),
                    prompt: `${systemTimeStr}\n基于以下梳理结果，提取符合预定 JSON Schema 的核心字段：\n\n${semanticText}\n\n严格指令要求：\n1. 如果包含时间信息，必须依据当前系统时间转换为格式化的 ISO-8601 时间戳。\n2. 从内容中概括尽量短的 title，如果没有则至少返回 '未命名事务'。\n3. 类型严格归为 event(日程/会议/明确时段行程)、task(任务/待办/需要按期完成的事项) 或 log(普通记录/日记/随手记，凡是不具有待办性质且不必做时间规划的都算log)。\n4. 如果类型是任务 task 且有时间，请将时间尽可能作为【截止日 (end_time)】。\n5. 如果类型是日程 event 但没有说时长，请默认补充为1小时间隔的 end_time。\n6. 如果类型是日志 log，可以不带具体时间，使用当前时间或 null 均可。`
                });
                appendLog(`**提取的 JSON 对象**:\n\`\`\`json\n${JSON.stringify(extracted, null, 2)}\n\`\`\``);

                // 步骤四：白盒逻辑结果校验
                appendLog('\n#### 步骤四：结果校验（白盒代码执行，不依赖模型）');

                if (!extracted.title || extracted.title.trim() === '') {
                    throw new Error("数据不合法。'title' 必填项不能为空。");
                }
                if (!['event', 'task', 'log'].includes(extracted.type)) {
                    throw new Error(`数据不合法。Type '${extracted.type}' 并非预设枚举值。`);
                }

                if (extracted.type === 'event' && !extracted.start_time) {
                    appendLog(`⚠️ [警告]: 此项被判定为 'event' (日程) 但没解析出 start_time，可能导致日历视图渲染异常。`);
                }

                if (extracted.type === 'task' && !extracted.end_time && extracted.start_time) {
                    // Code correction to map start_time into end_time for tasks due to schema assumption
                    extracted.end_time = extracted.start_time;
                    extracted.start_time = null;
                    appendLog(`🔧 [白盒修正]: 类型为 'task' 的时间属性转移至 'end_time' (作为 Deadline)。`);
                }

                appendLog('✅ [校验通过]: 必填及类型格式合法，满足数据库写入门槛。');

                // 步骤五：落库
                appendLog('\n#### 步骤五：写入本地数据库');
                const dbPayload = {
                    title: extracted.title,
                    type: extracted.type,
                    start_time: extracted.start_time,
                    end_time: extracted.end_time,
                    location: extracted.location,
                    description: extracted.description,
                    user_id: userId
                };

                const { data: insertData, error: dbErr } = await supabase.from('activities').insert(dbPayload).select().single();
                if (dbErr) {
                    // Try to downgrade 'log' to 'task' if database hasn't updated its check constraint yet
                    if (dbErr.code === '23514' && dbPayload.type === 'log') {
                        appendLog(`⚠️ [数据库降级容错]: Supabase 存在 type 枚举约束未能接受 'log'，将自动在代码层降级存为 'task' 并打入 tag`);
                        const payloadFallback = { ...dbPayload, type: 'task', tags: ['log'] };
                        const { data: fbData, error: fbErr } = await supabase.from('activities').insert(payloadFallback).select().single();
                        if (fbErr) throw new Error(`降级写入 'task' 依然失败 - ${fbErr.message || JSON.stringify(fbErr)}`);
                        appendLog(`✅ [降级写入成功]: 数据已作为 'task' (附带 log tag) 形式存入。主键 ID: ${fbData.id}`);
                    } else {
                        throw new Error(`数据库写入失败 - ${dbErr.message || JSON.stringify(dbErr)}`);
                    }
                } else {
                    appendLog(`✅ [写入成功]: 数据已被有效存入活动的 Table 中。数据库活动主键 ID: ${insertData.id}`);
                }

                extractionSuccess = true; // Loop break condition

            } catch (err: any) {
                appendLog(`\n❗ [流程异常拦截]: ${err.message}`);
                if (attempts === maxAttempts) {
                    appendLog(`🚨 [重试超限]: 已尝试 ${maxAttempts} 次依旧失败，放弃该条口令写入。`);
                }
            }
        }
    }

    appendLog('\n---\n🎯 **本轮核心流程自动化测试已经完成**\n');
}

runTest().catch(e => {
    console.error('致命错误，脚本退出', e);
    process.exit(1);
});
