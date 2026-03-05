# BACKLOG — 全量待办

> 这里记录所有功能、Bug、技术债，按优先级分类。
> 当前正在做的事情在 `TODO.md`，版本规划见 `docs/roadmap.md`。

---

## 🔴 高优先级（影响稳定性/安全）

### B01 — 无速率限制 ✅ 进行中
接入 Upstash 限流，见 TODO.md。

### B02 — 记忆同步破坏性写入 ✅ 已修复 v1.8.38
改为增量追加写入 `memories_chunks`，不再先删后写，原子性问题消失。

### B03 — `@ts-nocheck` 覆盖核心路由
**问题**：`/api/chat/route.ts`（400行核心逻辑）完全跳过 TypeScript 类型检查，历史上已多次因此产生参数幻觉 bug。
**方案**：逐步补全类型，移除 `@ts-nocheck`。

---

## 🟡 中优先级（影响体验）

### B04 — IndexedDB 串行读取性能差
**问题**：`getAllConversations()` 串行逐条读取，会话多时启动慢。
**方案**：分离 metadata（标题、时间）和消息体，列表只加载 metadata。

### B05 — 本地存储与云端记忆割裂
**问题**：换设备后本地对话历史丢失，但 RAG 记忆还在，产生不一致体验。
**方案**：评估是否将对话历史也同步到 Supabase（需权衡隐私与存储成本）。

### B06 — 系统提示词拼接无结构
**问题**：时间上下文、工具规则、用户指令、RAG 记忆四段字符串拼接，无长度保护，RAG 内容过长可能超出模型上下文限制。
**方案**：提取 `buildSystemPrompt()` 函数，加 token 预算截断。

### B07 — 代码块语法高亮缺失
**问题**：react-markdown 渲染代码块无颜色高亮。
**方案**：引入 `rehype-highlight` 或 `shiki`。

### B08 — 消息编辑/重新生成
**问题**：不支持修改已发送消息或重新生成 AI 回复。

### B09 — 429 前端无友好提示 ✅ 已修复 v1.8.36
已在 useChatStream.ts 拦截 429，显示"请求过于频繁，请稍后再试"。

---

## 🟢 低优先级（锦上添花）

### B10 — 两套 Google AI SDK 并存
`@google/generative-ai`（对话）和 `@google/genai`（图片）功能重叠，维护两套初始化。长期考虑统一到新版 `@google/genai`。

### B11 — 旧记忆表残留
`memories_tier1` 和 `user_vectors` 旧表仍在 Supabase，已被 `memories_chunks` 替代，可清理。

### B12 — 设备指纹防伪造能力弱
当前指纹在客户端计算，可伪造。安全性实际只依赖 JWT，指纹是虚假的第二因子。

### B13 — 会话导出/导入
无 JSON/Markdown 导出功能。

### B14 — PWA 语音直输（主界面）
语音原型已在 Admin Sandbox 验证，但主界面尚未实现完整链路（Web Audio API → 后端 ASR → 文字上屏）。

### B15 — 移除废弃依赖 ✅ 已修复 v1.8.37
`ai` 和 `@ai-sdk/google` 已从 package.json 移除。

### B16 — manifest.json 优化
缺少 512x512 图标和 `related_applications` 字段。

---

## 💡 功能构想（未评估）

> 来自 `drafts/ai_assistant_discussion.md`，尚未进入正式规划。

- **钉钉生态接入** — AI 同步钉钉待办与会议，双写本地DB + 钉钉 Open API
- **智能催办系统** — Cron 任务轮询超期风险，主动弹出警告
- **Two-Hop Reasoning** — 模糊指令解析（"取消3点的会"）+ 防呆追问
- **多模型对比** — 同一问题并排发给多个模型
- **周报自动生成** — 基于 activities 表结构化数据一键生成周报
- **PWA 推送通知** — 后台任务完成后推送

---

## ✅ 已完成（归档）

| 版本 | 内容 |
|------|------|
| v1.8.42 | Phase 2 三层兜底（stream→response→硬编码），工具执行后必有回复；新增本地测试脚本 |
| v1.8.41 | 修复 anyTextStreamed=true 导致 Phase 2 跳过的无回显 bug |
| v1.8.40 | 调试事件面板仅开发环境显示 |
| v1.8.39 | 记忆管理删除按钮常驻显示，红色标识 |
| v1.8.38 | 三层记忆架构 v2（Core/Recall/Archival），增量 sync，Beacon API 兜底，解决 B02 |
| v1.8.37 | 移除废弃 ai/@ai-sdk 包，内联 ChatMessage 类型，解决 B15 |
| v1.8.36 | 限流（chat 10次/min、image 5次/min），前端 429 提示，解决 B01/B09 |
| v1.8.35 | 隔离确认模型，修复工具调用后历史上下文混乱 |
| v1.8.34 | 重写 chat route，原生 Google AI SDK + 自定义 SSE，修复 tool-call 死循环 |
| v1.8.33 | SSE text-start 解析器 + system prompt 工具确认 |
| v1.8.32 | 修复 chat stream maxSteps 无响应 |
| v1.8.26 | 修复工具参数幻觉 key 导致 Supabase insert 崩溃 |
| v1.8.22 | 强制刷新按钮清除 PWA 缓存 |
