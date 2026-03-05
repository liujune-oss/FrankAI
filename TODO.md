# TODO — 当前任务

> 只放"现在要做的事"，完成后移入 BACKLOG.md 的已完成区。
> 更多待办见 `BACKLOG.md`，版本规划见 `docs/roadmap.md`。
> 当前版本：v1.8.45

---

## 🔄 进行中

暂无进行中任务。

---

## 📋 下一步（按优先级）

1. **清理根目录临时文件** — `test*.js`、`tmp_*.json`、`debug_*.mjs` 约 30 个文件
2. **移除未使用的依赖** — `ai`、`@ai-sdk/google` 已弃用但仍在 package.json
3. **移除 `@ts-nocheck`** — chat route 核心逻辑补全类型（见 BACKLOG #B03）

---

## ✅ 最近完成

- v1.8.45：注入当前请求文本到系统提示，防止多日程重复添加 bug
- v1.8.42：Phase 2 三层兜底（stream → response → 硬编码），工具执行后必有回复；新增本地测试脚本
- v1.8.41：修复 anyTextStreamed=true 导致 Phase 2 跳过的无回显 bug
- v1.8.40：调试事件面板仅开发环境显示
- v1.8.39：记忆管理删除按钮常驻显示，红色标识
- v1.8.38：三层记忆架构 v2（Core/Recall/Archival），增量 sync，Beacon API 兜底
- v1.8.37：移除废弃的 ai/@ai-sdk 包，内联 ChatMessage 类型
