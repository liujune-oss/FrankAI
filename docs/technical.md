# Gemini Chat — 技术实现

> 最后更新：2026-03-04（与 v1.8.35 代码同步）

## 架构概览

```
┌──────────────────────────────────────────────────────┐
│                  客户端 (Next.js CSR)                 │
│  page.tsx — 组合层（~285 行）                         │
│  hooks/useAuth.ts        — 激活 / JWT / 系统指令同步  │
│  hooks/useConversations.ts — IndexedDB 会话管理       │
│  hooks/useChatStream.ts  — SSE 消费 / 图片生成 / 记忆 │
│  lib/conversations.ts    — IndexedDB CRUD             │
├──────────────────────┬───────────────────────────────┤
│                      │  API Routes (Server)          │
│                      ├───────────────────────────────┤
│                      │  /api/chat          — 聊天流  │
│                      │  /api/generate-image — 图片   │
│                      │  /api/activate      — 激活    │
│                      │  /api/memory/sync   — 记忆同步│
│                      │  /api/memories      — 记忆管理│
│                      │  /api/activities    — 活动    │
│                      │  /api/config        — 配置    │
│                      │  /api/speech-to-text — STT   │
│                      │  /api/sync/system-instruction │
│                      │  /api/admin/*       — 管理后台│
├──────────────────────┴───────────────────────────────┤
│                    后端服务生态圈                      │
│  Google Generative AI API  — 对话 / 摘要 / 嵌入      │
│  Google GenAI API          — 图片生成                 │
│  Supabase (PostgreSQL)     — 数据库 / pgvector        │
└──────────────────────────────────────────────────────┘
```

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.6 |
| 前端 | React | 19.2.4 |
| 样式 | Tailwind CSS v4 | ^4 |
| AI（对话/摘要/嵌入） | @google/generative-ai | ^0.24.1 |
| AI（图片生成） | @google/genai | ^1.42.0 |
| 数据库 | Supabase / PostgreSQL + pgvector | ^2.97.0 |
| 鉴权 | jose (JWT) | ^6.1.3 |
| 本地存储 | idb-keyval (IndexedDB) | ^6.2.2 |
| Markdown | react-markdown + remark-gfm | ^10 / ^4 |
| 动画 | framer-motion | ^12 |
| PWA | @serwist/next + @serwist/sw | ^9.5.6 |

> ⚠️ **注意**：`ai` (Vercel AI SDK v6) 和 `@ai-sdk/google` 虽仍在 package.json 中，但
> `/api/chat` 路由**不再使用**这两个库。聊天流完全基于 `@google/generative-ai` 原生 SDK
> 和手写 SSE 实现。

## 核心模块

### 1. 聊天流 (`/api/chat/route.ts`)

**技术选型**：原生 `@google/generative-ai` SDK + 自定义 SSE 流（非 Vercel AI SDK）。

**完整流程**：

```
POST /api/chat?model=gemini-xxx
  → verifyToken(x-activation-token, x-device-fingerprint)
  → RAG 检索（见第 4 节）
  → 拼接系统提示词（时间上下文 + 工具规则 + 用户自定义 + RAG 记忆）
  → genAI.getGenerativeModel({ model, systemInstruction, tools: [upsert_activity] })
  → model.startChat({ history }).sendMessageStream(lastParts)
  → Tool Call 循环（最多 5 步）：
      - stream 文字 → SSE {type:"text-delta"}
      - functionCall → 执行 executeUpsertActivity() → SSE {type:"tool-result"}
      - 有工具被执行 → 新建隔离 confirmModel（无历史）生成确认文字
  → SSE {type:"finish"} + "data: [DONE]"
```

**内置工具（Function Calling）**：
- `upsert_activity` — 创建/更新 activities 表中的任务、日程、提醒

**不再内置的工具**（已从 chat 路由移除）：
- ~~`google_search`~~（grounding 联网搜索已移除）
- ~~`generate_image`~~（图片生成改为前端触发，见第 2 节）

**关键设计决策**：
- **隔离确认模型（v1.8.35）**：工具执行完成后，用一个全新的、无对话历史的模型来生成确认文字，彻底防止模型混淆历史上下文，避免"上一轮已经做了"的幻觉。
- `maxDuration = 120`（秒）适配 Pro 模型的思考时间。
- `@ts-nocheck` 目前加在文件顶部，待后续补充类型。

**SSE 事件格式**（自定义，非 Vercel AI SDK 格式）：

```
{ type: "start" }
{ type: "start-step" }
{ type: "text-start", id: "0" }
{ type: "text-delta", id: "0", delta: "..." }
{ type: "text-end", id: "0" }
{ type: "tool-call", toolCallId, toolName, args }
{ type: "tool-result", toolCallId, toolName, result }
{ type: "finish-step", finishReason: "stop" | "tool-calls" }
{ type: "finish", finishReason: "stop" }
{ type: "reasoning", delta, text }    // 思考模型专用
{ errorText: "..." }                  // 错误
data: [DONE]                          // 流结束标志
```

---

### 2. 图片生成 (`/api/generate-image/route.ts`)

- 使用 `@google/genai`（`GoogleGenAI`）调用，与聊天使用的库不同。
- 模型从 `app_config` 读取（默认 `gemini-2.5-flash-image`）。
- **触发方式**：前端 `useChatStream` 在 SSE 流结束后检测 `generate_image` 工具调用信号，再单独发起 POST 请求。
- **图片编辑意图判断**：
  - 优先检查 tool 返回的 `action: 'edit'` 字段。
  - 降级兜底：检测 prompt 中是否含修改类关键词（edit/change/modify/修改/换成/加上/去掉/把）。
- **编辑底图来源**：有上传图 → 用上传图；无上传图 + 编辑意图 → 回溯全历史消息找最近有图片的消息。
- **历史处理**：纯文生图时携带文字历史；图片编辑时**不带**历史（避免 inlineData 引发模型错误）。
- **前端 Fallback**：若模型没有正确调用工具，而是直接输出伪 JSON（如 `[generate_image: {...}]`），前端用正则提取 `prompt` 字段兜底执行。

---

### 3. 激活鉴权

**`/api/activate`** + **`src/lib/auth.ts`**

激活流程：
```
用户输入 4 字母激活码
  → POST /api/activate { code, fingerprint }
  → 查 activation_codes（验证 is_active、user.is_active）
  → 检查 user_devices（判断是否新设备、是否超出 max_uses、是否被封禁）
  → signToken(fingerprint, user_id) → JWT HS256，有效期 10 年
  → 客户端存 localStorage: activation-token, device-fingerprint
```

设备指纹算法（客户端计算，`useAuth.ts`）：
```
hash(userAgent | language | WxH | colorDepth | timezone | cpuCores)
```

每次 API 请求携带：
```
x-activation-token: <jwt>
x-device-fingerprint: <hash>
```

**Admin 鉴权**（独立体系）：
- `POST /api/admin/auth { password }` → 设置 HttpOnly Cookie `admin_token`（JWT，role:'admin'）
- `src/middleware.ts` 在 Edge Runtime 拦截 `/admin/*` 和 `/api/admin/*`
- 公开豁免路由：`/api/admin/auth`、`/api/admin/voice-test`、`/api/admin/voice-prompt`、`/api/admin/voice-extract`

---

### 4. 2 层记忆 RAG 系统

#### 写入（`/api/memory/sync`）

触发条件（`useChatStream.ts` 中）：
- **阈值触发**：未同步消息 ≥ 20 条
- **空闲触发**：聊天结束后 1 分钟无新消息

写入流程：
```
POST /api/memory/sync { session_id, messages }
  → 清除该 session 的旧 memories_tier1 和 chat_messages
  → 批量写入 chat_messages（保存原始对话）
  → gemini-flash 模型生成对话摘要（summary_text）
  → gemini-embedding-001 对摘要向量化（生成高维向量）
  → 写入 memories_tier1 { summary_text, embedding, start_message_id, end_message_id }
```

#### 读取（`/api/chat` 中自动触发）

```
embed(最新用户消息)
  → supabaseAdmin.rpc('match_tier1_memories', {
      query_embedding, match_threshold: 0.5, match_count: 3, p_user_id
    })
  → 对每条匹配：查 chat_messages 获取 start_message_id ~ end_message_id 之间的原始对话
  → 拼装为 XML 注入系统提示词顶部
```

注入格式：
```xml
<retrieved_memories>
  <memory_chunk session_id="..." timestamp="...">
    <!-- Summary: 摘要文本 -->
    [User]: ...
    [Assistant]: ...
  </memory_chunk>
</retrieved_memories>
```

**索引策略**：pgvector HNSW 索引最高支持 2000 维，`gemini-embedding-001` 输出维度超限，故采用**全表精确扫描（Exact KNN）**，个人数据量下毫秒级完成且召回率 100%。

---

### 5. 活动系统（`activities` 表 + `upsert_activity` 工具）

AI 在对话中通过 `upsert_activity` Function Calling 直接写库，支持：
- `type`: task / event / reminder / log
- 时间自动推算（AI 根据当前 UTC 时间 + 上海 UTC+8 换算）
- 字段白名单过滤，防止幻觉字段写入

后端容错（`executeUpsertActivity`）：
- 自动展开 `{activities: [{...}]}` 或 `{activity: {...}}` 嵌套（Gemini-3 幻觉兼容）
- 枚举字段别名映射（`activity_type` → `type`，`summary` → `title`）
- 有 `start_time` 无 `end_time` 的 event 自动补 +1 小时

视图：`/calendar`（日历视图）、`/tasks`（任务列表）均从 `/api/activities` 读取。

---

### 6. 会话管理（`lib/conversations.ts`）

- 存储：IndexedDB via idb-keyval
- Key 格式：`conv-{id}`，活跃会话：`active-conversation-id`
- 结构：`{ id, title, messages[], createdAt, updatedAt }`
- 自动标题：取首条用户消息前 30 字符
- 操作：`getAllConversations`、`saveConversation`、`deleteConversation`、`deleteAllConversations`

---

### 7. 配置系统（`lib/config.ts` + `app_config` 表）

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `chat_models` | Gemini 2.0~3.1 列表 | 前端模型选择器数据 |
| `default_chat_model` | gemini-3-flash-preview | 默认选中模型 |
| `memory_summary_model` | gemini-3-flash-preview | 记忆摘要用模型 |
| `memory_embedding_model` | gemini-embedding-001 | 向量嵌入模型 |
| `image_gen_model` | gemini-2.5-flash-image | 图片生成模型 |
| `voice_intent_prompt` | 中文 STT 提示词 | 语音结构化提取 Prompt |

`getConfig<T>(key)` 先查数据库，DB 不可用时回退到代码内硬编码默认值，不报错。

---

### 8. 语音 Sandbox（`/admin` → Sandbox 面板）

两阶段链路：
1. **Phase 1 (STT)**：`/api/speech-to-text` 用 Gemini 转录语音为文字
2. **Phase 2 (结构化提取)**：`/api/admin/voice-extract` 调用 voice_intent_prompt + Function Calling 提取结构化实体

Admin 界面可动态修改 Phase 2 Prompt，存入 `app_config`，无需重新部署。

---

### 9. 主题与 PWA（`layout.tsx`）

- 主题：`prefers-color-scheme` 检测，切换 `<html>` 上的 `dark` 类
- themeColor meta 标签双主题（light: #ffffff，dark: #030712）
- Service Worker：开发模式自动注销，生产模式注册 `/sw.js`
- SW 由 `build-sw.js` + `@serwist/next` 构建

---

## 数据库表结构

```sql
users                   id, username, is_active, created_at
activation_codes        id, code(4字母), user_id, max_uses, usage_count, is_active
user_devices            id, user_id, activation_code_id, device_fingerprint, is_active, last_active_at
system_instructions     user_id(PK), content, updated_at
chat_messages           id, user_id, session_id, role, content, created_at
memories_tier1          id, user_id, session_id, summary_text, embedding(vector),
                        start_message_id, end_message_id
activities              id, user_id, type, title, description, start_time, end_time,
                        is_all_day, priority, location, status, repetition_rule, tags, metadata
app_config              key(PK), value(JSON string), updated_at
user_vectors            id, user_id, content, embedding(vector 3072), metadata  [旧表，保留]
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API Key（对话/摘要/嵌入/图片均用此 key）|
| `ACTIVATION_SECRET` | JWT 签名密钥（用户 token + admin token 共用）|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端 Key（仅服务端，不暴露给浏览器）|
| `ADMIN_PASSWORD` | Admin 后台登录密码 |

---

## 目录结构

```
gemini-chat-pwa/
├── src/
│   ├── app/
│   │   ├── page.tsx                       # 主聊天页（组合层，~285 行）
│   │   ├── layout.tsx                     # 根布局（主题切换、PWA 注册）
│   │   ├── globals.css                    # 全局样式 + CSS 变量
│   │   ├── calendar/page.tsx              # 日历视图
│   │   ├── tasks/page.tsx                 # 任务列表视图
│   │   ├── admin/
│   │   │   ├── page.tsx                   # 管理后台（用户/模型/记忆/日志）
│   │   │   └── login/page.tsx             # Admin 登录页
│   │   └── api/
│   │       ├── chat/
│   │       │   ├── route.ts               # 聊天 SSE 流（原生 Google SDK）
│   │       │   └── logger.ts              # 服务端 appendLog 工具
│   │       ├── generate-image/route.ts    # 图片生成/编辑
│   │       ├── activate/route.ts          # 激活码验证 + JWT 签发
│   │       ├── memory/sync/route.ts       # 记忆写入（摘要+向量化）
│   │       ├── memories/route.ts          # 用户记忆 CRUD
│   │       ├── activities/route.ts        # 活动 CRUD
│   │       ├── config/route.ts            # 前端配置读取
│   │       ├── speech-to-text/route.ts    # STT
│   │       ├── vectorize/route.ts         # 手动向量化（旧接口）
│   │       ├── sync/system-instruction/   # 系统指令云同步
│   │       └── admin/                     # 管理后台 API
│   │           ├── auth/route.ts          # Admin 登录
│   │           ├── check/route.ts         # Admin 状态检查
│   │           ├── users/route.ts         # 用户管理
│   │           ├── users/code/route.ts    # 激活码管理
│   │           ├── users/device/route.ts  # 设备管理
│   │           ├── models/route.ts        # 可用模型列表
│   │           ├── config/route.ts        # app_config CRUD
│   │           ├── memories/route.ts      # 全局记忆查看
│   │           ├── chat_logs/route.ts     # 聊天日志
│   │           ├── voice-test/route.ts    # 语音测试
│   │           ├── voice-prompt/route.ts  # Prompt 管理
│   │           └── voice-extract/route.ts # 结构化提取
│   ├── components/
│   │   ├── ActivationGate.tsx             # 激活码输入界面
│   │   ├── ChatHeader.tsx                 # 顶栏（标题+加载状态）
│   │   ├── ConversationDrawer.tsx         # 侧栏（会话列表+系统指令+管理入口）
│   │   ├── MessageList.tsx                # 消息列表（Markdown/图片/思考过程）
│   │   ├── InputBar.tsx                   # 输入框（模型选择+图片上传）
│   │   ├── MemoryManager.tsx              # 记忆管理弹窗
│   │   └── SandboxModal.tsx              # Admin 沙盒弹窗
│   ├── hooks/
│   │   ├── useAuth.ts                     # 激活/JWT/设备指纹/系统指令同步
│   │   ├── useConversations.ts            # 会话管理（IndexedDB）
│   │   ├── useChatStream.ts               # SSE 消费/图片生成/记忆自动同步
│   │   ├── useActivities.ts               # 活动 CRUD
│   │   └── useMemories.ts                 # 记忆 CRUD
│   ├── types/
│   │   └── chat.ts                        # ChatMessage 类型（扩展 UIMessage）
│   └── lib/
│       ├── auth.ts                        # signToken / verifyToken / verifyAdminToken
│       ├── config.ts                      # getConfig / setConfig / getAllConfigs
│       ├── conversations.ts               # IndexedDB CRUD（idb-keyval）
│       ├── supabase.ts                    # supabaseAdmin 客户端（服务端专用）
│       └── utils.ts                       # cn()（clsx + tailwind-merge）
├── middleware.ts                          # Edge 中间件（Admin 路由保护）
├── public/
│   ├── manifest.json                      # PWA 清单
│   ├── sw.js                              # Service Worker（构建生成）
│   └── icon-192.png / icon-512.png
├── build-sw.js                            # SW 构建脚本（Serwist）
├── version.json                           # 版本号 { major, minor, build }
└── package.json
```
