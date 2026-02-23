"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UIMessage } from "ai";
import {
  Conversation,
  getAllConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  deleteAllConversations,
  createNewConversation,
  getActiveConversationId,
  setActiveConversationId,
  autoTitle,
} from "@/lib/conversations";

interface ChatMessage extends UIMessage {
  thinking?: string;
}

export default function ChatPage() {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-3.1-pro-preview");

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Streaming state
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Initialization ────────────────────────────────────
  useEffect(() => {
    (async () => {
      const allConvs = await getAllConversations();
      setConversations(allConvs);

      const activeId = await getActiveConversationId();
      if (activeId) {
        const conv = await getConversation(activeId);
        if (conv) {
          setActiveConv(conv);
          setMessages(conv.messages || []);
        } else {
          // Active conv was deleted, create new
          const newConv = createNewConversation();
          await saveConversation(newConv);
          await setActiveConversationId(newConv.id);
          setActiveConv(newConv);
          setMessages([]);
          setConversations([newConv, ...allConvs]);
        }
      } else {
        // No active conversation, create one
        const newConv = createNewConversation();
        await saveConversation(newConv);
        await setActiveConversationId(newConv.id);
        setActiveConv(newConv);
        setMessages([]);
        setConversations([newConv]);
      }
      setHasLoaded(true);
    })();
  }, []);

  // ── Save messages to active conversation ────────────────
  const saveMessages = useCallback(
    async (msgs: ChatMessage[]) => {
      if (!activeConv) return;
      const updated: Conversation = {
        ...activeConv,
        messages: msgs,
        title: autoTitle(msgs),
        updatedAt: Date.now(),
      };
      await saveConversation(updated);
      setActiveConv(updated);
      setConversations((prev) =>
        prev
          .map((c) => (c.id === updated.id ? updated : c))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    },
    [activeConv]
  );

  // ── Conversation actions ──────────────────────────────
  const handleNewChat = useCallback(async () => {
    if (isLoading) return;
    const newConv = createNewConversation();
    await saveConversation(newConv);
    await setActiveConversationId(newConv.id);
    setActiveConv(newConv);
    setMessages([]);
    setError(null);
    setConversations((prev) => [newConv, ...prev]);
    setDrawerOpen(false);
  }, [isLoading]);

  const handleSwitchConversation = useCallback(
    async (conv: Conversation) => {
      if (isLoading) return;
      await setActiveConversationId(conv.id);
      const fresh = await getConversation(conv.id);
      if (fresh) {
        setActiveConv(fresh);
        setMessages(fresh.messages || []);
      }
      setError(null);
      setDrawerOpen(false);
    },
    [isLoading]
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConv?.id === id) {
        // Switch to another or create new
        const remaining = conversations.filter((c) => c.id !== id);
        if (remaining.length > 0) {
          await handleSwitchConversation(remaining[0]);
        } else {
          await handleNewChat();
        }
      }
    },
    [activeConv, conversations, handleSwitchConversation, handleNewChat]
  );

  const handleClearAll = useCallback(async () => {
    if (isLoading) return;
    await deleteAllConversations();
    setConversations([]);
    const newConv = createNewConversation();
    await saveConversation(newConv);
    await setActiveConversationId(newConv.id);
    setActiveConv(newConv);
    setMessages([]);
    setError(null);
    setConversations([newConv]);
    setDrawerOpen(false);
  }, [isLoading]);

  // ── Stop generation ───────────────────────────────────
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setIsThinking(false);
    setThinkingText("");
  }, []);

  // ── Send message ──────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setIsLoading(true);
    setIsThinking(true);
    setThinkingText("");
    setError(null);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      parts: [{ type: "text", text }],
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const coreMessages = newMessages.map((m) => ({
        role: m.role,
        content:
          m.parts
            ?.map((p: any) => p.text)
            .filter(Boolean)
            .join("\n") || "",
      }));

      const response = await fetch(`/api/chat?model=${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: coreMessages }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        thinking: "",
      };

      const withAssistant = [...newMessages, assistantMessage];
      setMessages(withAssistant);

      let done = false;
      let streamedContent = "";
      let thinkingContent = "";
      let hasStartedText = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            if (line.startsWith("data: ")) {
              const raw = line.substring(6);
              if (raw === "[DONE]") continue;
              try {
                const payload = JSON.parse(raw);
                if (payload.type === "text-delta") {
                  if (!hasStartedText) {
                    hasStartedText = true;
                    setIsThinking(false);
                  }
                  streamedContent += payload.delta;
                } else if (
                  payload.type === "reasoning" ||
                  payload.type === "reasoning-delta"
                ) {
                  thinkingContent += payload.delta || payload.text || "";
                  setThinkingText(thinkingContent);
                } else if (payload.errorText) {
                  throw new Error(payload.errorText);
                }
              } catch (e: any) {
                if (
                  e?.message?.startsWith("HTTP") ||
                  e?.message?.includes("error")
                )
                  throw e;
              }
            } else if (line.startsWith("0:")) {
              try {
                const delta = JSON.parse(line.substring(2));
                if (!hasStartedText) {
                  hasStartedText = true;
                  setIsThinking(false);
                }
                streamedContent += delta;
              } catch (e) { }
            }
          }

          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] } as ChatMessage;
            if (last.role === "assistant") {
              last.parts = [{ type: "text", text: streamedContent }];
              last.thinking = thinkingContent;
            }
            updated[updated.length - 1] = last;
            return updated;
          });
        }
      }

      // Save final messages
      const finalMessages = [...newMessages];
      const finalAssistant: ChatMessage = {
        id: assistantMessage.id,
        role: "assistant",
        parts: [{ type: "text", text: streamedContent }],
        thinking: thinkingContent,
      };
      finalMessages.push(finalAssistant);
      await saveMessages(finalMessages);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err);
      }
      // Save partial messages even on error
      await saveMessages(newMessages);
    } finally {
      setIsLoading(false);
      setIsThinking(false);
      setThinkingText("");
      abortControllerRef.current = null;
    }
  };

  // ── Scroll handling ───────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isThinking, thinkingText]);

  // ── Loading screen ────────────────────────────────────
  if (!hasLoaded) {
    return (
      <div className="h-[100dvh] w-full bg-background flex items-center justify-center">
        加载中...
      </div>
    );
  }

  return (
    <main className="flex flex-col h-[100dvh] bg-background w-full max-w-2xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
      {/* ── Drawer Overlay ── */}
      {drawerOpen && (
        <div
          className="absolute inset-0 bg-black/40 z-30 transition-opacity"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Conversation Drawer ── */}
      <div
        className={`absolute top-0 left-0 h-full w-72 bg-card border-r z-40 flex flex-col transition-transform duration-300 ease-in-out ${drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">会话列表</h2>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        {/* New Chat button */}
        <button
          onClick={handleNewChat}
          className="mx-3 mt-3 flex items-center space-x-2 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          <span>新建会话</span>
        </button>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto mt-2 px-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${activeConv?.id === conv.id
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted text-foreground"
                }`}
              onClick={() => handleSwitchConversation(conv)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate font-medium">{conv.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(conv.updatedAt).toLocaleDateString("zh-CN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all ml-1"
                title="删除"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              </button>
            </div>
          ))}
        </div>

        {/* Clear all */}
        {conversations.length > 1 && (
          <div className="px-3 py-3 border-t">
            <button
              onClick={handleClearAll}
              className="w-full text-xs text-muted-foreground hover:text-red-500 py-2 rounded-lg hover:bg-red-500/5 transition-colors"
            >
              清空所有会话
            </button>
          </div>
        )}
      </div>

      {/* ── Header ── */}
      <header className="flex-none px-4 py-3 border-b flex items-center justify-between bg-card text-card-foreground z-10">
        <div className="flex items-center space-x-3">
          {/* Hamburger menu */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors -ml-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
          </button>
          <h1 className="text-lg font-semibold tracking-tight truncate max-w-[140px]">
            {activeConv?.title === "New Chat" ? "Gemini" : activeConv?.title || "Gemini"}
          </h1>
        </div>
        <div className="flex items-center space-x-3">
          <select
            className="bg-transparent border border-input rounded-md max-w-36 text-xs p-1 outline-none text-muted-foreground"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isLoading}
          >
            <optgroup label="Gemini 3.x">
              <option value="gemini-3.1-pro-preview">3.1 Pro Preview</option>
              <option value="gemini-3-pro-preview">3.0 Pro Preview</option>
              <option value="gemini-3-flash-preview">3.0 Flash Preview</option>
            </optgroup>
            <optgroup label="Gemini 2.5">
              <option value="gemini-2.5-pro">2.5 Pro</option>
              <option value="gemini-2.5-flash">2.5 Flash</option>
              <option value="gemini-2.5-flash-lite">2.5 Flash Lite</option>
            </optgroup>
            <optgroup label="Gemini 2.0">
              <option value="gemini-2.0-flash">2.0 Flash</option>
              <option value="gemini-2.0-flash-lite">2.0 Flash Lite</option>
            </optgroup>
          </select>
          <div className="flex items-center space-x-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLoading ? "bg-amber-400" : "bg-green-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLoading ? "bg-amber-500" : "bg-green-500"}`}></span>
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              {isThinking ? "思考中" : isLoading ? "回复中" : "就绪"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Messages Area ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-background/50 overscroll-y-contain">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2v20" /><path d="m3 12 18 0" /><path d="m19 5-14 14" /><path d="m5 5 14 14" /></svg>
            </div>
            <p className="text-center font-medium">有什么可以帮您的？</p>
            <p className="text-sm text-center max-w-xs opacity-70">
              您的私人 AI 助手，由 Gemini 驱动。
            </p>
          </div>
        ) : (
          messages.map((m: ChatMessage) => {
            const content = m.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as any).text)
              .join("\n");
            return (
              <div key={m.id} className="space-y-2">
                {m.role === "assistant" && m.thinking && (
                  <div className="flex w-full justify-start">
                    <details className="max-w-[85%]">
                      <summary className="cursor-pointer text-xs text-muted-foreground flex items-center space-x-1.5 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                        <span>思考过程</span>
                      </summary>
                      <div className="mt-1 px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {m.thinking}
                      </div>
                    </details>
                  </div>
                )}
                <div className={`flex w-full ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`flex max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed break-words ${m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted text-foreground rounded-tl-sm border"
                      }`}
                  >
                    {m.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert prose-p:leading-relaxed max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      content
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex w-full justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-muted text-foreground rounded-tl-sm border">
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <div className="flex space-x-1 items-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse [animation-delay:0.2s]"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse [animation-delay:0.4s]"></div>
                </div>
                <span className="text-xs font-medium">思考中</span>
              </div>
              {thinkingText && (
                <div className="mt-2 text-xs text-muted-foreground/80 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {thinkingText}
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading && !isThinking && messages[messages.length - 1]?.role === "user" && (
          <div className="flex w-full justify-start">
            <div className="flex items-center max-w-[85%] rounded-2xl px-4 py-3 bg-muted text-foreground rounded-tl-sm border">
              <div className="flex space-x-1.5 items-center">
                <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce"></div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex w-full justify-center my-4">
            <div className="bg-red-500/10 text-red-500 rounded-lg px-4 py-3 text-sm max-w-[85%] border border-red-500/20 break-words">
              <strong>错误：</strong> {error.message || "发生了未知错误"}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* ── Input Area ── */}
      <div className="flex-none p-3 bg-background border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading) {
              stopGeneration();
              return;
            }
            if (!input.trim()) return;
            sendMessage(input);
          }}
          className="relative flex items-center w-full focus-within:ring-2 ring-primary ring-offset-2 rounded-2xl ring-offset-background transition-all"
        >
          <input
            className="w-full bg-muted/50 border border-input rounded-2xl px-4 py-3 outline-none transition-colors text-base"
            value={input}
            placeholder={isLoading ? "正在生成回复..." : "向 Gemini 发送消息..."}
            onChange={(e) => setInput(e.target.value)}
          />
          {isLoading ? (
            <button
              type="submit"
              className="absolute right-2 p-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all"
              title="停止生成"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              disabled={!input.trim()}
              type="submit"
              className="absolute right-2 p-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
            </button>
          )}
        </form>
        <div className="text-center mt-2">
          <span className="text-[10px] text-muted-foreground">
            Gemini 可能会犯错，请核实重要信息。
          </span>
        </div>
      </div>
    </main>
  );
}
