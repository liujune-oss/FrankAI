# TODO — 当前任务

> 只放"现在要做的事"，完成后移入 BACKLOG.md 的已完成区。
> 更多待办见 `BACKLOG.md`，版本规划见 `docs/roadmap.md`。
> 当前版本：v1.8.56

---

## 🔄 进行中

暂无进行中任务。

---

## 📋 下一步（按优先级）

1. **B08** — 消息编辑/重新生成

---

## ✅ 最近完成

- v1.8.56：清理旧记忆表 memories_tier1/user_vectors，迁移至 memories_chunks，删除死路由 /api/vectorize（B11）
- v1.8.55：语音按钮适配 iOS safe-area，修复底部超出问题
- v1.8.54：核心流程端到端测试脚本（10/10 通过），新增测试用户
- v1.8.53：统一 Google AI SDK，移除旧 @google/generative-ai，全部迁移至 @google/genai（B10）
- v1.8.52：对话历史云端同步（B05），换设备自动拉取历史（images 字段不同步）
- v1.8.51：少于 3 轮（6 条消息）的对话不写入长期记忆，过滤浅层会话
- v1.8.50：IndexedDB 并行读取，优化启动速度（B04 解决）
- v1.8.49：代码块语法高亮 rehype-highlight + RAG token 预算截断（B06 B07 解决）
- v1.8.48：移除 @ts-nocheck，补全 chat route 核心类型（B03 解决）
- v1.8.47：清理根目录和 scripts/ 临时调试文件
- v1.8.46：工具执行后立即 break 循环，彻底消除重复添加日程（根因修复）
- v1.8.42：Phase 2 三层兜底（stream → response → 硬编码），工具执行后必有回复；新增本地测试脚本
- v1.8.41：修复 anyTextStreamed=true 导致 Phase 2 跳过的无回显 bug
- v1.8.40：调试事件面板仅开发环境显示
- v1.8.39：记忆管理删除按钮常驻显示，红色标识
- v1.8.38：三层记忆架构 v2（Core/Recall/Archival），增量 sync，Beacon API 兜底
- v1.8.37：移除废弃的 ai/@ai-sdk 包，内联 ChatMessage 类型
