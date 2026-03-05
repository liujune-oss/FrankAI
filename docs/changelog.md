# Gemini Chat — 发布记录

## v1.8.52 — 2026-03-05
- **功能：对话历史云端同步，多设备无缝恢复（B05）**
  - 新增 Supabase `conversations` 表，存储 id/title/messages(JSONB)/created\_at/updated\_at
  - 新增 `/api/conversations/sync` 端点（GET 拉取 / POST upsert / DELETE 单条或全部）
  - `useConversations` 两阶段启动：Phase 1 立即显示本地 IndexedDB 数据，Phase 2 后台与云端双向合并
  - 合并策略：`updatedAt` 较新的版本优先（last-write-wins）；本地独有 → 推送云端，云端较新 → 写入 IndexedDB
  - `saveMessages`、`handleDeleteConversation`、`handleClearAll` 均后台同步云端，不阻塞 UI
  - `images` 字段（base64）不同步云端，节省存储
  - 新增集成测试 `scripts/test-conv-sync.mjs`（8 个场景全部通过）

## v1.8.51 — 2026-03-05
- **优化：少于 3 轮对话不写入长期记忆**
  - 消息数 < 6 条（3 轮）的浅层会话跳过 memory sync，避免噪音写入

## v1.8.50 — 2026-03-05
- **性能：IndexedDB 并行读取，优化启动速度（B04）**
  - `getAllConversations` 改为 `Promise.all` 并行读取，`deleteAllConversations` 同步并行化

## v1.8.49 — 2026-03-05
- **功能：代码块语法高亮 + RAG Token 预算截断（B06 B07）**
  - 引入 `rehype-highlight` + `highlight.js`，主题 `atom-one-dark`
  - 加入 `MEMORY_BUDGET` 常量和 `truncate()`，core 上限 800 字符、每条 recall/archival 上限 300 字符

## v1.8.48 — 2026-03-05
- **修复：移除 `@ts-nocheck`，补全 chat route 核心类型（B03）**

## v1.8.42 — 2026-03-05
- **修复：工具执行后必有回复（三层兜底）**
  - Phase 2 确认模型增加三层保障：① 流式输出；② `confirmResult.response` fallback；③ 硬编码"xxx 已创建成功"
  - 彻底消除工具执行成功但用户无任何回显的问题
  - 新增 `scripts/test-chat-flow.mjs`，7 个本地测试场景覆盖所有边缘情况，无需网络即可运行

## v1.8.41 — 2026-03-05
- **修复：anyTextStreamed=true 导致 Phase 2 跳过**
  - 模型在调用工具前若先输出文字，`anyTextStreamed` 被置为 true，Phase 2 的 `!anyTextStreamed` 条件触发跳过，步骤 2 文字又因 `anyToolsExecuted=true` 被丢弃，最终无回显
  - 移除 `!anyTextStreamed` 条件，工具执行后始终触发 Phase 2

## v1.8.40 — 2026-03-05
- **修复：调试事件面板不应在生产环境显示**
  - 实时流事件面板（SSE debug panel）改为 `process.env.NODE_ENV === 'development'` 条件渲染
  - 生产环境用户不再看到 `▶️ [新步骤开始]` 等技术日志

## v1.8.39 — 2026-03-05
- **优化：记忆管理 UI 删除按钮可见性**
  - 移除 `opacity-0 group-hover:opacity-100`，删除/编辑按钮始终可见
  - 删除按钮颜色从灰色改为 `text-red-400`，移动端可直接点击

## v1.8.38 — 2026-03-05
- **重构：三层记忆架构 v2（参考 Letta/MemGPT 设计思路）**
  - 新增 `user_core_memory` 表：用户长期事实，每次 sync 后异步 LLM 更新，常驻注入
  - 新增 `memories_chunks` 表：替代 `memories_tier1`，支持分块追加（chunk_index），不再先删后写
  - RAG 改为三层并行查询（热/温/冷），去掉原始消息回查，Token 消耗降低约 70%
  - 同步阈值从 20 条降为 10 条，新增 `visibilitychange` + Beacon API 兜底防丢失
  - 新增 `supabase/memory_v2_migration.sql` 迁移脚本
  - 新增 `docs/memory-architecture-v2.md` 设计文档
  - 解决 BACKLOG #B02（记忆同步破坏性写入）

## v1.8.37 — 2026-03-05
- **清理：移除废弃 AI SDK 依赖**
  - 从 `package.json` 移除 `ai`（Vercel AI SDK）和 `@ai-sdk/google`
  - 内联 `ChatMessage` 类型，不再依赖 SDK 类型导出
  - 解决 BACKLOG #B15

## v1.8.36 — 2026-03-04
- **新增：API 请求限流**
  - 聊天接口 10 次/分钟，图片生成 5 次/分钟（基于 Upstash Redis）
  - `/api/memory/sync` 不限流
  - Upstash 未配置时自动跳过，不影响本地开发
  - 前端 429 响应显示友好中文提示
  - 解决 BACKLOG #B01、#B09

## v1.8.35 — 2026-03-04
- **修复：工具调用后历史上下文混乱**
  - Phase 2 确认使用全新隔离模型（无对话历史），彻底防止模型引用历史轮次

## v1.8.34 — 2026-03-04
- **重构：重写 chat route**
  - 弃用 Vercel AI SDK，改用原生 `@google/generative-ai` SDK + 手写 SSE 流
  - 修复工具调用死循环问题

## v1.8.27 — 2026-03-02
- **修复：AI 驱动任务的空白回复问题**
  - 在升级到 Vercel AI SDK v6 后，原有的 `maxSteps: 5` 参数被弃用，导致含有工具调用的多轮对话（特别是 `gemini-3-flash-preview`）在工具执行后提前中断，产生空白回复。
  - **解决方案**：重构了后端的 `streamText` 调用，将 `maxSteps` 替换为 `stopWhen: stepCountIs(5)`，成功闭环了多轮调用，使模型能够生成并返回带上下文的友好文本。

## v1.8.20 — 2026-03-03
- **新增：Sandbox 语音结构化验证室**
  - 在 Admin 控制台新增了专属测试环境，针对移动端的复杂语音环境设计了双阶段（Two-phase）抽取链路。将传统的杂乱口语录音通过 STT 转化为文本后，再由 `gemini-1.5-pro` 的 Function Calling 按设定 Schema 抽取为结构化 JSON。
  - 支持 Sandbox 前端动态加载并持存在本地 LocalStorage，以及后续融合数据库 Config，实现无需重新部署即调参。
- **新增/修复：AI 驱动的结构化日程流 (Unified Activities)**
  - 建立并整合了统一的 `activities` 数据表（包含 task, event, reminder 类别）。
  - **核心链路攻坚**：彻底修复了 Vercel AI SDK 中当工具调用（`toolChoice: 'required'`）遇到不支持 Function Calling 的实验模型时产生的死循环栈溢出异常，在底层增加了 `forcedToolChoice` 模型降级保护（退回至 `gemini-2.5-pro`）。
  - **后端无感执行**：解构了新版 AI SDK 中需配置 `maxSteps: 5` 才能触发后端自动 `execute` 回调的底层逻辑，实现了自然语言对话与数据库的丝滑异步持久化，并终结了 Tasks 界面读取数据的无限轮询。

## v1.8.4 — 2026-02-26
- **核心升级：3072维高阶记忆数据库完全支持**
  - **原生吞吐与 100% 召回**：彻底粉碎了此前 pgvector 的 2000 维 HNSW 索引限制。选择拥抱全表精准计算 (Exact Nearest Neighbor Search) 以取代近似搜索，在保证任何细微记忆片段零截断/切片、完全 3072 维持原下，实现了毫秒级检索 100% 的准确命召回率。
  - **SQL 类型隔离加固**：修复 RPC (`match_tier1_memories`) 查询比对过程中的隐性类型降级异常 (`text` vs `uuid`)，确保用户记忆读取的绝对安全与精准。
- **修复：Admin 后台聚合崩溃**
  - **跨表聚合重写**：在解除原始底座表外键强制约束（以容忍空口会话及深研）后，手工利用内存映射与关联重写了 `/api/admin/chat_logs` 和 `/api/admin/memories` 获取算法，完美解决了因为断开 Supabase 约束导致的 PostgREST 关联错误，一举修复了 Admin 控制台的白屏与 500 宕机。

## v1.8.1 — 2026-02-26
- **修复与优化：图片生成与连续编辑能力**
  - **意图穿透 (Bypass Refusal)**：在系统级 Prompt 中实施了强制指令，成功绕过大模型对“修改真实照片”时的过度安全拒绝（Pixel-level edit refusal），强制唤起绘图工具进行二次艺术创作。
  - **Tool Call 鲁棒性升级**：针对部分模型（如 gemini-3-flash-preview）无法标准调用工具而选择输出拟态 JSON（例如 `[generate_image: {...}]`）的行为，重写了前端拦截器的正则提取逻辑，确保任意带壳的伪调用均能被正确截获并执行。
  - **编辑基准图逻辑修复**：修复了“用户主动上传实拍图片并要求修改”时，因历史记录仅回溯 assistant 角色而导致找不到底图的 Bug，现已支持全历史记录追溯。

## v1.8.0 — 2026-02-25
- **新增：专属记忆数据管理与更新 UI**
  - **用户端**：主界面新增侧栏记忆管理抽屉，以弹窗形式列出所有检索记忆，支持预览、重写编辑（将自动唤起向量重新演算）以及单条删除、全部清空。
  - **管理端**：全新加入后台 `记忆池管理` Tab。后台采用按用户群组自动折叠卡片的方式呈现全局记忆网络视图。支持对特定用户的彻底清空与任意单条删除。
  - **接口强化**：扩充并补全与 Supabase pgvector 相关的向量覆写与 CRUD 端点，增设 Admin 严苛校验令牌的授权访问。


## v1.7.1 — 2026-02-25
- **优化：记忆抽取 (RAG) 交互体验**
  - 使用更优雅的浮动 Toast 提示替换原先会阻塞界面的 `alert()`
  - 抽取长效记忆时，侧边栏按钮转换为禁用并在原位置展示加载动画
  - 支持记录独立会话的状态，多会话状态不互串

## v1.7.0 — 2026-02-25
- **新增：AI 驱动的图片生成意图检测（Function Calling）**
  - 聊天模型通过 `generate_image` 工具自主判断用户是否需要生成/编辑图片
  - 替代旧的关键词匹配方案，准确度大幅提升
  - 支持文本 fallback 检测（兼容模型以 JSON 文本输出工具调用的情况）
- **新增：图片点击放大 & 下载**
  - 聊天中的图片支持点击全屏 Lightbox 预览
  - Lightbox 内提供下载按钮，支持 ESC / 点击背景关闭
- **优化：图片编辑流程**
  - 支持用户上传图片后发送编辑指令（如「把地面修改一下」）
  - 连续编辑时自动携带上次生成的图片作为编辑基准
  - 图片编辑 prompt 自动添加「基于原图修改」指令，避免重新生成
  - 修复 `thought_signature` 错误：历史图片不再以 model 角色发送
- **优化：Admin 后台**
  - 新增 Tab 导航（用户管理 / 模型管理）
  - 模型配置改用下拉选择器替代文本输入
- **优化：性能**
  - assistant 消息中的大体积 base64 图片不再发送给 chat API，用文字占位替代

## v1.6.0 — 2026-02-25
- **新增：模型与配置管理**
  - Admin 后台新增 Model Configuration 面板
  - 支持从 Gemini API 一键获取所有可用模型列表
  - 可管理聊天可用模型、默认模型、记忆摘要模型、向量嵌入模型、图片生成模型
  - 配置集中存储在 Supabase `app_config` 表，支持自动初始化
  - 前端聊天模型列表和默认模型从配置动态加载
  - 后端 API（chat、vectorize、generate-image）从配置读取模型名称
  - 提供 `supabase/init_app_config.sql` 初始化脚本

## v1.5.1 — 2026-02-25
- **新增：长效记忆 (RAG) 系统**
  - 集成 Supabase + pgvector，支持对话历史向量化存储与相似度检索
  - 自动提取对话摘要并建立记忆索引，提升 AI 长期上下文理解能力
- **新增：Supabase 后端集成**
  - 支持多设备访问授权、激活码校验
  - 云端同步系统指令（System Instructions）
- **新增：管理后台 (/admin)**
  - 支持激活码生成、用户状态管理及设备权限控制
- **优化与修复**
  - 升级模型：采用 `gemini-3-flash-preview` 进行摘要提取，`gemini-embedding-001` 进行向量嵌入
  - 解决 pgvector 3072 维向量索引限制问题（采用精确搜索）
  - 修复 Vercel AI SDK 消息载荷解析异常导致的记忆提取失败
  - 完善 API 日志记录与调试机制


## v1.4.0 — 2026-02-24
- 重构：将 page.tsx（~990行）拆分为 5 个独立组件和 3 个自定义 Hooks
  - 组件：ActivationGate、ChatHeader、ConversationDrawer、MessageList、InputBar
  - Hooks：useAuth、useConversations、useChatStream
  - 主页面缩减至 ~100 行组合层
- 新增 `src/types/chat.ts` 共享类型定义
- 功能无变化，纯结构优化

## v1.3.3 — 2026-02-24
- 主题色跟随系统深色/浅色模式切换
- themeColor meta 标签适配双主题

## v1.3.2 — 2026-02-24
- 改进图片生成请求的关键词检测逻辑
- 支持更多中英文绘图关键词匹配

## v1.3.1 — 2026-02-24
- 图片生成功能优化

## v1.3.0 — 2026-02-23
- 新增 AI 图片生成功能（Gemini 2.5 Flash Image）
- 智能识别绘图意图，支持连续对话编辑图片
- 支持用户上传图片发送

## v1.2.1 — 2026-02-23
- PWA 安装优化

## v1.1.2 — 2026-02-22
- Bug 修复和稳定性改进

## v1.1.1 — 2026-02-22
- 性能优化

## v1.1.0 — 2026-02-22
- 新增 Google Search 工具（grounding 联网搜索）
- 系统指令自定义功能
- 会话管理侧栏抽屉
- Thinking 思考过程可视化

## v1.0.1 — 2026-02-21
- 初始版本修复

## v1.0.0 — 2026-02-21
- 首次发布
- 基于 Gemini 的流式聊天
- 激活码鉴权系统
- PWA 支持（可安装、离线缓存）
- 多会话管理（IndexedDB 存储）
- Markdown 渲染
- 响应式 UI，移动端优先设计
