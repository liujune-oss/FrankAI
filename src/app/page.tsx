"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useChatStream } from "@/hooks/useChatStream";
import ActivationGate from "@/components/ActivationGate";
import ChatHeader from "@/components/ChatHeader";
import ConversationDrawer from "@/components/ConversationDrawer";
import MessageList from "@/components/MessageList";
import InputBar from "@/components/InputBar";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-3-flash-preview");
  const userHasScrolledUpRef = useRef(false);

  // ── Auth & activation ──
  const auth = useAuth();

  // ── Conversations ──
  const conv = useConversations();

  // ── Chat stream ──
  const chat = useChatStream({
    messages: conv.messages,
    setMessages: conv.setMessages,
    saveMessages: conv.saveMessages,
    getAuthHeaders: auth.getAuthHeaders,
    handleUnauthorized: auth.handleUnauthorized,
    model,
    systemInstruction: auth.systemInstruction,
  });

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
      alert("此会话暂无记录，无法提炼记忆。");
      return;
    }

    try {
      const res = await fetch('/api/vectorize', {
        method: 'POST',
        headers: {
          ...auth.getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ conv_id: convId, messages: targetConv.messages })
      });
      const data = await res.json();
      if (res.ok) {
        alert("已成功从该会话中提炼记忆，并存入私有向量库！");
      } else {
        alert("提取记忆失败: " + data.error);
      }
    } catch (e) {
      alert("网络错误无法提取记忆");
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
    <main className="flex flex-col h-[100dvh] bg-background w-full max-w-2xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
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
        pendingImages={chat.pendingImages}
        setPendingImages={chat.setPendingImages}
        onImageUpload={chat.handleImageUpload}
        fileInputRef={chat.fileInputRef}
      />
    </main>
  );
}
