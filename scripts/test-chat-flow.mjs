/**
 * test-chat-flow.mjs
 *
 * 完整复刻 /api/chat/route.ts 的工具调用循环逻辑（不依赖 Next.js、不发网络请求）。
 * 使用 mock Gemini SDK，测试各种场景下 SSE 事件是否正确输出文字回复。
 *
 * 运行：node scripts/test-chat-flow.mjs
 */

// ─── 颜色输出 ───────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};
const pass = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const fail = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const info = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);
const head = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);

// ─── 核心循环（与 route.ts 完全一致）────────────────────────────────────────
async function runChatLoop({ chat, confirmModelFactory, lastParts, toolExecutor }) {
  const events = [];
  function send(data) { events.push(data); }

  let currentParts = lastParts;
  const MAX_STEPS = 5;
  const allExecutedResults = [];
  let anyToolsExecuted = false;
  let anyTextStreamed = false;
  const originalUserText = lastParts.filter(p => p.text).map(p => p.text).join('\n');

  send({ type: 'start' });

  for (let step = 0; step < MAX_STEPS; step++) {
    send({ type: 'start-step' });

    const result = await chat.sendMessageStream(currentParts);
    let toolCalls = [];
    let hasText = false;

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          if (!anyToolsExecuted) {
            if (!hasText) { send({ type: 'text-start', id: '0' }); hasText = true; }
            send({ type: 'text-delta', id: '0', delta: part.text });
            anyTextStreamed = true;
          }
        } else if (part.functionCall) {
          const fc = part.functionCall;
          send({ type: 'tool-call', toolCallId: fc.name + '_' + step, toolName: fc.name, args: fc.args });
          toolCalls.push(fc);
        }
      }
    }

    if (!anyToolsExecuted && !hasText && toolCalls.length === 0) {
      try {
        const finalResp = await result.response;
        const finalText = (finalResp.candidates?.[0]?.content?.parts || [])
          .filter(p => p.text).map(p => p.text).join('');
        if (finalText) {
          send({ type: 'text-start', id: '0' }); hasText = true;
          send({ type: 'text-delta', id: '0', delta: finalText });
          anyTextStreamed = true;
        }
      } catch (e) { /* ignore */ }
    }

    if (hasText) send({ type: 'text-end', id: '0' });

    if (toolCalls.length === 0) {
      send({ type: 'finish-step', finishReason: 'stop' });
      break;
    }

    send({ type: 'finish-step', finishReason: 'tool-calls' });

    const funcResponseParts = [];
    for (const toolCall of toolCalls) {
      const toolResult = toolExecutor
        ? toolExecutor(toolCall)
        : JSON.stringify({ status: 'success', title: toolCall.args?.title });
      send({ type: 'tool-result', toolCallId: toolCall.name + '_' + step, toolName: toolCall.name, result: toolResult });
      allExecutedResults.push({ toolName: toolCall.name, args: toolCall.args, result: toolResult });
      let parsedResult = null;
      try { parsedResult = JSON.parse(toolResult); } catch { }
      funcResponseParts.push({
        functionResponse: { name: toolCall.name, response: parsedResult || { result: toolResult } }
      });
    }

    anyToolsExecuted = true;
    currentParts = funcResponseParts;
  }

  // Phase 2: Isolated confirmation
  if (anyToolsExecuted) {
    send({ type: 'start-step' });

    const resultSummary = allExecutedResults.map(r => {
      try {
        const p = JSON.parse(r.result);
        const timeStr = p.start_time ? ` at ${p.start_time}` : '';
        return `- Created ${p.type}: "${p.title}"${timeStr}`;
      } catch { return `- ${r.toolName} executed`; }
    }).join('\n');

    const confirmPrompt = `User request: "${originalUserText}"\n\nWhat was just done:\n${resultSummary}\n\nWrite a brief, friendly confirmation to the user (1-3 sentences max).`;
    const confirmResult = await confirmModelFactory(confirmPrompt);

    let confirmHasText = false;

    // 流式读取
    for await (const chunk of confirmResult.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          if (!confirmHasText) { send({ type: 'text-start', id: '0' }); confirmHasText = true; }
          send({ type: 'text-delta', id: '0', delta: part.text });
        }
      }
    }

    // 兜底1：流为空时尝试 result.response
    if (!confirmHasText) {
      try {
        const finalResp = await confirmResult.response;
        const fallbackText = (finalResp?.candidates?.[0]?.content?.parts || [])
          .filter(p => p.text).map(p => p.text).join('');
        if (fallbackText) {
          send({ type: 'text-start', id: '0' });
          send({ type: 'text-delta', id: '0', delta: fallbackText });
          confirmHasText = true;
        }
      } catch (e) { /* ignore */ }
    }

    // 兜底2：两层都空时发硬编码确认
    if (!confirmHasText) {
      const fallback = allExecutedResults.map(r => {
        try { const p = JSON.parse(r.result); return `"${p.title}" 已创建成功。`; }
        catch { return '操作已完成。'; }
      }).join(' ');
      send({ type: 'text-start', id: '0' });
      send({ type: 'text-delta', id: '0', delta: fallback });
      confirmHasText = true;
    }

    if (confirmHasText) send({ type: 'text-end', id: '0' });
    send({ type: 'finish-step', finishReason: 'stop' });
  }

  send({ type: 'finish', finishReason: 'stop' });
  return events;
}

// ─── Mock 工具 ──────────────────────────────────────────────────────────────
function makeStream(chunks, responseText = '') {
  return {
    stream: (async function* () {
      for (const parts of chunks) {
        yield { candidates: [{ content: { parts: Array.isArray(parts) ? parts : [parts] } }] };
      }
    })(),
    response: Promise.resolve({
      candidates: responseText ? [{ content: { parts: [{ text: responseText }] } }] : []
    }),
  };
}

function makeEmptyStream(responseText = '') {
  // 流为空，但 response 可能有内容（测试 fallback）
  return {
    stream: (async function* () { /* 空 */ })(),
    response: Promise.resolve({
      candidates: responseText ? [{ content: { parts: [{ text: responseText }] } }] : []
    }),
  };
}

function makeGarbledStream() {
  // Gemini 真实返回的边缘情况：candidates 结构异常
  return {
    stream: (async function* () {
      yield {};                                           // 无 candidates
      yield { candidates: [] };                           // candidates 空
      yield { candidates: [{}] };                         // 无 content
      yield { candidates: [{ content: {} }] };            // 无 parts
      yield { candidates: [{ content: { parts: [] } }] }; // parts 空
      yield { candidates: [{ content: { parts: [{}] } }] }; // part 无 text
      // 最后一个 chunk 才有正文
      yield { candidates: [{ content: { parts: [{ text: '创建成功！' }] } }] };
    })(),
    response: Promise.resolve({ candidates: [] }),
  };
}

function makeChat(steps) {
  let callCount = 0;
  return {
    sendMessageStream: async (_parts) => {
      const stepDef = steps[callCount] ?? { chunks: [] };
      callCount++;
      return makeStream(stepDef.chunks ?? [], stepDef.response ?? '');
    }
  };
}

// ─── 断言 ───────────────────────────────────────────────────────────────────
function getTextDeltas(events) {
  return events.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
}

function assertTextContains(events, expected, label) {
  const text = getTextDeltas(events);
  if (text.includes(expected)) {
    pass(`${label}: 输出包含 "${expected}"`);
  } else {
    fail(`${label}: 期望包含 "${expected}"，实际: "${text || '(空)'}"`);
  }
  return text;
}

function assertTextEmpty(events, label) {
  const text = getTextDeltas(events);
  if (text === '') pass(`${label}: 输出为空（预期）`);
  else fail(`${label}: 期望空但得到 "${text}"`);
}

function assertHasToolCall(events, toolName, label) {
  const found = events.some(e => e.type === 'tool-call' && e.toolName === toolName);
  if (found) pass(`${label}: 工具调用 ${toolName} ✓`);
  else fail(`${label}: 未找到工具调用 ${toolName}`);
}

function printEvents(events) {
  for (const e of events) {
    if (e.type === 'text-delta') info(`  text-delta: "${e.delta}"`);
    else if (e.type === 'tool-call') info(`  tool-call: ${e.toolName}`);
    else if (e.type === 'tool-result') info(`  tool-result: ${String(e.result).substring(0, 60)}`);
    else info(`  [${e.type}]${e.finishReason ? ' ' + e.finishReason : ''}`);
  }
}

const toolEx = (tc) => JSON.stringify({
  status: 'success', type: 'event', title: tc.args.title, id: 'abc-123',
  start_time: '2026-03-10T01:00:00Z'
});

// ─── 测试场景 ───────────────────────────────────────────────────────────────

async function test1_pureToolCall() {
  head('场景1: 纯工具调用（无前置文字）');
  const chat = makeChat([
    { chunks: [[{ functionCall: { name: 'upsert_activity', args: { title: '于总拜访', type: 'event' } } }]] },
  ]);
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeStream([[{ text: '于总拜访已创建好了！' }]]),
    lastParts: [{ text: '帮我创建于总拜访' }],
    toolExecutor: toolEx,
  });
  printEvents(events);
  assertHasToolCall(events, 'upsert_activity', '场景1');
  assertTextContains(events, '于总拜访', '场景1');
}

async function test2_textBeforeToolCall() {
  head('场景2: 工具调用前有前置文字（anyTextStreamed=true 的历史 bug 场景）');
  const chat = makeChat([
    { chunks: [
      [{ text: '好的，我来帮你创建！' }],
      [{ functionCall: { name: 'upsert_activity', args: { title: '周会', type: 'event' } } }],
    ]},
  ]);
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeStream([[{ text: '周会已经安排好了！' }]]),
    lastParts: [{ text: '帮我创建周会' }],
    toolExecutor: toolEx,
  });
  printEvents(events);
  assertHasToolCall(events, 'upsert_activity', '场景2');
  assertTextContains(events, '周会', '场景2 Phase2确认');
}

async function test3_pureText() {
  head('场景3: 纯文字回复（无工具）');
  const chat = makeChat([
    { chunks: [[{ text: '今天天气很好！' }]] },
  ]);
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeStream([]),
    lastParts: [{ text: '今天天气' }],
  });
  printEvents(events);
  assertTextContains(events, '今天天气很好', '场景3');
  const noTool = !events.some(e => e.type === 'tool-call');
  if (noTool) pass('场景3: 无工具调用（正确）');
  else fail('场景3: 不应有工具调用');
}

async function test4_fallbackResponse() {
  head('场景4: 主流为空，靠 result.response fallback 输出文字');
  const chat = {
    sendMessageStream: async () => makeEmptyStream('fallback 文字内容'),
  };
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeStream([]),
    lastParts: [{ text: '测试fallback' }],
  });
  printEvents(events);
  assertTextContains(events, 'fallback 文字内容', '场景4');
}

async function test5_phase2StreamEmpty_fallbackResponse() {
  head('场景5: Phase 2 流为空，靠 confirmResult.response fallback');
  const chat = makeChat([
    { chunks: [[{ functionCall: { name: 'upsert_activity', args: { title: '重要会议' } } }]] },
  ]);
  // 流为空，但 response 有内容
  const confirmFactory = async () => makeEmptyStream('重要会议已经为您创建完成！');
  const events = await runChatLoop({
    chat,
    confirmModelFactory: confirmFactory,
    lastParts: [{ text: '创建重要会议' }],
    toolExecutor: toolEx,
  });
  printEvents(events);
  assertHasToolCall(events, 'upsert_activity', '场景5');
  assertTextContains(events, '重要会议', '场景5 fallback确认');
}

async function test6_phase2GarbledChunks() {
  head('场景6: Phase 2 返回大量异常 chunk 结构（真实 Gemini 边缘情况）');
  const chat = makeChat([
    { chunks: [[{ functionCall: { name: 'upsert_activity', args: { title: '客户拜访' } } }]] },
  ]);
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeGarbledStream(),
    lastParts: [{ text: '创建客户拜访' }],
    toolExecutor: toolEx,
  });
  printEvents(events);
  assertHasToolCall(events, 'upsert_activity', '场景6');
  assertTextContains(events, '创建成功', '场景6 最终chunk有效文字');
}

async function test7_phase2BothEmpty() {
  head('场景7: Phase 2 流和 response 都为空（最坏情况）');
  const chat = makeChat([
    { chunks: [[{ functionCall: { name: 'upsert_activity', args: { title: '空测试' } } }]] },
  ]);
  const events = await runChatLoop({
    chat,
    confirmModelFactory: async () => makeEmptyStream(''),
    lastParts: [{ text: '创建空测试' }],
    toolExecutor: toolEx,
  });
  printEvents(events);
  assertHasToolCall(events, 'upsert_activity', '场景7');
  assertTextContains(events, '已创建成功', '场景7 硬编码兜底');
}

// ─── 入口 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${c.bold}=== Chat Flow 本地测试 ===${c.reset}`);
  await test1_pureToolCall();
  await test2_textBeforeToolCall();
  await test3_pureText();
  await test4_fallbackResponse();
  await test5_phase2StreamEmpty_fallbackResponse();
  await test6_phase2GarbledChunks();
  await test7_phase2BothEmpty();
  console.log(`\n${c.bold}完成${c.reset}`);
}

main().catch(console.error);
