# Gemini Chat — 技术实现

## 架构概览

```
┌─────────────────────────────────────────┐
│           客户端 (Next.js CSR)           │
│  page.tsx — 单页聊天 UI                  │
│  conversations.ts — IndexedDB 会话管理    │
│  auth headers — JWT + 设备指纹           │
├──────────────┬──────────────────────────┤
│              │  API Routes (Server)     │
│              ├──────────────────────────┤
│              │  /api/chat     — 流式聊天 │
│              │  /api/activate — 激活鉴权 │
│              │  /api/vectorize— 记忆提取 │
│              │  /api/admin    — 管理后台 │
├──────────────┴──────────────────────────┤
│             后端服务生态圈               │
│  Google Gemini API    — 推理 / 向量化     │
│  Supabase (Postgres)  — Auth / Pgvector │
└─────────────────────────────────────────┘
```

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.6 |
| 数据库 | Supabase / PostgreSQL | ^2.48.1 |
| 前端 | React | 19.2.3 |
| 样式 | Tailwind CSS v4 | ^4 |
| AI SDK | @ai-sdk/google + ai | ^3.0.30 / ^6.0.97 |
| 鉴权 | jose (JWT) / Edge API | ^6.1.3 |
| 本地存储 | idb-keyval (IndexedDB) | ^6.2.2 |
| Markdown | react-markdown + remark-gfm | ^10 / ^4 |
| PWA | workbox-build + 自定义 SW | ^7.4.0 |

## 核心模块

### 1. 聊天流 (`/api/chat`)
- 使用 AI SDK 的 `streamText()` 进行流式响应
- 支持 `systemInstruction` 自定义系统提示
- 内置 Google Search 工具（grounding）
- Thinking 配置：`thinkingBudget: 1024`
- 模型通过 URL query 参数动态指定
- 最大响应时间 120 秒

### 2. 图片生成 (`/api/generate-image`)
- 使用 `@google/genai` 直接调用 Gemini API
- 模型：`gemini-2.5-flash-image`
- 支持多轮对话历史上下文（含图片）
- 响应格式：`{ parts: [{ type, text?, data?, mimeType? }] }`

### 3. 激活鉴权 (`/api/activate` + `lib/auth.ts`)
- 激活流程：用户输入激活码 → 服务端到 Supabase `activation_codes` 验证 → 将指纹存入 `user_devices` → 签发带 `uid` 的 JWT（10 年有效期）
- 每次 API 请求携带 `x-activation-token` + `x-device-fingerprint`
- 设备指纹：UA + 语言 + 屏幕分辨率 + 色深 + 时区 + CPU 核心数 的哈希
- 管理员可通过 `/admin` 控制台直接签发 4 字母邀请码并管理设备

### 4. 持续记忆 RAG (`/api/vectorize` + `/api/chat`)
- RAG 双向流传：`/api/vectorize` 用 `gemini-3-flash-preview` 提取总结事实，用 `gemini-embedding-001` 转为 3072 维向量
- 储存机制：写入 Supabase `user_vectors`
- 检索分级：鉴于 3072 维超限不支持 HNSW 索引，降级使用 KNN 暴力距离扫描匹配 (Cosine Threshold: 0.4)
- 提取融合：用户提问时，`/api/chat` 先查 RAG 后并入 System prompt

### 5. 会话管理 (`lib/conversations.ts`)
- 存储：IndexedDB（通过 idb-keyval）
- 结构：`{ id, title, messages[], createdAt, updatedAt }`
- 自动标题：取用户首条消息前 30 字符
- 键前缀：`conv-{id}`，活跃会话键：`active-conversation-id`

### 5. 前端 UI (`page.tsx` + 组件)
- 主页面约 100 行，作为组合层调用独立组件和 Hooks
- 激活门：未激活时显示激活码输入界面
- 侧栏抽屉：会话列表 + 系统指令编辑 + 清空按钮
- 消息气泡：用户靠右，AI 靠左；AI 消息支持 Markdown 渲染
- 图片显示：用户上传图片和 AI 生成图片内联显示
- 智能滚动：自动滚底，用户上滑时暂停自动滚动
- 思考动画：三点脉冲 + 思考文字实时更新

### 6. 主题与 PWA (`layout.tsx`)
- 跟随系统：`prefers-color-scheme` 检测并切换 `dark` 类
- themeColor 根据系统主题切换
- Service Worker：`build-sw.js` 构建，`sw.js` 注册
- manifest.json：standalone 模式，192/512 图标

## 环境变量

| 变量 | 说明 |
|------|------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API Key |
| `ACTIVATION_CODES` | 激活码列表（逗号分隔） |
| `ACTIVATION_SECRET` | JWT 签名密钥 |

## 目录结构

```
gemini-chat-pwa/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 主页面（组合层，~100行）
│   │   ├── layout.tsx            # 根布局（主题、PWA）
│   │   ├── globals.css           # 全局样式 + 深色主题
│   │   └── api/
│   │       ├── chat/route.ts     # 流式聊天 API
│   │       ├── activate/route.ts # 激活码验证 API
│   │       └── generate-image/route.ts  # AI 图片生成 API
│   ├── components/
│   │   ├── ActivationGate.tsx    # 激活码输入界面
│   │   ├── ChatHeader.tsx        # 顶栏（菜单+标题+状态）
│   │   ├── ConversationDrawer.tsx # 会话列表抽屉
│   │   ├── MessageList.tsx       # 消息列表+滚动+Markdown
│   │   └── InputBar.tsx          # 输入框+工具栏+模型选择
│   ├── hooks/
│   │   ├── useAuth.ts            # 激活鉴权 Hook
│   │   ├── useConversations.ts   # 会话管理 Hook
│   │   └── useChatStream.ts      # 聊天流+图片生成 Hook
│   ├── types/
│   │   └── chat.ts               # 共享类型定义
│   └── lib/
│       ├── auth.ts               # JWT 鉴权工具
│       ├── conversations.ts      # IndexedDB 会话管理
│       └── utils.ts              # 通用工具（cn）
├── public/
│   ├── manifest.json             # PWA 清单
│   ├── sw.js                     # Service Worker（构建生成）
│   ├── icon-192.png / icon-512.png
│   └── ...
├── build-sw.js                   # SW 构建脚本
├── version.json                  # 版本号
└── package.json
```
