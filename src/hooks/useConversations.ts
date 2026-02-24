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

export function useConversations() {
    const [hasLoaded, setHasLoaded] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConv, setActiveConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Initialization
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
                    const newConv = createNewConversation();
                    await saveConversation(newConv);
                    await setActiveConversationId(newConv.id);
                    setActiveConv(newConv);
                    setMessages([]);
                    setConversations([newConv, ...allConvs]);
                }
            } else {
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
    };
}
