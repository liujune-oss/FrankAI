# 记忆架构 v2 设计方案

> 参考：Letta/MemGPT 分层思路 + Mem0 混合存储思路
> 目标栈：Next.js + Supabase (pgvector) + Google Gemini
> 状态：设计阶段，未实施

---

## 一、现状问题

| 问题 | 描述 |
|---|---|
| 先删后写 | sync 时全量删除再插入，中途失败丢失历史记忆 |
| 粒度太粗 | 整个 session = 一个向量，长对话多话题召回率低 |
| RAG 冗余 | 用摘要做向量检索，检索后却回查原始消息展示，两次 IO |
| 全量同步 | 每次 sync 发送整个 session 所有消息，随会话增长负载增大 |
| 触发不可靠 | 同步在客户端触发，关闭页面则永久丢失 |
| 无冷热区分 | 最近对话和半年前对话地位相同，都做向量搜索 |

---

## 二、设计目标

1. **可靠性**：写入原子化，不再出现数据丢失
2. **精准召回**：细粒度分块，相关话题能被准确检索
3. **低延迟**：减少每次 chat 的 DB 查询次数
4. **低 Token 消耗**：注入精简的摘要，而非原始对话
5. **渐进增强**：改造可分步骤上线，不影响现有功能

---

## 三、三层架构设计

参考 MemGPT 的分层思路，结合项目实际情况设计如下三层：

```
┌────────────────────────────────────────────────────┐
│  System Prompt (每次 chat 都注入)                   │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  Layer 1: Core Memory（核心记忆，热层）        │  │
│  │  用户固定偏好、关键事实，~200 token，常驻      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  Layer 2: Recall Memory（近期记忆，温层）      │  │
│  │  最近 5 次会话摘要，按时间倒序直接取，~500 token│  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  Layer 3: Archival Memory（历史记忆，冷层）    │  │
│  │  向量相似度检索，top 3，~300 token，按需注入   │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Layer 1 — Core Memory（核心记忆）

**是什么：** 关于用户的长期稳定事实，类似 Letta 的 `core_memory`。

**内容示例：**
```
用户叫 Frank，住上海，习惯用中文沟通。
职业：产品经理，对 AI 和技术感兴趣。
偏好：回复简洁，不喜欢过多 Markdown 格式。
重要事件：2025年10月换了新工作。
```

**特点：**
- 纯文本，~200 token，每次 chat 都完整注入
- AI 在对话中发现新事实时可通过工具更新
- 存储在独立表 `user_core_memory`，只有一行（per user）

**触发更新：** 每次 memory sync 后，由后台异步调用 LLM 判断是否有新事实需要更新 core memory。

---

### Layer 2 — Recall Memory（近期记忆）

**是什么：** 最近 N 次会话的摘要，不做向量搜索，按时间直接取。

**逻辑：**
- 取最近 5 条 `memories_chunks`（不含当前 session）
- 按 `created_at` DESC 排序直接查询，无需 embedding
- 注入格式：简洁的时间线摘要

**特点：**
- 零 embedding 延迟（只是简单的 `LIMIT 5` 查询）
- 覆盖最近约 2-7 天的上下文（取决于用户活跃度）
- 如果近期摘要已经包含相关内容，冷层可以跳过

---

### Layer 3 — Archival Memory（历史记忆）

**是什么：** 温层时间窗口之外的所有历史摘要，通过向量相似度按需检索。

**逻辑：**
- 对用户当前消息做 embedding
- 在 `memories_chunks` 中搜索 `created_at < 温层截止时间` 的记录
- 相似度阈值 0.6，top 3
- 找到则注入，找不到则跳过（不报错）

**特点：**
- 只在有历史记忆时才增加延迟（新用户完全跳过）
- 精细分块后向量更准确，召回率提升

---

## 四、数据模型变更

### 新增表：`user_core_memory`

```sql
CREATE TABLE user_core_memory (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 新增表：`memories_chunks`（替代现有 `memories_tier1`）

```sql
CREATE TABLE memories_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  chunk_index     INT NOT NULL DEFAULT 0,   -- 同一 session 内的第几块
  summary_text    TEXT NOT NULL,
  embedding       VECTOR(3072),             -- gemini-embedding-001 维度
  message_count   INT NOT NULL DEFAULT 0,   -- 本块包含几条消息
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON memories_chunks (user_id, created_at DESC);
CREATE INDEX ON memories_chunks USING ivfflat (embedding vector_cosine_ops);
```

**与现有 `memories_tier1` 的区别：**
- 去掉 `start_message_id` / `end_message_id`（不再依赖 `chat_messages`）
- 新增 `chunk_index`（支持同一 session 多块）
- 新增 `message_count`（记录块大小）

### `chat_messages` 表

- **不废弃**，保留用于管理后台查看聊天日志
- **从 RAG 流程中完全移除**，不再在 chat 路由中回查
- 可设置定期清理策略（如保留 90 天）

### pgvector RPC 函数

```sql
-- 冷层向量搜索（排除近期 N 条）
CREATE OR REPLACE FUNCTION match_archival_memories(
  query_embedding VECTOR(3072),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID,
  exclude_ids     UUID[]   -- 温层已取的 chunk id，避免重复
)
RETURNS TABLE (id UUID, session_id TEXT, summary_text TEXT, similarity FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT id, session_id, summary_text,
         1 - (embedding <=> query_embedding) AS similarity
  FROM memories_chunks
  WHERE user_id = p_user_id
    AND id != ALL(exclude_ids)
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

---

## 五、同步流程重设计

### 现有流程（问题）
```
客户端 → 发送全量 session 消息
服务端 → DELETE tier1 WHERE session_id
       → DELETE chat_messages WHERE session_id
       → INSERT chat_messages（全量）
       → LLM 生成摘要
       → embed 摘要
       → INSERT tier1
```

### 新流程（分块追加）
```
客户端 → 发送本次新增消息（增量，非全量）
         携带：session_id, chunk_index, messages[]

服务端 → INSERT chat_messages（仅新增消息，用于日志）
       → LLM 生成本块摘要
       → embed 摘要
       → INSERT memories_chunks（追加，不删除旧块）
       → 异步：检查是否需要更新 core memory
```

**关键改变：**
- 客户端只发送"上次同步位置之后"的新消息（增量）
- 服务端只追加，不删除，原子性问题消失
- `chunk_index` 由客户端递增维护，服务端直接信任

### 触发时机调整

| 场景 | 现在 | 新方案 |
|---|---|---|
| 积累 20 条消息 | 全量 sync | 增量 sync 当前块 |
| 空闲 1 分钟 | 全量 sync | 增量 sync 剩余消息 |
| 关闭页面 | 丢失 | `visibilitychange` 触发 sync（beacon API） |
| session 切换 | 不触发 | 自动 sync 上一个 session 的剩余消息 |

---

## 六、RAG 注入流程重设计

### 现有流程
```
1. embed 用户消息（1次 API 调用）
2. 向量搜索 tier1（top 3）
3. 对每个结果：查 start/end 消息时间戳（2次 DB）
4. 查时间范围内原始消息（1次 DB）
5. 组装 XML 注入 system prompt
```

### 新流程
```
1. 并行执行：
   a. embed 用户消息（用于冷层，1次 API 调用）
   b. 查 user_core_memory（1次 DB）
   c. 查最近 5 条 memories_chunks（1次 DB）

2. 用 embedding 搜索冷层（排除温层的 chunk ids）

3. 组装注入（全部摘要文本，不再回查原始消息）
```

**DB 查询次数：** 现有 ~6次 → 新方案 ~3次（并行）
**API 调用次数：** 不变（1次 embedding）

### 注入格式

```xml
<memory>
  <core>
    用户叫 Frank，住上海，职业产品经理，偏好简洁回复...
  </core>
  <recent>
    [2026-03-01] 讨论了新产品 PRD 的结构，用户希望聚焦用户故事。
    [2026-02-28] 规划了3月的工作目标，包括完成 AI 助手记忆改造。
    ...
  </recent>
  <relevant>
    [2025-11-15] 用户曾详细讨论过记忆架构设计，提到希望冷热分层...
  </relevant>
</memory>
```

---

## 七、Core Memory 更新机制

每次 sync 成功后，后台异步运行一个轻量 LLM 调用：

**Prompt：**
```
已知用户核心记忆：
{current_core_memory}

本次新对话摘要：
{new_chunk_summary}

判断：本次对话是否包含应该长期记住的新事实？
- 若有：返回更新后的完整核心记忆（保持简洁，不超过300字）
- 若无：返回 "NO_UPDATE"
```

**注意：**
- 使用最小/最快的模型（如 `gemini-2.0-flash`）节省成本
- 纯异步，不阻塞 chat 响应
- 失败静默处理，不影响主流程

---

## 八、Token 预算

| 层级 | 内容 | 预计 Token |
|---|---|---|
| Core Memory | 用户固定事实 | ~150 |
| Recall Memory | 最近 5 条摘要 | ~400 |
| Archival Memory | top 3 历史摘要 | ~300 |
| **合计注入** | | **~850 token** |

对比现在（注入原始消息）：原始消息通常 2000-5000 token，**节省约 70%**。

---

## 九、实施步骤

分 4 个 PR，可独立上线：

### Step 1：数据库变更
- 创建 `user_core_memory` 表
- 创建 `memories_chunks` 表
- 创建 `match_archival_memories` RPC 函数
- 迁移现有 `memories_tier1` 数据到 `memories_chunks`

### Step 2：改造 sync 端点
- `/api/memory/sync` 改为增量追加逻辑
- 客户端 `useChatStream.ts` 改为只发增量消息
- 新增 `visibilitychange` + Beacon API 兜底触发

### Step 3：改造 RAG 注入
- `/api/chat/route.ts` 中的 RAG 逻辑替换为三层查询
- 去掉 `chat_messages` 回查
- 新注入格式测试验证

### Step 4：Core Memory 自动更新
- 新增 `/api/memory/update-core` 端点
- sync 成功后异步触发
- 管理后台增加查看/编辑 core memory 的界面

---

## 十、风险与注意事项

| 风险 | 缓解措施 |
|---|---|
| 现有 `memories_tier1` 数据迁移失败 | Step 1 先双写，验证后再切换 |
| Core memory 被 LLM 错误覆写 | 保留历史版本（加 `version` 字段或单独日志表） |
| 温层/冷层边界不合理 | 温层条数（5）可通过 `app_config` 配置，灰度调整 |
| Embedding 维度变更 | 当前用 gemini-embedding-001（3072维），切换模型前需重新 embed 全量数据 |
| 增量 sync 客户端状态丢失 | `lastSummarizedCount` 已存在，只需持久化到 IndexedDB 即可 |

---

*文档版本：2026-03-05*
*作者：设计讨论产出*
