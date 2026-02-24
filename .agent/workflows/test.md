---
description: 测试验证 Gemini Chat PWA 的每个重要节点
---

## 测试工作流

当用户调用 `/test` 时，按以下步骤逐一验证项目的关键功能节点。

项目目录：`f:\FrankAI\gemini-chat-pwa`

### 测试节点

| # | 节点 | 验证方式 |
|---|------|----------|
| 1 | 构建 | `npm run build` 无错误 |
| 2 | 激活 API | POST `/api/activate` 返回 token |
| 3 | 鉴权拒绝 | 无 token 调用 `/api/chat` 返回 401 |
| 4 | 聊天 API | 带 token 调用 `/api/chat` 返回流式响应 |

| 6 | 页面加载 | 浏览器打开首页，激活页面正常渲染 |
| 7 | PWA 清单 | `manifest.json` 可访问且字段正确 |

### Steps

1. **构建验证**
   ```powershell
   cd f:\FrankAI\gemini-chat-pwa; npm run build
   ```
   - ✅ 判定：退出码为 0，无 `Error` 输出
   - ❌ 失败：记录错误信息

2. **启动开发服务器**
   ```powershell
   cd f:\FrankAI\gemini-chat-pwa; npm run dev
   ```
   - 等待服务器启动（看到 `Ready` 或 `Local:` 输出）
   - 记录本地 URL（通常 `http://localhost:3000`）

3. **激活 API 测试**
   - 用浏览器工具或 curl 发送 POST 请求：
   ```powershell
   $body = '{"code":"gemini999","fingerprint":"test-fp-123"}'
   Invoke-RestMethod -Uri "http://localhost:3000/api/activate" -Method POST -ContentType "application/json" -Body $body
   ```
   - ✅ 判定：返回 JSON 包含 `token` 字段
   - ❌ 失败：返回错误或非 200 状态码
   - 保存返回的 token 供后续测试使用

4. **鉴权拒绝测试**
   ```powershell
   $body = '{"messages":[{"role":"user","content":"hi"}]}'
   try { Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method POST -ContentType "application/json" -Body $body } catch { $_.Exception.Response.StatusCode }
   ```
   - ✅ 判定：返回 401 Unauthorized
   - ❌ 失败：返回其他状态码（说明鉴权被绕过）

5. **聊天 API 测试**
   - 使用步骤 3 获得的 token，通过浏览器打开 `http://localhost:3000`
   - 输入激活码激活
   - 发送一条简单消息如 "你好"
   - ✅ 判定：收到 AI 流式回复，无错误
   - ❌ 失败：返回 401/500 或无响应



7. **PWA 清单验证**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/manifest.json"
   ```
   - ✅ 判定：返回 JSON，包含 `name`、`icons`、`display: standalone`
   - ❌ 失败：404 或字段缺失

8. **页面加载验证**
   - 用浏览器打开 `http://localhost:3000`
   - ✅ 判定：页面正常渲染，显示激活码输入界面或聊天界面
   - ❌ 失败：白屏或 JS 报错

9. **关闭开发服务器**
   - 终止步骤 2 启动的 dev server

10. **输出测试报告**
    汇总所有测试节点的通过/失败状态，格式：
    ```
    ✅ 构建验证 — 通过
    ✅ 激活 API — 通过 (token: eyJ...)
    ✅ 鉴权拒绝 — 通过 (401)
    ✅ 聊天 API — 通过
    ❌ 图片生成 — 失败 (超时)
    ✅ PWA 清单 — 通过
    ✅ 页面加载 — 通过
    ```