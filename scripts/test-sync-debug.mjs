/**
 * test-sync-debug.mjs
 * 诊断对话云端同步问题：POST 上传 → GET 查询 → 增量同步
 * 运行：node scripts/test-sync-debug.mjs [username]
 * 默认 username = frank
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SignJWT } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_USER = process.argv[2] || 'frank';
const BASE = 'http://localhost:3000';

// ─── 颜色 ────────────────────────────────────────────────────────────────────
const c = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m' };
const pass  = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const fail  = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const info  = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);
const warn  = (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const head  = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);
const dump  = (obj) => console.log(c.gray + JSON.stringify(obj, null, 2).split('\n').map(l => '  ' + l).join('\n') + c.reset);

// ─── .env.local ───────────────────────────────────────────────────────────────
function loadEnv() {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 1) continue;
        let val = t.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        env[t.slice(0, eq).trim()] = val;
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

// ─── HTTP ─────────────────────────────────────────────────────────────────────
async function api(method, urlPath, body, authHeaders) {
    const res = await fetch(`${BASE}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    return { status: res.status, ok: res.ok, json };
}

// ─── Supabase REST ────────────────────────────────────────────────────────────
async function supabaseQuery(url, serviceKey, table, query = '') {
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.json();
}

// ─── 主测试 ───────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${c.bold}=== 对话云端同步诊断 (user: ${TARGET_USER}) ===${c.reset}\n`);

    const env = loadEnv();
    const secret  = env.ACTIVATION_SECRET;
    const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supaKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret || !supaUrl || !supaKey) {
        fail('缺少环境变量: ACTIVATION_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    // ── 1. 查找用户 ────────────────────────────────────────────────────────────
    head(`1. 查找用户 "${TARGET_USER}"`);
    let userId;
    try {
        const users = await supabaseQuery(supaUrl, supaKey, 'users', `?select=id,username&username=eq.${TARGET_USER}&limit=1`);
        if (!users.length) { fail(`用户 "${TARGET_USER}" 不存在`); process.exit(1); }
        userId = users[0].id;
        pass(`找到用户 id=${userId}`);
    } catch (e) { fail(`查询用户失败: ${e.message}`); process.exit(1); }

    // ── 2. 签发 JWT ────────────────────────────────────────────────────────────
    head('2. 签发测试 JWT');
    const fp = 'test-fingerprint-debug';
    const token = await signToken(secret, fp, userId);
    const authHeaders = { 'x-activation-token': token, 'x-device-fingerprint': fp };
    pass('JWT 签发成功');
    info(`token 前30字符: ${token.substring(0, 30)}...`);

    // ── 3. 全量 GET（无 since）────────────────────────────────────────────────
    head('3. GET 全量拉取（无 since）');
    const getAll = await api('GET', '/api/conversations/sync', null, authHeaders);
    if (!getAll.ok) {
        fail(`GET 失败 ${getAll.status}`);
        dump(getAll.json);
    } else {
        const count = getAll.json.conversations?.length ?? 0;
        pass(`GET 成功，云端现有 ${count} 条对话`);
        info(`serverTime: ${getAll.json.serverTime}`);
        if (count > 0) {
            info(`最新一条: id=${getAll.json.conversations[0].id} title="${getAll.json.conversations[0].title}"`);
        }
    }

    // ── 4. POST 上传一条测试对话 ───────────────────────────────────────────────
    head('4. POST 上传测试对话');
    const testId = `debug-${Date.now()}`;
    const testConv = {
        id: testId,
        title: `[测试] ${new Date().toLocaleString()}`,
        messages: [{ role: 'user', content: '这是同步诊断测试消息' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    const postRes = await api('POST', '/api/conversations/sync', { conversation: testConv }, authHeaders);
    if (!postRes.ok) {
        fail(`POST 失败 ${postRes.status}`);
        dump(postRes.json);
        warn('→ 这就是手机无法上传的根本原因！');
    } else {
        pass(`POST 成功，服务器 updatedAt=${postRes.json.updatedAt}`);
    }

    // ── 5. 直接查 Supabase 验证是否真的写入 ───────────────────────────────────
    head('5. 直接查 Supabase 验证写入');
    try {
        const rows = await supabaseQuery(supaUrl, supaKey, 'conversations',
            `?select=id,title,updated_at,deleted_at&id=eq.${testId}&limit=1`);
        if (rows.length) {
            pass(`DB 中找到记录: title="${rows[0].title}" updated_at=${rows[0].updated_at}`);
            info(`deleted_at=${rows[0].deleted_at ?? 'null（正常）'}`);
        } else {
            fail('DB 中没有这条记录 —— POST 虽返回成功但数据未写入，可能是 upsert 被静默忽略');
        }
    } catch (e) {
        fail(`Supabase 直查失败: ${e.message}`);
        info('可能是 deleted_at 列不存在，请运行迁移 SQL');
    }

    // ── 6. 增量 GET（since = 1分钟前）────────────────────────────────────────
    head('6. GET 增量拉取（since = 1分钟前）');
    const sinceTs = new Date(Date.now() - 60 * 1000).toISOString();
    const getInc = await api('GET', `/api/conversations/sync?since=${encodeURIComponent(sinceTs)}`, null, authHeaders);
    if (!getInc.ok) {
        fail(`增量 GET 失败 ${getInc.status}`);
        dump(getInc.json);
    } else {
        const inc = getInc.json.conversations ?? [];
        pass(`增量 GET 成功，1分钟内变化 ${inc.length} 条`);
        const found = inc.find(c => c.id === testId);
        found ? pass('✓ 刚上传的测试对话在增量结果中') : fail('✗ 增量结果中没有刚上传的对话');
    }

    // ── 7. 清理测试数据 ────────────────────────────────────────────────────────
    head('7. 清理测试数据');
    const delRes = await api('DELETE', '/api/conversations/sync', { id: testId }, authHeaders);
    delRes.ok ? pass('测试对话已删除') : warn(`删除失败 ${delRes.status}: ${JSON.stringify(delRes.json)}`);

    // ── 汇总 ──────────────────────────────────────────────────────────────────
    console.log(`\n${c.bold}=== 诊断完成 ===${c.reset}\n`);
}

main().catch(e => { console.error(c.red + '运行错误: ' + e.message + c.reset); process.exit(1); });
