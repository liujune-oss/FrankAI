"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useChatStream } from "@/hooks/useChatStream";
import ActivationGate from "@/components/ActivationGate";
import ChatHeader from "@/components/ChatHeader";
import ConversationDrawer from "@/components/ConversationDrawer";
import MessageList from "@/components/MessageList";
import InputBar from "@/components/InputBar";
import MemoryManager from "@/components/MemoryManager";
import SandboxModal from "@/components/SandboxModal";

const DEFAULT_MODELS = [
  { id: 'gemini-3.1-pro-preview', label: '3.1 Pro', group: 'Gemini 3.x' },
  { id: 'gemini-3-pro-preview', label: '3.0 Pro', group: 'Gemini 3.x' },
  { id: 'gemini-3-flash-preview', label: '3.0 Flash', group: 'Gemini 3.x' },
  { id: 'gemini-2.5-pro', label: '2.5 Pro', group: 'Gemini 2.5' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash', group: 'Gemini 2.5' },
  { id: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite', group: 'Gemini 2.5' },
  { id: 'gemini-2.0-flash', label: '2.0 Flash', group: 'Gemini 2.0' },
  { id: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite', group: 'Gemini 2.0' },
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-3-flash-preview");
  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);
  const [extractingMemories, setExtractingMemories] = useState<Set<string>>(new Set());
  const [isMemoryManagerOpen, setIsMemoryManagerOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const userHasScrolledUpRef = useRef(false);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [isAdmin, setIsAdmin] = useState(false);
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('sandbox_enabled') === 'true') {
      setIsAdmin(true);
    }
    const token = localStorage.getItem('activation-token') || '';
    const fp = localStorage.getItem('device-fingerprint') || '';
    if (token) {
      fetch('/api/admin/check', {
        headers: { 'x-activation-token': token, 'x-device-fingerprint': fp },
      })
        .then(res => { if (res.ok) setIsAdmin(true); })
        .catch(() => { });
    }
  }, []);

  // ── Auth & activation ──
  const auth = useAuth();

  // ── Conversations ──
  const conv = useConversations();

  // ── Chat stream ──
  const chat = useChatStream({
    conversationId: conv.activeConv?.id,
    messages: conv.messages,
    setMessages: conv.setMessages,
    saveMessages: conv.saveMessages,
    getAuthHeaders: auth.getAuthHeaders,
    handleUnauthorized: auth.handleUnauthorized,
    model,
    systemInstruction: auth.systemInstruction,
  });

  const copyDebugLog = useCallback(() => {
    const text = chat.debugEvents.join('\n---\n');
    // Use textarea fallback for compatibility on localhost (no HTTPS)
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 2000);
  }, [chat.debugEvents]);

  // Load model config from server
  useEffect(() => {
    if (!auth.isActivated) return;
    fetch('/api/config', {
      headers: auth.getAuthHeaders(),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          if (Array.isArray(data.chatModels) && data.chatModels.length > 0) {
            setAvailableModels(data.chatModels);
          }
          if (data.defaultChatModel) {
            setModel(data.defaultChatModel);
          }
        }
      })
      .catch(() => { /* fallback to defaults */ });
  }, [auth.isActivated]);

  // ── Loading screen ──
  if (auth.checkingAuth || !conv.hasLoaded) {
    return (
      <div className="h-[100dvh] w-full bg-background flex items-center justify-center">
        加载中...
      </div>
    );
  }

  const handleMemory = async (convId: string) => {
    const targetConv = conv.conversations.find(c => c.id === convId);
    if (!targetConv || !targetConv.messages || targetConv.messages.length === 0) {
      showToast("此会话暂无记录，无法提炼记忆。", "info");
      return;
    }

    setExtractingMemories(prev => {
      const next = new Set(prev);
      next.add(convId);
      return next;
    });

    try {
      const res = await fetch('/api/memory/sync', {
        method: 'POST',
        headers: {
          ...auth.getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: convId, messages: targetConv.messages })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("已成功从该会话中提炼记忆，并存入私有向量库！", "success");
      } else {
        showToast("提取记忆失败: " + data.error, "error");
      }
    } catch (e) {
      showToast("网络错误无法提取记忆", "error");
    } finally {
      setExtractingMemories(prev => {
        const next = new Set(prev);
        next.delete(convId);
        return next;
      });
    }
  };

  // ── Activation gate ──
  if (!auth.isActivated) {
    return (
      <ActivationGate
        activationCode={auth.activationCode}
        setActivationCode={auth.setActivationCode}
        handleActivate={auth.handleActivate}
        activating={auth.activating}
        activationError={auth.activationError}
      />
    );
  }

  return (
    <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
      <ConversationDrawer
        open={conv.drawerOpen}
        onClose={() => conv.setDrawerOpen(false)}
        conversations={conv.conversations}
        activeId={conv.activeConv?.id}
        onNew={() => conv.handleNewChat(chat.isLoading)}
        onSwitch={(c) => conv.handleSwitchConversation(c, chat.isLoading)}
        onDelete={(id) => conv.handleDeleteConversation(id, chat.isLoading)}
        onClearAll={() => conv.handleClearAll(chat.isLoading)}
        onMemory={handleMemory}
        onOpenMemoryManager={() => setIsMemoryManagerOpen(true)}
        extractingMemories={extractingMemories}
        systemInstruction={auth.systemInstruction}
        setSystemInstruction={auth.setSystemInstruction}
        defaultSystemInstruction={auth.DEFAULT_SYSTEM_INSTRUCTION}
        pushSystemInstruction={auth.pushSystemInstruction}
        isAdmin={isAdmin}
        onOpenSandbox={() => { setIsSandboxOpen(true); conv.setDrawerOpen(false); }}
        onClearCloud={() => conv.handleClearCloud()}
      />

      <ChatHeader
        title={conv.activeConv?.title || "Gemini"}
        isLoading={chat.isLoading}
        onOpenDrawer={() => conv.openDrawer()}
      />

      <MessageList
        messages={conv.messages}
        isLoading={chat.isLoading}
        isThinking={chat.isThinking}
        isImageGenerating={chat.isImageGenerating}
        thinkingText={chat.thinkingText}
        error={chat.error}
        onEditMessage={chat.editAndResend}
        onRegenerateMessage={chat.regenerateFrom}
      />

      <InputBar
        input={input}
        setInput={(v) => { setInput(v); }}
        onSend={(text) => { chat.sendMessage(text, userHasScrolledUpRef); setInput(""); }}
        onStop={chat.stopGeneration}
        isLoading={chat.isLoading}
        isThinking={chat.isThinking}
        model={model}
        setModel={setModel}
        availableModels={availableModels}
        pendingImages={chat.pendingImages}
        setPendingImages={chat.setPendingImages}
        onImageUpload={chat.handleImageUpload}
        fileInputRef={chat.fileInputRef}
        getAuthHeaders={auth.getAuthHeaders}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 sm:top-auto sm:bottom-24 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5 sm:slide-in-from-bottom-10 duration-300 pointer-events-none">
          <div className={`mx-auto w-fit max-w-[90%] px-4 py-3 rounded-full shadow-lg backdrop-blur-md border border-white/10 text-sm font-medium flex items-center gap-2 pointer-events-auto ${toast.type === 'success' ? 'bg-green-500/90 text-white' :
            toast.type === 'error' ? 'bg-red-500/90 text-white' :
              'bg-zinc-800/90 text-white'
            }`}>
            {toast.type === 'success' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            {toast.type === 'error' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>}
            {toast.type === 'info' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>}
            {toast.message}
          </div>
        </div>
      )}

      {/* Debug Events Panel — 仅开发环境显示 */}
      {process.env.NODE_ENV === 'development' && (chat.debugEvents.length > 0 || chat.isLoading) && (
        <div className="absolute bottom-24 right-3 z-50 w-72 max-h-64 overflow-y-auto rounded-xl shadow-2xl border border-zinc-700/60 bg-zinc-900/95 backdrop-blur-md text-xs font-mono">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
            <span className="text-zinc-400 font-semibold tracking-wide">⚡ 实时流事件</span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">{chat.debugEvents.length} 条</span>
              {chat.debugEvents.length > 0 && (
                <button
                  onClick={copyDebugLog}
                  className="text-zinc-400 hover:text-white transition-colors px-1.5 py-0.5 rounded text-[10px] border border-zinc-600 hover:border-zinc-400"
                >
                  {copiedDebug ? '✓ 已复制' : '复制'}
                </button>
              )}
            </div>
          </div>
          <div className="px-3 py-2 space-y-1">
            {chat.isLoading && chat.debugEvents.length === 0 && (
              <div className="text-zinc-500 animate-pulse">等待后端响应...</div>
            )}
            {chat.debugEvents.map((evt, i) => (
              <div key={i} className={`whitespace-pre-wrap break-all leading-relaxed ${evt.includes('🔧') ? 'text-amber-400' :
                evt.includes('✅') ? 'text-green-400' :
                  evt.includes('❌') ? 'text-red-400' :
                    evt.includes('🏁') ? 'text-blue-400' :
                      evt.includes('▶️') ? 'text-cyan-400' :
                        'text-zinc-400'
                }`}>{evt}</div>
            ))}
          </div>
        </div>
      )}

      {/* Memory Manager Modal */}
      <MemoryManager
        open={isMemoryManagerOpen}
        onClose={() => setIsMemoryManagerOpen(false)}
      />

      {/* Admin Sandbox Modal */}
      <SandboxModal
        open={isSandboxOpen}
        onClose={() => setIsSandboxOpen(false)}
      />
    </main>
  );
}
