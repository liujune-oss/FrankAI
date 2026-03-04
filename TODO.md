# TODO — 当前任务

> 只放"现在要做的事"，完成后移入 BACKLOG.md 的已完成区。
> 更多待办见 `BACKLOG.md`，版本规划见 `docs/roadmap.md`。
> 当前版本：v1.8.35

---

## 🔄 进行中

暂无进行中任务。

---

## 📋 下一步（按优先级）

1. **记忆同步改为事务性写入** — 当前先删后写，中途失败会丢数据（见 BACKLOG #B02）
2. **清理根目录临时文件** — `test*.js`、`tmp_*.json`、`debug_*.mjs` 约 30 个文件
3. **移除未使用的依赖** — `ai`、`@ai-sdk/google` 已弃用但仍在 package.json

---

## ✅ 最近完成

- v1.8.36：限流（chat 10次/min、image 5次/min），前端 429 友好提示，memory/sync 不限流
- v1.8.35：隔离确认模型，解决工具调用后历史上下文混乱
- v1.8.34：重写 chat route，原生 Google AI SDK + 自定义 SSE，修复 tool-call 死循环
