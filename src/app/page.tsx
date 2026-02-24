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
import versionData from "../../version.json";

interface ChatMessage extends UIMessage {
  thinking?: string;
  images?: { data: string; mimeType: string }[];
}

export default function ChatPage() {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-3-flash-preview");

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSystemInstruction, setShowSystemInstruction] = useState(false);

  // System instruction
  const DEFAULT_SYSTEM_INSTRUCTION = "你是一个真诚、有深度的AI助手。请遵循以下原则：\n1. 拒绝顺从陷阱：不要为了讨好用户而无条件赞同。如果用户的观点有问题，礼貌但直接地指出。\n2. 多角度分析：对任何问题提供多个视角的观点，包括正面、反面和潜在的灰色地带。\n3. 诚实表达不确定性：当你不确定某件事时，明确说明而不是编造答案。\n4. 鼓励批判性思维：引导用户自行思考，而不是盲目接受你的回答。\n5. 用中文回复，除非用户使用其他语言提问。";
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);

  // Streaming state
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<{ data: string; mimeType: string }[]>([]);

  // Activation state
  const [isActivated, setIsActivated] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activating, setActivating] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Device fingerprint
  const getFingerprint = useCallback(() => {
    if (typeof window === 'undefined') return '';
    const nav = window.navigator;
    const screen = window.screen;
    const raw = [
      nav.userAgent,
      nav.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      nav.hardwareConcurrency || 0,
    ].join('|');
    // Simple hash
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const chr = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }, []);

  // Auth headers helper
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('activation-token') || '';
    return {
      'x-activation-token': token,
      'x-device-fingerprint': getFingerprint(),
    };
  }, [getFingerprint]);

  // Check activation on mount
  useEffect(() => {
    const token = localStorage.getItem('activation-token');
    if (token) {
      setIsActivated(true);
    }
    // Load saved system instruction
    const savedInstruction = localStorage.getItem('system-instruction');
    if (savedInstruction !== null) {
      setSystemInstruction(savedInstruction);
    }
    setCheckingAuth(false);
  }, []);

  // Handle activation
  const handleActivate = async () => {
    if (!activationCode.trim() || activating) return;
    setActivating(true);
    setActivationError("");
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode.trim(), fingerprint: getFingerprint() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '激活失败');
      localStorage.setItem('activation-token', data.token);
      setIsActivated(true);
    } catch (err: any) {
      setActivationError(err.message || '激活失败');
    } finally {
      setActivating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPendingImages((prev) => [...prev, { data: base64, mimeType: file.type }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

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

  // ── Detect image generation request ────────────────────
  const isImageGenRequest = (text: string): boolean => {
    const lower = text.toLowerCase();
    // Direct match keywords (short common phrases)
    const directKeywords = ['画一', '画个', '画张', '画幅', '绘制', '作画', '做一张图', '做个图', '做一幅',
      'draw ', 'paint ', 'sketch ', 'illustrate '];
    if (directKeywords.some((k) => lower.includes(k))) return true;
    // Smart match: text contains BOTH a generation verb AND an image noun
    const genVerbs = ['生成', '创建', '创作', '制作', '设计', '做', 'generate', 'create', 'make', 'design'];
    const imageNouns = ['图', '图片', '图像', '照片', '插画', '插图', '海报', '壁纸', '头像', '封面',
      'image', 'picture', 'photo', 'poster', 'wallpaper', 'avatar', 'icon', 'illustration'];
    const hasVerb = genVerbs.some((v) => lower.includes(v));
    const hasNoun = imageNouns.some((n) => lower.includes(n));
    return hasVerb && hasNoun;
  };

  // ── Send message ──────────────────────────────────────
  const sendMessage = async (text: string) => {
    if ((!text.trim() && pendingImages.length === 0) || isLoading) return;
    setIsLoading(true);
    setIsThinking(true);
    setThinkingText("");
    setError(null);
    userHasScrolledUp.current = false; // Re-enable auto-scroll for new response

    const currentImages = [...pendingImages];
    setPendingImages([]);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      parts: [{ type: "text", text }],
      images: currentImages.length > 0 ? currentImages : undefined,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Check if this is an image generation request
      // Also auto-route to image gen if the last assistant message had images (follow-up edit)
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
      const lastMsgHadImages = lastAssistantMsg?.images && lastAssistantMsg.images.length > 0;
      // Exit image mode: explicit commands or clearly non-image requests
      const exitImageMode = /^(文字模式|退出图片|\/text|\/chat)/i.test(text.trim());
      const shouldGenImage = !exitImageMode && (isImageGenRequest(text) || !!lastMsgHadImages) && currentImages.length === 0;

      if (shouldGenImage) {
        // ── Image generation path (non-streaming) ──
        setThinkingText("正在用 Nano Banana 生成图片...");

        // Build history for context
        const history = newMessages.slice(0, -1).map((m: ChatMessage) => ({
          role: m.role,
          text: m.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "",
          images: m.images,
        }));

        const response = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ prompt: text, history }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        setIsThinking(false);

        // Build assistant message with images
        const textParts = data.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n') || '';
        const imageParts = data.parts?.filter((p: any) => p.type === 'image') || [];

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          parts: [{ type: "text", text: textParts }],
          images: imageParts.map((p: any) => ({ data: p.data, mimeType: p.mimeType })),
        };

        const finalMessages = [...newMessages, assistantMessage];
        setMessages(finalMessages);
        await saveMessages(finalMessages);

      } else {
        // ── Regular streaming chat path ──
        const coreMessages = newMessages.map((m: ChatMessage) => {
          const contentParts: any[] = [];
          const textContent = m.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
          if (textContent) contentParts.push({ type: 'text', text: textContent });
          if (m.images) {
            m.images.forEach((img) => {
              contentParts.push({ type: 'image', image: img.data, mimeType: img.mimeType });
            });
          }
          return { role: m.role, content: contentParts.length > 0 ? contentParts : textContent };
        });

        const response = await fetch(`/api/chat?model=${model}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ messages: coreMessages, systemInstruction: systemInstruction.trim() || undefined }),
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
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err);
      }
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
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userHasScrolledUp = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (!userHasScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Detect if user scrolled away from bottom
  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    // If user is within 80px of the bottom, consider them "at bottom"
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userHasScrolledUp.current = !isNearBottom;
  }, []);

  // Auto-scroll on new content, but only when user is near bottom
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isThinking, thinkingText, scrollToBottom]);

  // Reset scroll lock when loading finishes (new message sent)
  useEffect(() => {
    if (!isLoading) {
      userHasScrolledUp.current = false;
    }
  }, [isLoading]);

  // ── Loading screen ────────────────────────────────────
  if (checkingAuth || !hasLoaded) {
    return (
      <div className="h-[100dvh] w-full bg-background flex items-center justify-center">
        加载中...
      </div>
    );
  }

  // ── Activation gate ─────────────────────────────────────
  if (!isActivated) {
    return (
      <div className="h-[100dvh] w-full bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          {/* Logo */}
          <div className="flex flex-col items-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2v20" /><path d="m3 12 18 0" /><path d="m19 5-14 14" /><path d="m5 5 14 14" /></svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Gemini</h1>
            <p className="text-sm text-muted-foreground">请输入激活码以开始使用</p>
          </div>

          {/* Input */}
          <div className="space-y-3">
            <input
              type="text"
              className="w-full bg-muted/50 border border-input rounded-xl px-4 py-3 outline-none text-center text-lg tracking-widest font-mono focus:border-primary/50 transition-colors"
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              placeholder="输入激活码"
              onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
              autoFocus
            />
            <button
              onClick={handleActivate}
              disabled={activating || !activationCode.trim()}
              className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {activating ? '验证中...' : '激活'}
            </button>
          </div>

          {/* Error */}
          {activationError && (
            <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{activationError}</p>
          )}

          {/* Version */}
          <p className="text-[10px] text-muted-foreground/40">
            v{versionData.major}.{versionData.minor}.{versionData.build}
          </p>
        </div>
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
          className="mx-3 mt-3 flex items-center space-x-2 px-3 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/70 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          <span>新建会话</span>
        </button>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto mt-2 px-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`flex items-center rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${activeConv?.id === conv.id
                ? "bg-foreground/10 text-foreground font-semibold"
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
                  if (confirm('确定要删除这个会话吗？')) {
                    handleDeleteConversation(conv.id);
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-500 transition-all ml-1 flex-shrink-0"
                title="删除"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              </button>
            </div>
          ))}
        </div>

        {/* System Instruction */}
        <div className="px-3 py-2 border-t">
          <button
            onClick={() => setShowSystemInstruction(!showSystemInstruction)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
              系统指令
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showSystemInstruction ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {showSystemInstruction && (
            <div className="mt-2 space-y-2">
              <textarea
                value={systemInstruction}
                onChange={(e) => {
                  setSystemInstruction(e.target.value);
                  localStorage.setItem('system-instruction', e.target.value);
                }}
                className="w-full h-32 text-xs bg-muted/50 border rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                placeholder="输入系统指令..."
              />
              <button
                onClick={() => {
                  setSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION);
                  localStorage.setItem('system-instruction', DEFAULT_SYSTEM_INSTRUCTION);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                恢复默认
              </button>
            </div>
          )}
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

        {/* Version */}
        <div className="px-3 py-2 border-t">
          <p className="text-[10px] text-muted-foreground/50 text-center">
            v{versionData.major}.{versionData.minor}.{versionData.build}
          </p>
        </div>
      </div>

      {/* ── Header ── */}
      <header className="flex-none px-4 py-3 border-b flex items-center justify-between bg-card text-card-foreground z-10">
        {/* Left: hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
        </button>
        {/* Center: conversation title */}
        <h1 className="text-base font-semibold tracking-tight truncate mx-3 flex-1 text-center">
          {activeConv?.title === "新会话" ? "Gemini" : activeConv?.title || "Gemini"}
        </h1>
        {/* Right: status dot */}
        <div className="p-1.5 flex-shrink-0">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLoading ? 'bg-amber-400' : 'bg-green-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${isLoading ? 'bg-amber-500' : 'bg-green-500'}`}></span>
          </span>
        </div>
      </header>

      {/* ── Messages Area ── */}
      <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-background/50 overscroll-y-contain">
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
                {/* User-uploaded images */}
                {m.images && m.images.length > 0 && (
                  <div className={`flex w-full ${m.role === "user" ? "justify-end" : "justify-start"} mb-1`}>
                    <div className="flex flex-wrap gap-2 max-w-[85%]">
                      {m.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={`data:${img.mimeType};base64,${img.data}`}
                          alt="uploaded"
                          className="rounded-xl max-h-48 max-w-[200px] object-cover border"
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className={`flex w-full ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`flex flex-col max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed break-words ${m.role === "user"
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

      {/* ── Input Area (Gemini-style) ── */}
      <div className="flex-none px-3 pt-2 pb-3 bg-background">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageUpload}
        />

        {/* Pending image preview */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
            {pendingImages.map((img, idx) => (
              <div key={idx} className="relative flex-shrink-0">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="pending"
                  className="h-16 w-16 rounded-xl object-cover border"
                />
                <button
                  type="button"
                  onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading) { stopGeneration(); return; }
            if (!input.trim() && pendingImages.length === 0) return;
            sendMessage(input);
          }}
          className="bg-muted/60 border border-input rounded-3xl overflow-hidden transition-all focus-within:border-primary/50 focus-within:bg-muted/80"
        >
          {/* Text input - auto-expanding textarea */}
          <textarea
            className="w-full bg-transparent px-5 pt-3.5 pb-2 outline-none text-base placeholder:text-muted-foreground/60 resize-none overflow-hidden"
            value={input}
            placeholder="问问 Gemini"
            rows={1}
            style={{ maxHeight: '200px', overflowY: input.split('\n').length > 6 ? 'auto' : 'hidden' }}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isLoading) { stopGeneration(); return; }
                if (!input.trim() && pendingImages.length === 0) return;
                sendMessage(input);
                (e.target as HTMLTextAreaElement).style.height = 'auto';
              }
            }}
          />
          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center space-x-1.5">
              {/* Image upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-full hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                title="上传图片"
                disabled={isLoading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
              </button>
              {/* Model selector badge */}
              <select
                className="appearance-none cursor-pointer text-[11px] text-muted-foreground bg-background/80 border border-input rounded-full pl-2.5 pr-5 py-0.5 outline-none hover:bg-muted transition-colors"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isLoading}
              >
                <optgroup label="Gemini 3.x">
                  <option value="gemini-3.1-pro-preview">3.1 Pro</option>
                  <option value="gemini-3-pro-preview">3.0 Pro</option>
                  <option value="gemini-3-flash-preview">3.0 Flash</option>
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
              {/* Status indicator */}
              {isLoading && (
                <span className="inline-flex items-center space-x-1 text-[11px] text-amber-500 px-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  <span>{isThinking ? '思考中' : '回复中'}</span>
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1">
              {isLoading ? (
                <button
                  type="submit"
                  className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="停止生成"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  disabled={!input.trim() && pendingImages.length === 0}
                  type="submit"
                  className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}

