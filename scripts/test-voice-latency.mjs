/**
 * test-voice-latency.mjs
 *
 * 测试语音添加任务的各步延迟（从第2步开始，跳过STT）：
 *   Step 2: /api/chat 调用（模型推理 + 工具决策）
 *   Step 3: upsert_activity 工具落库
 *   Step 4: /api/activities 前端刷新
 *
 * 运行：node scripts/test-voice-latency.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SignJWT } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
  bold: '\x1b[1m', blue: '\x1b[34m',
};
const log  = (msg) => console.log(msg);
const info = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);
const step = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);
const ok   = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}!${c.reset} ${msg}`);
const dur  = (ms)  => `${c.bold}${c.blue}${ms}ms${c.reset}`;

// ─── 读 .env.local ────────────────────────────────────────────────────────────
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

// ─── 签 JWT ───────────────────────────────────────────────────────────────────
async function signToken(secret, fingerprint, userId) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ fp: fingerprint, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('3650d')
    .sign(key);
}

// ─── 获取第一个用户 ───────────────────────────────────────────────────────────
async function getFirstUserId(env) {
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?select=id&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const data = await res.json();
  if (!data?.[0]?.id) throw new Error('没有找到用户');
  return data[0].id;
}

// ─── 消费 SSE 流并记录时间点 ──────────────────────────────────────────────────
async function consumeChatSSE(res) {
  const timeline = {};
  const t0 = Date.now();
  timeline.request_sent = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(raw); } catch { continue; }

      const elapsed = Date.now() - t0;

      if (evt.type === 'text-start' && !timeline.first_token) {
        timeline.first_token = elapsed;
        info(`  first-token:  ${dur(elapsed)}`);
      }
      if (evt.type === 'tool-call' && !timeline.tool_call) {
        timeline.tool_call = elapsed;
        info(`  tool-call (${evt.toolName}): ${dur(elapsed)}`);
      }
      if (evt.type === 'tool-result' && !timeline.tool_result) {
        timeline.tool_result = elapsed;
        info(`  tool-result:  ${dur(elapsed)}`);
      }
      if (evt.type === 'finish') {
        timeline.finish = elapsed;
        info(`  finish:       ${dur(elapsed)}`);
      }
    }
  }

  timeline.total_stream = Date.now() - t0;
  return timeline;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const BASE = 'http://localhost:3000';
  const FINGERPRINT = 'test-latency-fp';
  const TRANSCRIPT = '明天下午3点开产品评审会';

  log(`\n${c.bold}=== 语音任务添加延迟测试 ===${c.reset}`);
  info(`模拟语音转文字结果: "${TRANSCRIPT}"`);

  const env = loadEnv();

  // 获取用户 & JWT
  step('准备鉴权');
  const userId = await getFirstUserId(env);
  const token = await signToken(env.ACTIVATION_SECRET, FINGERPRINT, userId);
  const authHeaders = {
    'x-activation-token': token,
    'x-device-fingerprint': FINGERPRINT,
  };
  ok(`用户 ID: ${userId.slice(0, 8)}...`);

  // Step 2: 调用 /api/voice-intent（轻量端点）
  step('Step 2 — /api/voice-intent（模型推理 + 工具落库）');
  const t2Start = Date.now();

  const intentRes = await fetch(`${BASE}/api/voice-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ transcript: TRANSCRIPT }),
  });

  const intentData = await intentRes.json();
  const t2Total = Date.now() - t2Start;

  if (!intentRes.ok || !intentData.success) {
    throw new Error(`/api/voice-intent 失败 ${intentRes.status}: ${JSON.stringify(intentData)}`);
  }

  log('');
  log(`  ${c.bold}模型推理 + 工具落库合计:${c.reset}  ${dur(t2Total)}`);
  info(`  创建结果: ${JSON.stringify(intentData.activity)}`);

  // Step 3: 查询 activities 验证落库
  step('Step 3 — 前端刷新 /api/activities');
  const t3Start = Date.now();

  const activitiesRes = await fetch(`${BASE}/api/activities`, {
    headers: authHeaders,
  });
  const t3Total = Date.now() - t3Start;

  if (activitiesRes.ok) {
    const data = await activitiesRes.json();
    const count = data.activities?.length ?? data.length ?? '?';
    ok(`/api/activities 返回 ${count} 条，耗时 ${dur(t3Total)}`);

    // 找最新创建的任务
    const activities = data.activities ?? data ?? [];
    const latest = activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (latest) {
      info(`最新任务: "${latest.title}" (${latest.type}) - ${latest.start_time ?? '无时间'}`);
    }
  } else {
    warn(`/api/activities 返回 ${activitiesRes.status}`);
  }

  // 汇总
  log(`\n${c.bold}=== 延迟汇总 ===${c.reset}`);
  log(`  模型推理+工具落库:   ${dur(t2Total)}`);
  log(`  前端数据刷新:        ${dur(t3Total)}`);
  log(`  ${c.bold}全链路总计:          ${dur(t2Total + t3Total)}${c.reset}`);
}

main().catch(e => {
  console.error(`\n${c.red}错误: ${e.message}${c.reset}`);
  process.exit(1);
});
