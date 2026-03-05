"use client";

import { useEffect, useState, useCallback } from "react";
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
import { ChatMessage } from "@/types/chat";

// ── Cloud sync helpers ──────────────────────────────────────────────────

function getCloudAuthHeaders(): Record<string, string> {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("activation-token") || "";
    const fp = localStorage.getItem("device-fingerprint") || "";
    return {
        "Content-Type": "application/json",
        "x-activation-token": token,
        "x-device-fingerprint": fp,
    };
}

/** 同步前去除 images 字段（base64 数据不存云端，节省存储） */
function stripImages(conv: Conversation): Conversation {
    return {
        ...conv,
        messages: conv.messages.map((m: ChatMessage) => {
            const { images: _images, ...rest } = m as ChatMessage & { images?: unknown };
            return rest as ChatMessage;
        }),
    };
}

/** 后台 upsert 一条对话到云端，不阻塞 UI */
function syncConvToCloud(conv: Conversation): void {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return; // 未激活时跳过
    fetch("/api/conversations/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation: stripImages(conv) }),
    }).catch(() => {}); // fire-and-forget
}

/** 后台删除云端一条对话 */
function deleteConvFromCloud(id: string): void {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return;
    fetch("/api/conversations/sync", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
    }).catch(() => {});
}

/** 后台清空云端全部对话 */
function clearAllConvsFromCloud(): void {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return;
    fetch("/api/conversations/sync", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ all: true }),
    }).catch(() => {});
}

/**
 * 启动时双向同步：
 * 1. 拉取云端对话列表
 * 2. 将云端更新版本写入 IndexedDB
 * 3. 将本地独有的对话推送到云端
 * 返回更新后的 Conversation[]（按 updatedAt 降序）
 */
async function mergeWithCloud(localConvs: Conversation[]): Promise<Conversation[]> {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return localConvs;

    let cloudConvs: Conversation[] = [];
    try {
        const res = await fetch("/api/conversations/sync", { headers });
        if (!res.ok) return localConvs;
        const data = await res.json();
        cloudConvs = data.conversations ?? [];
    } catch {
        return localConvs; // 网络异常时静默降级
    }

    const localMap = new Map(localConvs.map((c) => [c.id, c]));
    const cloudMap = new Map(cloudConvs.map((c) => [c.id, c]));

    // 云端更新 → 写入 IndexedDB
    for (const cloudConv of cloudConvs) {
        const local = localMap.get(cloudConv.id);
        if (!local || cloudConv.updatedAt > local.updatedAt) {
            await saveConversation(cloudConv);
            localMap.set(cloudConv.id, cloudConv);
        }
    }

    // 本地独有 → 推送到云端
    for (const localConv of localConvs) {
        if (!cloudMap.has(localConv.id)) {
            syncConvToCloud(localConv);
        }
    }

    // 返回合并后列表（按 updatedAt 降序）
    return Array.from(localMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useConversations() {
    const [hasLoaded, setHasLoaded] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConv, setActiveConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    // Initialization
    useEffect(() => {
        (async () => {
            // Phase 1: 从 IndexedDB 加载本地数据，立即显示 UI
            const localConvs = await getAllConversations();
            setConversations(localConvs);

            const activeId = await getActiveConversationId();
            if (activeId) {
                const conv = await getConversation(activeId);
                if (conv) {
                    setActiveConv(conv);
                    setMessages(conv.messages || []);
                } else {
                    const newConv = createNewConversation();
                    await saveConversation(newConv);
                    await setActiveConversationId(newConv.id);
                    setActiveConv(newConv);
                    setMessages([]);
                    setConversations([newConv, ...localConvs]);
                }
            } else if (localConvs.length > 0) {
                const latest = localConvs[0];
                await setActiveConversationId(latest.id);
                setActiveConv(latest);
                setMessages(latest.messages || []);
            } else {
                const newConv = createNewConversation();
                await saveConversation(newConv);
                await setActiveConversationId(newConv.id);
                setActiveConv(newConv);
                setMessages([]);
                setConversations([newConv]);
            }
            setHasLoaded(true);

            // Phase 2: 后台与云端合并（不阻塞 UI）
            setIsSyncing(true);
            const mergedConvs = await mergeWithCloud(localConvs);
            setIsSyncing(false);

            // 用合并后的数据更新列表（但不切换 activeConv，避免干扰用户）
            if (mergedConvs.length !== localConvs.length ||
                mergedConvs.some((c, i) => c.updatedAt !== localConvs[i]?.updatedAt)) {
                setConversations(mergedConvs);
            }
        })();
    }, []);

    // Save messages to active conversation
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
            syncConvToCloud(updated); // 后台同步，不 await
            setActiveConv(updated);
            setConversations((prev) =>
                prev
                    .map((c) => (c.id === updated.id ? updated : c))
                    .sort((a, b) => b.updatedAt - a.updatedAt)
            );
        },
        [activeConv]
    );

    // New chat
    const handleNewChat = useCallback(async (isLoading: boolean) => {
        if (isLoading) return;
        const newConv = createNewConversation();
        await saveConversation(newConv);
        await setActiveConversationId(newConv.id);
        syncConvToCloud(newConv);
        setActiveConv(newConv);
        setMessages([]);
        setConversations((prev) => [newConv, ...prev]);
        setDrawerOpen(false);
    }, []);

    // Switch conversation
    const handleSwitchConversation = useCallback(
        async (conv: Conversation, isLoading: boolean) => {
            if (isLoading) return;
            await setActiveConversationId(conv.id);
            const fresh = await getConversation(conv.id);
            if (fresh) {
                setActiveConv(fresh);
                setMessages(fresh.messages || []);
            }
            setDrawerOpen(false);
        },
        []
    );

    // Delete conversation
    const handleDeleteConversation = useCallback(
        async (id: string, isLoading: boolean) => {
            await deleteConversation(id);
            deleteConvFromCloud(id);
            setConversations((prev) => prev.filter((c) => c.id !== id));
            if (activeConv?.id === id) {
                const remaining = conversations.filter((c) => c.id !== id);
                if (remaining.length > 0) {
                    await handleSwitchConversation(remaining[0], isLoading);
                } else {
                    await handleNewChat(isLoading);
                }
            }
        },
        [activeConv, conversations, handleSwitchConversation, handleNewChat]
    );

    // Clear all
    const handleClearAll = useCallback(async (isLoading: boolean) => {
        if (isLoading) return;
        await deleteAllConversations();
        clearAllConvsFromCloud();
        setConversations([]);
        const newConv = createNewConversation();
        await saveConversation(newConv);
        await setActiveConversationId(newConv.id);
        setActiveConv(newConv);
        setMessages([]);
        setConversations([newConv]);
        setDrawerOpen(false);
    }, []);

    return {
        hasLoaded,
        conversations,
        activeConv,
        messages,
        setMessages,
        drawerOpen,
        setDrawerOpen,
        saveMessages,
        handleNewChat,
        handleSwitchConversation,
        handleDeleteConversation,
        handleClearAll,
        isSyncing,
    };
}
