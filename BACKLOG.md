# BACKLOG — 全量待办

> 这里记录所有功能、Bug、技术债，按优先级分类。
> 当前正在做的事情在 `TODO.md`，版本规划见 `docs/roadmap.md`。

---

## 🔴 高优先级（影响稳定性/安全）

### B01 — 无速率限制 ✅ 进行中
接入 Upstash 限流，见 TODO.md。

### B02 — 记忆同步破坏性写入 ✅ 已修复 v1.8.38
改为增量追加写入 `memories_chunks`，不再先删后写，原子性问题消失。

### B03 — `@ts-nocheck` 覆盖核心路由 ✅ 已修复 v1.8.48
移除 `@ts-nocheck`，补全 `IncomingMessage`、`UpsertActivityArgs`、`MemoryChunk`、`ToolExecutionResult` 等类型，SDK 复杂 union 类型用 `as unknown as` 精确转换。

---

## 🟡 中优先级（影响体验）

### B04 — IndexedDB 串行读取性能差 ✅ 已修复 v1.8.50
改为 `Promise.all` 并行读取，`deleteAllConversations` 也同步并行化。

### B05 — 本地存储与云端记忆割裂 ✅ 已修复 v1.8.52
新增 `conversations` Supabase 表 + `/api/conversations/sync` 端点。
初始化时双向合并（updatedAt 新的覆盖旧的），saveMessages/delete/clearAll 后台同步，images 不上传云端。

### B06 — 系统提示词拼接无结构 ✅ 已修复 v1.8.49
加入 `MEMORY_BUDGET` 常量和 `truncate()` 函数，core 800 字符、每条 recall/archival chunk 300 字符上限。

### B07 — 代码块语法高亮缺失 ✅ 已修复 v1.8.49
引入 `rehype-highlight` + `highlight.js`，主题 `atom-one-dark`，自定义 `pre`/`code` 组件区分行内与块级代码。

### B08 — 消息编辑/重新生成
**问题**：不支持修改已发送消息或重新生成 AI 回复。

### B09 — 429 前端无友好提示 ✅ 已修复 v1.8.36
已在 useChatStream.ts 拦截 429，显示"请求过于频繁，请稍后再试"。

---

## 🟢 低优先级（锦上添花）

### B10 — 两套 Google AI SDK 并存 ✅ 已修复 v1.8.53
全部迁移至 `@google/genai` v1.42.0，移除旧 `@google/generative-ai`。API 差异：`generateContent`/`embedContent` 通过 `genai.models.*` 调用，streaming 直接迭代 AsyncGenerator，`response.text` 为属性非方法，embeddings 取 `embeddings[0].values`。

### B11 — 旧记忆表残留 ✅ 已修复 v1.8.56
代码层迁移完成：`/api/memories`、`/api/admin/memories` 均已改用 `memories_chunks`，`/api/vectorize` 死路由已删除。
待在 Supabase 执行：`DROP TABLE IF EXISTS memories_tier1; DROP TABLE IF EXISTS user_vectors;`

### B12 — 设备指纹防伪造能力弱
当前指纹在客户端计算，可伪造。安全性实际只依赖 JWT，指纹是虚假的第二因子。

### B13 — 会话导出/导入
无 JSON/Markdown 导出功能。

### B14 — PWA 语音直输（主界面）✅ 已修复 v1.8.87
语音输入已在主聊天界面实现（录音→云端 STT→文字回填输入框），活动卡片/详情页/日历页也均已支持语音备注。

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
- **周报/活动统计** — 基于 activities 表结构化数据（含语音备注 description）一键生成周报或 AI 分析
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
