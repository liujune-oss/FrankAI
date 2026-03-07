/**
 * core-flow-test.mjs
 *
 * 核心流程端到端测试：口语日程指令 → 语义理解 → 结构化提取 → 白盒校验 → Supabase 写入
 *
 * 运行前提：
 *   - .env.local 中配置 GOOGLE_GENERATIVE_AI_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, CORE_FLOW_TEST_USER_ID
 *
 * 运行：node scripts/core-flow-test.mjs
 * 结果日志输出至 core_flow_test_log.md（项目根目录）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 颜色输出 ────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};
const pass  = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const fail  = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const info  = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);
const warn  = (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const head  = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);

// ─── 读取 .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ─── 结构化提取 Schema（镜像 voice-extract/route.ts）──────────────────────────
const activitySchema = {
  type: 'object',
  properties: {
    title:       { type: 'string',  description: '活动的简短标题' },
    description: { type: 'string',  description: '详细描述或备注' },
    type: {
      type: 'string',
      description: "必须是 'event'、'task'、'reminder'、'log' 之一",
      format: 'enum',
      enum: ['event', 'task', 'reminder', 'log'],
    },
    priority: {
      type: 'string',
      description: "必须是 'low'、'medium'、'high'、'urgent' 之一",
      format: 'enum',
      enum: ['low', 'medium', 'high', 'urgent'],
    },
    start_time:  { type: 'string',  description: 'ISO 8601 绝对时间戳，或 null', nullable: true },
    end_time:    { type: 'string',  description: 'ISO 8601 绝对时间戳，或 null', nullable: true },
    is_all_day:  { type: 'boolean', description: '是否为全天事项' },
    location:    { type: 'string',  description: '地点，或 null', nullable: true },
  },
  required: ['title', 'type', 'priority', 'is_all_day'],
};

// ─── 白盒校验 ─────────────────────────────────────────────────────────────────
const VALID_TYPES     = ['event', 'task', 'reminder', 'log'];
const VALID_PRIORITY  = ['low', 'medium', 'high', 'urgent'];

function validate(data) {
  const errors = [];
  if (!data.title || typeof data.title !== 'string' || !data.title.trim())
    errors.push('title 缺失或为空');
  if (!VALID_TYPES.includes(data.type))
    errors.push(`type 无效: "${data.type}"，期望: ${VALID_TYPES.join('/')}`);
  if (!VALID_PRIORITY.includes(data.priority))
    errors.push(`priority 无效: "${data.priority}"，期望: ${VALID_PRIORITY.join('/')}`);
  if (typeof data.is_all_day !== 'boolean')
    errors.push('is_all_day 必须为 boolean');
  if (data.start_time && isNaN(Date.parse(data.start_time)))
    errors.push(`start_time 时间格式无效: "${data.start_time}"`);
  if (data.end_time && isNaN(Date.parse(data.end_time)))
    errors.push(`end_time 时间格式无效: "${data.end_time}"`);
  return errors;
}

// ─── 写入 Supabase（镜像 executeUpsertActivity 中的 insert 逻辑）──────────────
async function writeToDb(supabase, userId, data) {
  const payload = {
    user_id:     userId,
    title:       data.title?.trim() || 'Untitled',
    description: data.description || null,
    type:        data.type,
    priority:    data.priority,
    start_time:  data.start_time  || null,
    end_time:    data.end_time    || null,
    is_all_day:  data.is_all_day  ?? false,
    location:    data.location    || null,
  };

  // task 无 end_time 时用 start_time 作 deadline
  if (payload.type === 'task' && !payload.end_time && payload.start_time) {
    payload.end_time  = payload.start_time;
    payload.start_time = null;
  }
  // event 无 end_time 时自动 +1h
  if (payload.type === 'event' && !payload.end_time && payload.start_time) {
    const d = new Date(payload.start_time);
    d.setHours(d.getHours() + 1);
    payload.end_time = d.toISOString();
  }

  const { data: row, error } = await supabase
    .from('activities')
    .insert(payload)
    .select('id, title, type, start_time')
    .single();

  if (error) throw error;
  return row;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  head('核心流程测试 — 初始化');

  // 1. 加载环境变量
  const env = loadEnv();
  const apiKey     = env.GOOGLE_GENERATIVE_AI_API_KEY;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const testUserId  = env.CORE_FLOW_TEST_USER_ID;

  if (!apiKey)      throw new Error('缺少 GOOGLE_GENERATIVE_AI_API_KEY');
  if (!supabaseUrl) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY');
  if (!testUserId)  throw new Error('缺少 CORE_FLOW_TEST_USER_ID（在 .env.local 中配置用于测试的 user_id）');

  const genai    = new GoogleGenAI({ apiKey });
  const supabase = createClient(supabaseUrl, supabaseKey);
  const now      = new Date();
  const nowISO   = now.toISOString();
  const MODEL    = 'gemini-2.5-flash';

  info(`测试时间: ${nowISO}`);
  info(`测试用户: ${testUserId}`);
  info(`模型: ${MODEL}`);

  // ─── 步骤一：生成口语化测试用例 ───────────────────────────────────────────
  head('步骤一：AI 生成口语测试用例');

  const genCasesResult = await genai.models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [{ text: `请以地道中文口语生成10条模拟用户语音输入的日常指令，每条指令要求：
- 包含明显的口语化表达（如语气词、模糊指称、废话、颠倒语序等）
- 涵盖不同类型：日程事件(event)、待办任务(task)、提醒(reminder)、日志记录(log)
- 部分指令需包含相对时间（如"明天"、"下周"、"半小时后"），以当前时间为基准: ${nowISO}
- 每条指令一行，前面加序号，不加任何解释

只输出10行指令，不输出其他内容。` }],
    }],
  });

  const casesText = (genCasesResult.text || '').trim();
  const testCases = casesText
    .split('\n')
    .map(l => l.replace(/^\d+[.、．\s]+/, '').trim())
    .filter(l => l.length > 0)
    .slice(0, 10);

  if (testCases.length < 5) {
    throw new Error(`生成的测试用例不足 5 条，实际: ${testCases.length}`);
  }

  pass(`已生成 ${testCases.length} 条测试用例`);
  testCases.forEach((t, i) => info(`  ${i + 1}. ${t}`));

  // ─── 初始化日志 ────────────────────────────────────────────────────────────
  const logLines = [
    ``,
    `# 核心流程测试日志 - ${nowISO}`,
    ``,
    `## 步骤一：生成结构化口语模拟指令`,
    `生成指令如下：`,
    ...testCases.map((t, i) => `${i + 1}. ${t}`),
    ``,
  ];

  // ─── 每条用例执行完整链路 ──────────────────────────────────────────────────
  const results = { pass: 0, fail: 0, skip: 0 };

  for (let i = 0; i < testCases.length; i++) {
    const input = testCases[i];
    head(`测试用例 ${i + 1} / ${testCases.length}`);
    info(`输入: ${input}`);

    logLines.push(`---`);
    logLines.push(`### 测试用例 ${i + 1} / ${testCases.length}`);
    logLines.push(`**输入原始口令**: ${input}`);
    logLines.push(``);

    let semanticText = '';
    let extracted = null;
    let validErrors = [];
    let dbRow = null;
    let stepError = null;

    // ── 步骤二：语义梳理 ────────────────────────────────────────────────────
    try {
      info('步骤二：语义梳理...');
      const semanticResult = await genai.models.generateContent({
        model: MODEL,
        contents: [{
          role: 'user',
          parts: [{ text: `你是日程助手。请对以下口语化输入进行语义梳理，提取时间、地点、核心意图和具体内容。
以当前时间为基准: ${nowISO}（北京时间=UTC+8）

用户输入：${input}

请以结构化的条目格式输出梳理结果，不需要完整 JSON。` }],
        }],
      });
      semanticText = (semanticResult.text || '').trim();
      info('语义梳理完成');
    } catch (e) {
      stepError = `语义梳理失败: ${e.message}`;
      warn(stepError);
    }

    logLines.push(`#### 步骤二：语义梳理 (Gemini 模型)`);
    logLines.push(`**梳理结果**:`);
    logLines.push(semanticText || `（跳过：${stepError}）`);
    logLines.push(``);

    // ── 步骤三：结构化提取 JSON ────────────────────────────────────────────
    if (!stepError) {
      try {
        info('步骤三：结构化 JSON 提取...');
        const systemPrompt = `你是日程管理专家。从用户的口语输入中提取日程字段，输出严格符合 JSON Schema 的对象。
所有文字字段（title、description 等）必须使用简体中文。
相对时间需转为绝对时间，当前基准时间: ${nowISO}（北京时间 = UTC+8，即 +08:00）。`;

        const extractResult = await genai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n用户输入: ${input}` }] }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: activitySchema,
          },
        });

        extracted = JSON.parse(extractResult.text || '{}');
        info(`提取结果: ${JSON.stringify(extracted)}`);
      } catch (e) {
        stepError = `结构化提取失败: ${e.message}`;
        warn(stepError);
      }
    }

    logLines.push(`#### 步骤三：核心字段提取 JSON`);
    logLines.push(`**提取的 JSON 对象**:`);
    if (extracted) {
      logLines.push('```json');
      logLines.push(JSON.stringify(extracted, null, 2));
      logLines.push('```');
    } else {
      logLines.push(`（跳过：${stepError}）`);
    }
    logLines.push(``);

    // ── 步骤四：白盒校验 ────────────────────────────────────────────────────
    if (extracted) {
      validErrors = validate(extracted);
      if (validErrors.length === 0) {
        pass('步骤四：白盒校验通过');
        logLines.push(`#### 步骤四：结果校验（白盒代码执行）`);
        logLines.push(`✅ [校验通过]: 必填及类型格式合法，满足数据库写入门槛。`);
      } else {
        fail(`步骤四：白盒校验失败 — ${validErrors.join('; ')}`);
        stepError = `校验失败: ${validErrors.join('; ')}`;
        logLines.push(`#### 步骤四：结果校验（白盒代码执行）`);
        logLines.push(`❌ [校验失败]: ${validErrors.join('; ')}`);
      }
      logLines.push(``);
    }

    // ── 步骤五：写入 Supabase ──────────────────────────────────────────────
    if (extracted && validErrors.length === 0) {
      try {
        info('步骤五：写入 Supabase...');
        dbRow = await writeToDb(supabase, testUserId, extracted);
        pass(`步骤五：写入成功 — ID: ${dbRow.id}`);
        results.pass++;
        logLines.push(`#### 步骤五：写入数据库`);
        logLines.push(`✅ [写入成功]: 数据已存入 activities 表。数据库主键 ID: ${dbRow.id}`);
      } catch (e) {
        fail(`步骤五：写入失败 — ${e.message}`);
        stepError = `DB 写入失败: ${e.message}`;
        results.fail++;
        logLines.push(`#### 步骤五：写入数据库`);
        logLines.push(`❌ [写入失败]: ${e.message}`);
      }
    } else if (stepError) {
      results.skip++;
      logLines.push(`#### 步骤五：写入数据库`);
      logLines.push(`⏭ [已跳过]: 前置步骤失败，跳过写入。原因: ${stepError}`);
      warn(`用例 ${i + 1} 跳过写入`);
    }

    logLines.push(``);
  }

  // ─── 汇总 ─────────────────────────────────────────────────────────────────
  head('测试汇总');
  console.log(`  通过: ${c.green}${results.pass}${c.reset}  失败: ${c.red}${results.fail}${c.reset}  跳过: ${c.yellow}${results.skip}${c.reset}  共: ${testCases.length}`);

  logLines.push(`---`);
  logLines.push(``);
  logLines.push(`## 测试汇总`);
  logLines.push(``);
  logLines.push(`| 项目 | 数量 |`);
  logLines.push(`|------|------|`);
  logLines.push(`| 总用例 | ${testCases.length} |`);
  logLines.push(`| 写入成功 | ${results.pass} |`);
  logLines.push(`| 写入失败 | ${results.fail} |`);
  logLines.push(`| 跳过 | ${results.skip} |`);
  logLines.push(``);
  logLines.push(`测试完成时间: ${new Date().toISOString()}`);

  // ─── 写入日志文件 ──────────────────────────────────────────────────────────
  const logPath = path.resolve(__dirname, '../core_flow_test_log.md');
  fs.writeFileSync(logPath, logLines.join('\n'), 'utf-8');
  pass(`日志已写入: ${logPath}`);

  if (results.fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(`${c.red}[FATAL]${c.reset} ${e.message}`);
  process.exit(1);
});
