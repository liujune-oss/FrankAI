# Gemini Chat — 发布记录

## v1.5.0 — 2026-02-25
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
