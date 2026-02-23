import { get, set, del, keys } from "idb-keyval";

export interface Conversation {
    id: string;
    title: string;
    messages: any[];
    createdAt: number;
    updatedAt: number;
}

const CONV_PREFIX = "conv-";
const ACTIVE_KEY = "active-conversation-id";

function convKey(id: string) {
    return `${CONV_PREFIX}${id}`;
}

export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export async function getAllConversations(): Promise<Conversation[]> {
    const allKeys = await keys();
    const convKeys = (allKeys as string[]).filter((k) => k.startsWith(CONV_PREFIX));
    const conversations: Conversation[] = [];
    for (const key of convKeys) {
        const conv = await get(key);
        if (conv) conversations.push(conv);
    }
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<Conversation | null> {
    return (await get(convKey(id))) || null;
}

export async function saveConversation(conv: Conversation): Promise<void> {
    conv.updatedAt = Date.now();
    await set(convKey(conv.id), conv);
}

export async function deleteConversation(id: string): Promise<void> {
    await del(convKey(id));
    const activeId = await getActiveConversationId();
    if (activeId === id) {
        await del(ACTIVE_KEY);
    }
}

export async function deleteAllConversations(): Promise<void> {
    const allKeys = await keys();
    const convKeys = (allKeys as string[]).filter((k) => k.startsWith(CONV_PREFIX));
    for (const key of convKeys) {
        await del(key);
    }
    await del(ACTIVE_KEY);
}

export function createNewConversation(): Conversation {
    return {
        id: generateId(),
        title: "新会话",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export async function getActiveConversationId(): Promise<string | null> {
    return (await get(ACTIVE_KEY)) || null;
}

export async function setActiveConversationId(id: string): Promise<void> {
    await set(ACTIVE_KEY, id);
}

export function autoTitle(messages: any[]): string {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return "新会话";
    const text = firstUserMsg.parts
        ?.map((p: any) => p.text)
        .filter(Boolean)
        .join(" ") || "";
    if (!text) return "新会话";
    return text.length > 30 ? text.substring(0, 30) + "..." : text;
}
