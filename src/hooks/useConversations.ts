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

const LAST_SYNC_TS_KEY = "conv_last_sync_ts";
/** 首次同步用 epoch，拉取全量 */
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

function getLastSyncTs(): string {
    if (typeof window === "undefined") return EPOCH_ISO;
    return localStorage.getItem(LAST_SYNC_TS_KEY) || EPOCH_ISO;
}

function setLastSyncTs(isoTs: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(LAST_SYNC_TS_KEY, isoTs);
}

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
    if (!headers["x-activation-token"]) return;
    fetch("/api/conversations/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation: stripImages(conv) }),
    }).catch(() => {});
}

// 防抖 Map：convId → timer，消息停止变化 3s 后才真正上传
const syncDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

/** 防抖版上传：同一会话 3s 内多次调用只触发最后一次 */
function syncConvToCloudDebounced(conv: Conversation): void {
    const prev = syncDebounceMap.get(conv.id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
        syncDebounceMap.delete(conv.id);
        syncConvToCloud(conv);
    }, 3000);
    syncDebounceMap.set(conv.id, timer);
}

/** 后台写墓碑（服务端保留记录但清空内容），不阻塞 UI */
function deleteConvFromCloud(id: string): void {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return;
    fetch("/api/conversations/sync", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
    }).catch(() => {});
}

/** 后台清空云端全部对话（用户主动操作，真删） */
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
 * 增量同步：
 * 1. 用 last_sync_ts 拉取云端变化（含墓碑）
 * 2. 墓碑 → 本地删除；活跃记录 → 后写优先 upsert
 * 3. 全量同步时（首次/重置），将本地独有对话推回云端
 * 4. 用响应中的 serverTime 更新 last_sync_ts（用服务器时钟，避免偏差）
 */
async function mergeWithCloud(localConvs: Conversation[]): Promise<Conversation[]> {
    const headers = getCloudAuthHeaders();
    if (!headers["x-activation-token"]) return localConvs;

    const since = getLastSyncTs();
    const isFullSync = since === EPOCH_ISO;

    type CloudConv = Conversation & { deletedAt: number | null };
    let cloudChanges: CloudConv[] = [];
    let serverTime = new Date().toISOString();

    try {
        const url = isFullSync
            ? "/api/conversations/sync"
            : `/api/conversations/sync?since=${encodeURIComponent(since)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return localConvs;
        const data = await res.json();
        cloudChanges = data.conversations ?? [];
        if (data.serverTime) serverTime = data.serverTime;
    } catch {
        return localConvs; // 网络异常时静默降级
    }

    const localMap = new Map(localConvs.map((c) => [c.id, c]));

    for (const change of cloudChanges) {
        if (change.deletedAt) {
            // 墓碑 → 删除本地
            await deleteConversation(change.id);
            localMap.delete(change.id);
        } else {
            // 活跃 → 后写优先：云端更新则覆盖本地
            const local = localMap.get(change.id);
            if (!local || change.updatedAt > local.updatedAt) {
                await saveConversation(change);
                localMap.set(change.id, change);
            }
        }
    }

    // 全量同步时：本地独有对话（未曾推送到云端）→ 推回云端
    if (isFullSync) {
        const cloudIds = new Set(cloudChanges.map((c) => c.id));
        for (const local of localConvs) {
            if (!cloudIds.has(local.id)) {
                syncConvToCloud(local);
            }
        }
    }

    setLastSyncTs(serverTime);
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

    // 拉云端并合并到本地，更新列表
    const syncFromCloud = useCallback(async () => {
        const localConvs = await getAllConversations();
        setIsSyncing(true);
        const mergedConvs = await mergeWithCloud(localConvs);
        setIsSyncing(false);
        setConversations(mergedConvs);
    }, []);

    // 抽屉打开时触发一次云端同步
    useEffect(() => {
        if (drawerOpen) syncFromCloud();
    }, [drawerOpen, syncFromCloud]);

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
            syncConvToCloudDebounced(updated); // 防抖 3s，减少 API 调用
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
