---
description: 整理和更新项目文档（产品介绍、技术实现、Backlog、发布记录）
---

## 文档整理工作流

当用户调用 `/docs` 时，按照以下步骤整理项目文档。

文档目录：`f:\FrankAI\gemini-chat-pwa\docs\`

### 文档清单

| 文件 | 说明 |
|------|------|
| `docs/product.md` | 产品介绍：功能概述、使用场景、截图说明 |
| `docs/technical.md` | 技术实现：架构设计、技术栈、核心模块、API 说明 |
| `docs/backlog.md` | Backlog：待开发功能、已知问题、优先级 |
| `docs/changelog.md` | 发布记录：每个版本的变更内容 |

### Steps

1. 阅读 `f:\FrankAI\gemini-chat-pwa\version.json` 获取当前版本号

2. 阅读项目源码，了解当前功能和实现细节：
   - `src/app/page.tsx` — 主页面和聊天逻辑
   - `src/app/layout.tsx` — 布局、主题、PWA 配置
   - `src/app/api/` — 后端 API 路由
   - `src/lib/` — 工具模块（会话管理、鉴权等）
   - `package.json` — 依赖和脚本
   - `public/manifest.json` — PWA 清单

3. 逐一更新以下文档（如果文件不存在则创建）：

   **3.1 产品介绍 (`docs/product.md`)**
   - 产品定位和核心价值
   - 功能列表与使用方式
   - 如有任何 UI 变更，更新相关描述

   **3.2 技术实现 (`docs/technical.md`)**
   - 整体架构（前端、后端、存储）
   - 核心技术栈及版本
   - 关键模块说明（聊天流、图片生成、鉴权、PWA 等）
   - API 路由一览
   - **务必阅读新引入的特性代码（尤其是数据库相关的 SQL 变更），并将其精准补充到相关架构模块说明中。**

   **3.3 Backlog (`docs/backlog.md`)**
   - 根据代码中的 TODO/FIXME 和已知问题更新
   - 根据用户反馈补充新需求
   - 标记优先级：🔴 高 / 🟡 中 / 🟢 低

   **3.4 发布记录 (`docs/changelog.md`)**
   - 读取 git log 获取自上次文档更新以来的提交记录：
   ```powershell
   cd f:\FrankAI\gemini-chat-pwa; git log --oneline -20
   ```
   - 将新版本变更追加到文件顶部，格式为：
   ```
   ## vX.Y.Z — YYYY-MM-DD
   - 变更点 1
   - 变更点 2
   ```

4. 完成后向用户汇报更新了哪些文档及关键变更
