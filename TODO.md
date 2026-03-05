# TODO — 当前任务

> 只放"现在要做的事"，完成后移入 BACKLOG.md 的已完成区。
> 更多待办见 `BACKLOG.md`，版本规划见 `docs/roadmap.md`。
> 当前版本：v1.8.37

---

## 🔄 进行中

### 记忆架构 v2 改造（见 `docs/memory-architecture-v2.md`）

- [x] **Step 1：数据库变更** — SQL 见 `supabase/memory_v2_migration.sql`（需在 Supabase 执行）
- [x] **Step 2：改造 sync 端点** — 增量追加 + chunkIndex + Beacon API 兜底
- [x] **Step 3：改造 RAG 注入** — 三层并行查询，去掉原始消息回查
- [x] **Step 4：Core Memory 自动更新** — sync 后异步 LLM 更新用户画像
- [ ] **在 Supabase 执行迁移 SQL** — `supabase/memory_v2_migration.sql`（需用户手动执行）

---

## 📋 下一步（按优先级）

1. **清理根目录临时文件** — `test*.js`、`tmp_*.json`、`debug_*.mjs` 约 30 个文件
2. **移除未使用的依赖** — `ai`、`@ai-sdk/google` 已弃用但仍在 package.json

---

## ✅ 最近完成

- v1.8.38：三层记忆架构 v2（Core/Recall/Archival），增量 sync，Beacon API 兜底
- v1.8.37：移除废弃的 ai/@ai-sdk 包，内联 ChatMessage 类型
- v1.8.36：限流（chat 10次/min、image 5次/min），前端 429 友好提示，memory/sync 不限流
- v1.8.35：隔离确认模型，解决工具调用后历史上下文混乱
- v1.8.34：重写 chat route，原生 Google AI SDK + 自定义 SSE，修复 tool-call 死循环
