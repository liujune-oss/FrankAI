# Gemini Chat — Backlog

> 最后更新：2026-03-04

## 待开发功能

### 🔴 高优先级

- [ ] **PWA 语音直输 (Voice Input)** — 实现聊天界面的实际“按住说话”原型。路线：Web Audio API 记录 Blob -> 后端 Gemini ASR -> 文字上屏 (目前仅在 Sandbox 中完成验证)
- [ ] **意图解析强化 (Two-Hop Reasoning)** — 处理模糊指令（如“取消 3 点的会”），增加静默拉取与防呆追问逻辑

### 🟡 中优先级

- [ ] **钉钉生态接入 (DingTalk Integration)** — 允许 AI 调用钉钉 API 同步待办与会议日程
- [ ] **智能催办系统 (Smart Nudging)** — Cron 任务自动轮询，发现超期风险时 AI 主动弹出警告或建议
- [ ] **代码块语法高亮** — 当前 Markdown 渲染中代码块无语法高亮
- [ ] **消息编辑/重新生成** — 支持编辑已发送消息或重新生成 AI 回复
- [ ] **多模型对比** — 同一问题发送到多个模型，对比回答

### 🟢 低优先级

- [ ] **会话导出/导入** — 支持导出聊天记录为 JSON / Markdown
- [ ] **PWA 推送通知** — 后台任务完成后推送通知
- [ ] **自定义主题色** — 支持手动选择主题风格
- [ ] **manifest.json 优化** — 更新 related_applications 和图标尺寸 (512x512)

## 已处理的技术沉淀与已知 Bug

- [x] **Gemini-3 实验性模型 JSON 格式幻觉 (JSON Structure Hallucination)**
  - **症状**：调用 `upsert_activity` 时，模型没有直接抛出 `title`, `start_time` 等顶层参数，而是自己凭空捏造了一个 `{"activities": [{...}]}` 数组把参数包在了里面，导致后端校验丢失必填项 `title` 报 23502 错误。同时模型无视了工具返回的错误信息，向用户强行邀功“已成功添加”。
  - **解法**：在 `route.ts` 中增强了参数展开逻辑 (`unwrap`)，兼容并自动提取第一层的 `activities[0]` 或 `activity` 对象。
- [x] **Gemini 幻觉生成的未知字段拦截**
  - **症状**：模型有时会捏造不存在的枚举字段（如把 `type` 错认为 `activity_type`），导致 Supabase 报 `PGRST204` schema 错误。
  - **解法**：后端加入硬编码映射 (`activity_type` -> `type`) 并增加 schema 字段过滤白名单。
- [ ] 无速率限制 — API 路由缺少请求频率控制
- [ ] 大量会话时列表性能 — `getAllConversations()` 逐一读取，无分页
- [x] 向量记忆 HNSW 索引 — 已决定维持全表精确扫描以保证 100% 召回率
