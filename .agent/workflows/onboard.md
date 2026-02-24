---
description: 模型初次加载时快速了解项目全貌，进入工作状态
---

## 项目上下文加载工作流

当用户调用 `/onboard` 时，按以下步骤快速了解项目整体情况。

### Steps

1. 使用 `view_file` 工具（不是终端命令）**并行**阅读以下文件：
   - `f:\FrankAI\gemini-chat-pwa\docs\product.md` — 产品定位和功能
   - `f:\FrankAI\gemini-chat-pwa\docs\technical.md` — 技术栈和代码结构
   - `f:\FrankAI\gemini-chat-pwa\docs\backlog.md` — 当前正在解决的问题和待办
   - `f:\FrankAI\gemini-chat-pwa\docs\changelog.md` — 最近版本变更
   - `f:\FrankAI\gemini-chat-pwa\version.json` — 当前版本号

2. 使用 `list_dir` 工具浏览源码结构：
   - `f:\FrankAI\gemini-chat-pwa\src`

3. 重点关注 `docs/backlog.md` 中 **🔥 正在解决** 区块，理解当前工作上下文

4. 向用户汇报（简洁）：
   - 当前版本号
   - 项目核心功能（一句话）
   - 🔥 当前正在解决的问题
   - 最高优先级的待办
   - 询问用户接下来想做什么
