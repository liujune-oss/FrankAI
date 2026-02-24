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
│              │  /api/generate-image     │
│              │             — AI 图片生成 │
├──────────────┴──────────────────────────┤
│           Google Gemini API              │
│  @ai-sdk/google — Chat (streamText)      │
│  @google/genai  — Image Gen              │
└─────────────────────────────────────────┘
```

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.6 |
| 前端 | React | 19.2.3 |
| 样式 | Tailwind CSS v4 | ^4 |
| AI SDK | @ai-sdk/google + ai | ^3.0.30 / ^6.0.97 |
| 图片生成 | @google/genai | ^1.42.0 |
| 本地存储 | idb-keyval (IndexedDB) | ^6.2.2 |
| 鉴权 | jose (JWT) | ^6.1.3 |
| Markdown | react-markdown + remark-gfm | ^10 / ^4 |
| 动画 | framer-motion | ^12.34.3 |
| PWA | workbox-build + 自定义 SW | ^7.4.0 |
| 部署 | Vercel | — |

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
- 激活流程：用户输入激活码 → 服务端验证 → 签发 JWT（10 年有效期）
- 每次 API 请求携带 `x-activation-token` + `x-device-fingerprint`
- 设备指纹：UA + 语言 + 屏幕分辨率 + 色深 + 时区 + CPU 核心数 的哈希
- 激活码通过环境变量 `ACTIVATION_CODES` 配置（逗号分隔）

### 4. 会话管理 (`lib/conversations.ts`)
- 存储：IndexedDB（通过 idb-keyval）
- 结构：`{ id, title, messages[], createdAt, updatedAt }`
- 自动标题：取用户首条消息前 30 字符
- 键前缀：`conv-{id}`，活跃会话键：`active-conversation-id`

### 5. 前端 UI (`page.tsx`)
- 单文件组件，约 970 行
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
│   │   ├── page.tsx              # 主页面（聊天 UI）
│   │   ├── layout.tsx            # 根布局（主题、PWA）
│   │   ├── globals.css           # 全局样式 + 深色主题
│   │   └── api/
│   │       ├── chat/route.ts     # 流式聊天 API
│   │       ├── activate/route.ts # 激活码验证 API
│   │       └── generate-image/route.ts  # AI 图片生成 API
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
