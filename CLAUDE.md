# CLAUDE.md — Gemini Chat PWA

每次会话开始时自动加载。遵守以下所有规则，无需用户重复说明。

---

## 启动检查清单

1. 读 `TODO.md` — 了解当前任务
2. 读 `BACKLOG.md` — 了解全量待办和背景
3. 读 `memory/MEMORY.md` — 加载项目知识
4. 确认当前版本：`version.json`

---

## 版本管理

- 版本号**只在 `version.json` 维护**，格式：`{ "major": 1, "minor": 8, "build": 35 }`
- 每次提交前递增 `build` 号
- 提交格式：`fix: 描述, v1.8.36` 或 `feat: 描述, v1.8.36`
- **不要**在 `package.json` 的 `version` 字段维护版本

---

## 技术约定

### AI SDK
- 聊天路由 `/api/chat` 使用**原生 `@google/generative-ai` SDK + 手写 SSE 流**
- **禁止**在聊天路由引入 Vercel AI SDK（`ai` / `@ai-sdk/google`）——已弃用
- 图片生成使用 `@google/genai`（不同包，注意区分）

### 鉴权
- 所有 API 路由必须验证 JWT：`verifyToken(token, fingerprint)`
- 用户鉴权头：`x-activation-token` + `x-device-fingerprint`
- Admin 鉴权：cookie `admin_token`，middleware 保护 `/admin/*` 和 `/api/admin/*`

### 限流
- 使用 `src/lib/ratelimit.ts` 的 `checkRateLimit(uid)`
- Upstash 未配置时自动跳过，不报错
- 新 API 路由默认接入限流

### 数据库
- 使用 `supabaseAdmin`（服务端），不使用客户端 Supabase
- 配置项通过 `getConfig(key)` / `setConfig(key, value)` 读写 `app_config` 表
- **不要**直接修改 `supabase/` 目录下的 SQL 文件后就提交，先确认线上已执行

### 样式
- Tailwind CSS v4，不使用 v3 的配置语法
- UI 语言：**中文（zh-CN）**

---

## 禁止事项

- 不要使用 Vercel AI SDK 处理聊天流
- 不要在根目录创建新的临时测试文件（`test*.js`, `tmp_*.json` 等）
- 不要自动 `git push`，提交前需用户确认
- 不要修改 `.env.local`
- 不要删除 `node_modules` 或 `package-lock.json`

---

## 工作流规范

- 修改完成后先跑 `npm run build` 验证无编译错误，再提交
- 每次会话结束时更新 `TODO.md` 和 `BACKLOG.md`
  - `TODO.md`：只放当前正在做的事（≤10条），完成后移到 BACKLOG 已完成区
  - `BACKLOG.md`：新发现的 Bug/需求/技术债都加在这里，不要堆进 TODO
- 重要架构变更写入 `memory/MEMORY.md`
- 提交时只 stage 相关文件，不用 `git add -A`

---

## 关键文件路径

| 文件 | 用途 |
|------|------|
| `src/app/api/chat/route.ts` | 主聊天 SSE 端点 |
| `src/hooks/useChatStream.ts` | 前端 SSE 消费 |
| `src/hooks/useAuth.ts` | 激活 / JWT / 系统指令 |
| `src/lib/auth.ts` | signToken / verifyToken |
| `src/lib/ratelimit.ts` | Upstash 限流 |
| `src/lib/config.ts` | app_config 读写 |
| `src/lib/conversations.ts` | IndexedDB CRUD |
| `src/middleware.ts` | Admin 路由保护 |
| `version.json` | 版本号 |
| `TODO.md` | 当前任务（≤10条，短期） |
| `BACKLOG.md` | 全量待办、Bug、功能构想 |
