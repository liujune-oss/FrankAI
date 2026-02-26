"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useChatStream } from "@/hooks/useChatStream";
import ActivationGate from "@/components/ActivationGate";
import ChatHeader from "@/components/ChatHeader";
import ConversationDrawer from "@/components/ConversationDrawer";
import MessageList from "@/components/MessageList";
import InputBar from "@/components/InputBar";
import MemoryManager from "@/components/MemoryManager";

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
        body: JSON.stringify({ conv_id: convId })
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
      />

      <ChatHeader
        title={conv.activeConv?.title || "Gemini"}
        isLoading={chat.isLoading}
        onOpenDrawer={() => conv.setDrawerOpen(true)}
      />

      <MessageList
        messages={conv.messages}
        isLoading={chat.isLoading}
        isThinking={chat.isThinking}
        isImageGenerating={chat.isImageGenerating}
        thinkingText={chat.thinkingText}
        error={chat.error}
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

      {/* Memory Manager Modal */}
      <MemoryManager
        open={isMemoryManagerOpen}
        onClose={() => setIsMemoryManagerOpen(false)}
      />
    </main>
  );
}
