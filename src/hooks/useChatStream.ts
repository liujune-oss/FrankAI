"use client";

import { useState, useRef, useCallback } from "react";
import { ChatMessage } from "@/types/chat";

interface UseChatStreamOptions {
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    saveMessages: (msgs: ChatMessage[]) => Promise<void>;
    getAuthHeaders: () => Record<string, string>;
    handleUnauthorized: () => void;
    model: string;
    systemInstruction: string;
}

export function useChatStream({
    messages,
    setMessages,
    saveMessages,
    getAuthHeaders,
    handleUnauthorized,
    model,
    systemInstruction,
}: UseChatStreamOptions) {
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingText, setThinkingText] = useState("");
    const [error, setError] = useState<Error | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingImages, setPendingImages] = useState<{ data: string; mimeType: string }[]>([]);

    const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
    }, []);

    // Detect image generation request
    const isImageGenRequest = useCallback((text: string): boolean => {
        const lower = text.toLowerCase();
        const directKeywords = ['画一', '画个', '画张', '画幅', '绘制', '作画', '做一张图', '做个图', '做一幅',
            'draw ', 'paint ', 'sketch ', 'illustrate '];
        if (directKeywords.some((k) => lower.includes(k))) return true;
        const genVerbs = ['生成', '创建', '创作', '制作', '设计', '做', 'generate', 'create', 'make', 'design'];
        const imageNouns = ['图', '图片', '图像', '照片', '插画', '插图', '海报', '壁纸', '头像', '封面',
            'image', 'picture', 'photo', 'poster', 'wallpaper', 'avatar', 'icon', 'illustration'];
        const hasVerb = genVerbs.some((v) => lower.includes(v));
        const hasNoun = imageNouns.some((n) => lower.includes(n));
        return hasVerb && hasNoun;
    }, []);

    // Stop generation
    const stopGeneration = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setIsThinking(false);
        setThinkingText("");
    }, []);

    // Send message
    const sendMessage = useCallback(async (text: string, userHasScrolledUp: React.MutableRefObject<boolean>) => {
        if ((!text.trim() && pendingImages.length === 0) || isLoading) return;
        setIsLoading(true);
        setIsThinking(true);
        setThinkingText("");
        setError(null);
        userHasScrolledUp.current = false;

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

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
            const lastMsgHadImages = lastAssistantMsg?.images && lastAssistantMsg.images.length > 0;
            const exitImageMode = /^(文字模式|退出图片|\/text|\/chat)/i.test(text.trim());
            const shouldGenImage = !exitImageMode && (isImageGenRequest(text) || !!lastMsgHadImages) && currentImages.length === 0;

            if (shouldGenImage) {
                // Image generation path
                setThinkingText("正在用 Nano Banana 生成图片...");

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
                    if (response.status === 401) {
                        handleUnauthorized();
                        return;
                    }
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP Error: ${response.status}`);
                }

                const data = await response.json();
                setIsThinking(false);

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
                // Regular streaming chat path
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

                if (!response.ok) {
                    if (response.status === 401) {
                        handleUnauthorized();
                        return;
                    }
                    throw new Error(`HTTP Error: ${response.status}`);
                }

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
    }, [messages, pendingImages, isLoading, getAuthHeaders, handleUnauthorized, model, systemInstruction, isImageGenRequest, setMessages, saveMessages]);

    return {
        isLoading,
        isThinking,
        thinkingText,
        error,
        setError,
        pendingImages,
        setPendingImages,
        fileInputRef,
        handleImageUpload,
        sendMessage,
        stopGeneration,
    };
}
