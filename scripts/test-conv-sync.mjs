/**
 * test-conv-sync.mjs
 *
 * 集成测试：对话历史云端同步 API（/api/conversations/sync）
 * 依赖：本地 dev server 运行在 localhost:3000 + 有效的 .env.local
 *
 * 运行：node scripts/test-conv-sync.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SignJWT } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 颜色输出 ────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};
const pass = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const fail = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const info = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);
const head = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);

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
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ─── 签 JWT（与 signToken 逻辑一致）────────────────────────────────────────
async function signToken(secret, fingerprint, userId) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ fp: fingerprint, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('3650d')
    .sign(key);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const BASE = 'http://localhost:3000';

async function api(method, path, body, headers) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

// ─── 获取一个真实 user_id（通过 Supabase REST API）────────────────────────────
async function getFirstUserId(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(`缺少环境变量: NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}, SUPABASE_SERVICE_ROLE_KEY=${serviceKey ? '已设置' : '未设置'}`);
  }
  const res = await fetch(
    `${supabaseUrl}/rest/v1/users?select=id&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase 查询失败 ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('DB 中无用户数据');
  return data[0].id;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`${c.bold}${c.cyan}=== 对话历史云端同步 API 集成测试 ===${c.reset}\n`);

  // 1. 加载环境变量
  let env;
  try {
    env = loadEnv();
    pass('读取 .env.local');
  } catch (e) {
    fail(`读取 .env.local 失败: ${e.message}`);
    process.exit(1);
  }

  // 2. 获取真实 user_id
  let userId;
  try {
    userId = await getFirstUserId(env);
    pass(`获取测试用 user_id: ${userId}`);
  } catch (e) {
    fail(`获取 user_id 失败: ${e.message}`);
    process.exit(1);
  }

  // 3. 签发 JWT
  const fingerprint = 'test-fp-123';
  let token;
  try {
    token = await signToken(env.ACTIVATION_SECRET, fingerprint, userId);
    pass('JWT 签发成功');
  } catch (e) {
    fail(`JWT 签发失败: ${e.message}`);
    process.exit(1);
  }

  const authHeaders = {
    'x-activation-token': token,
    'x-device-fingerprint': fingerprint,
  };

  // ── 测试 1：未鉴权请求应返回 401 ────────────────────────────────────────────
  head('Test 1: 未鉴权请求');
  {
    const { status } = await api('GET', '/api/conversations/sync', null, {});
    if (status === 401) pass('GET 无 token → 401');
    else fail(`GET 无 token → 期望 401，实际 ${status}`);
  }

  // ── 测试 2：初始拉取（应为空数组或已有数据）─────────────────────────────────
  head('Test 2: GET 拉取对话列表');
  {
    const { status, json } = await api('GET', '/api/conversations/sync', null, authHeaders);
    if (status === 200 && Array.isArray(json.conversations)) {
      pass(`GET 成功，现有 ${json.conversations.length} 条对话`);
      info(`conversations: ${JSON.stringify(json.conversations.map(c => c.id))}`);
    } else {
      fail(`GET 失败 ${status}: ${JSON.stringify(json)}`);
    }
  }

  // ── 测试 3：POST 写入一条对话 ─────────────────────────────────────────────────
  head('Test 3: POST 写入对话');
  const testConv = {
    id: `test-${Date.now().toString(36)}`,
    title: '测试对话',
    messages: [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: '你好' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '你好！有什么可以帮你？' }] },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  {
    const { status, json } = await api('POST', '/api/conversations/sync', { conversation: testConv }, authHeaders);
    if (status === 200 && json.ok) pass(`POST 写入成功，id=${testConv.id}`);
    else fail(`POST 失败 ${status}: ${JSON.stringify(json)}`);
  }

  // ── 测试 4：再次 GET，验证写入的对话出现在列表中 ────────────────────────────
  head('Test 4: GET 验证写入结果');
  {
    const { status, json } = await api('GET', '/api/conversations/sync', null, authHeaders);
    if (status === 200) {
      const found = json.conversations.find((c) => c.id === testConv.id);
      if (found) {
        pass(`找到刚写入的对话 id=${testConv.id}`);
        info(`title="${found.title}", messages=${found.messages.length} 条`);
      } else {
        fail(`未找到写入的对话 id=${testConv.id}`);
      }
    } else {
      fail(`GET 失败 ${status}: ${JSON.stringify(json)}`);
    }
  }

  // ── 测试 5：POST images 字段不应存入（前端 stripImages 验证）──────────────
  head('Test 5: images 字段不被同步（前端逻辑，此处验证 API 不报错）');
  const convWithImages = {
    id: `test-img-${Date.now().toString(36)}`,
    title: '带图对话',
    messages: [
      {
        id: 'm3', role: 'user',
        parts: [{ type: 'text', text: '看图' }],
        images: [{ data: 'base64==', mimeType: 'image/png' }],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  {
    // 模拟前端 stripImages 行为
    const stripped = {
      ...convWithImages,
      messages: convWithImages.messages.map(({ images: _, ...rest }) => rest),
    };
    const { status, json } = await api('POST', '/api/conversations/sync', { conversation: stripped }, authHeaders);
    if (status === 200 && json.ok) pass('带图对话（已去除 images）写入成功');
    else fail(`写入失败 ${status}: ${JSON.stringify(json)}`);
  }

  // ── 测试 6：DELETE 删除测试对话 ─────────────────────────────────────────────
  head('Test 6: DELETE 删除单条对话');
  {
    const { status, json } = await api('DELETE', '/api/conversations/sync', { id: testConv.id }, authHeaders);
    if (status === 200 && json.ok) pass(`DELETE 成功，id=${testConv.id}`);
    else fail(`DELETE 失败 ${status}: ${JSON.stringify(json)}`);
  }

  // ── 测试 7：DELETE all 清空 ───────────────────────────────────────────────────
  head('Test 7: DELETE all 清空全部测试数据');
  {
    // 先确认 convWithImages 还在
    const { status, json } = await api('DELETE', '/api/conversations/sync', { all: true }, authHeaders);
    if (status === 200 && json.ok) pass('DELETE all 成功');
    else fail(`DELETE all 失败 ${status}: ${JSON.stringify(json)}`);
  }

  // ── 测试 8：清空后 GET 应为空 ─────────────────────────────────────────────────
  head('Test 8: 清空后 GET 验证');
  {
    const { status, json } = await api('GET', '/api/conversations/sync', null, authHeaders);
    if (status === 200 && json.conversations.length === 0) pass('清空后列表为空');
    else if (status === 200) {
      fail(`清空后仍有 ${json.conversations.length} 条对话（可能是正常用户数据，DELETE all 已执行）`);
    } else {
      fail(`GET 失败 ${status}`);
    }
  }

  console.log(`\n${c.bold}测试完成${c.reset}\n`);
}

run().catch((e) => {
  console.error(`${c.red}未捕获异常: ${e.message}${c.reset}`);
  process.exit(1);
});
