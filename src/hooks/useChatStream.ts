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
    const [isImageGenerating, setIsImageGenerating] = useState(false);
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


    // Stop generation
    const stopGeneration = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setIsThinking(false);
        setIsImageGenerating(false);
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

        let progressInterval: NodeJS.Timeout | null = null;

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
            // Build messages for the chat API
            const coreMessages = newMessages.map((m: ChatMessage) => {
                const contentParts: any[] = [];
                const textContent = m.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
                if (textContent) contentParts.push({ type: 'text', text: textContent });
                if (m.images && m.images.length > 0) {
                    if (m.role === 'user') {
                        // Send user-uploaded images as-is
                        m.images.forEach((img) => {
                            contentParts.push({ type: 'image', image: img.data, mimeType: img.mimeType });
                        });
                    } else {
                        // For assistant-generated images, use text placeholder to avoid huge payloads
                        contentParts.push({ type: 'text', text: `[Generated ${m.images.length} image(s)]` });
                    }
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
            let toolCallDetected: { prompt: string; action?: string } | null = null;

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
                                } else if (payload.type === "tool-call" && payload.toolName === "generate_image") {
                                    // Model decided to generate an image!
                                    toolCallDetected = payload.args || { prompt: text };
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
                        } else if (line.startsWith("9:")) {
                            // Tool call format: 9:{"toolCallId":...,"toolName":"generate_image","args":{...}}
                            try {
                                const toolCall = JSON.parse(line.substring(2));
                                if (toolCall.toolName === "generate_image") {
                                    toolCallDetected = toolCall.args || { prompt: text };
                                }
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

            // Fallback: if model output text that looks like a JSON tool call instead of
            // using the actual tool, try to extract the prompt from it
            if (!toolCallDetected && streamedContent.trim()) {
                try {
                    // Match either pure JSON { ... "prompt" ... } or pseudo-syntax [generate_image: { ... "prompt" ... }]
                    const matchPattern = streamedContent.match(/(?:\[generate_image:\s*)?(\{[\s\S]*"(?:action_input|prompt)"[\s\S]*\})/i);
                    const jsonMatch = matchPattern ? matchPattern[1] : null;
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch);
                        let extractedPrompt = '';
                        if (parsed.action_input) {
                            try {
                                const inner = typeof parsed.action_input === 'string'
                                    ? JSON.parse(parsed.action_input)
                                    : parsed.action_input;
                                extractedPrompt = inner.prompt || '';
                            } catch {
                                extractedPrompt = parsed.action_input;
                            }
                        }
                        if (!extractedPrompt && parsed.prompt) {
                            extractedPrompt = parsed.prompt;
                        }
                        if (extractedPrompt) {
                            let action = 'generate';
                            if (parsed.action) action = parsed.action;
                            else if (typeof parsed.action_input === 'object' && parsed.action_input !== null && parsed.action_input.action) {
                                action = parsed.action_input.action;
                            }
                            toolCallDetected = { prompt: extractedPrompt, action };
                            // Keep any text before the tool as the model's regular response
                            const matchIndex = matchPattern ? matchPattern.index || 0 : 0;
                            const beforeJson = streamedContent.substring(0, matchIndex).trim();
                            streamedContent = beforeJson;
                        }
                    }
                } catch {
                    // Not valid JSON, that's fine — it's regular text
                }
            }

            // If a generate_image tool call was detected, call the image generation API
            if (toolCallDetected) {
                // Remove text thinking, show image skeleton instead
                setIsThinking(false);
                setThinkingText("");
                setIsImageGenerating(true);

                const history = newMessages.slice(0, -1).map((m: ChatMessage) => ({
                    role: m.role,
                    text: m.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "",
                }));

                // Only send images that the user explicitly uploaded in this request.
                // We no longer automatically chain previous assistant images to avoid unintended prompt mashups,
                // unless the user strictly intended to edit the previous image.
                let imagesToSend = currentImages.length > 0 ? currentImages : undefined;

                let isEditIntent = toolCallDetected.action === 'edit';
                // Fallback heuristic: If the prompt contains strong editing verbs, assume it's an edit
                if (!isEditIntent && toolCallDetected.prompt) {
                    const p = toolCallDetected.prompt.toLowerCase();
                    if (p.includes('edit') || p.includes('change') || p.includes('modify') || p.includes('修改') || p.includes('换成') || p.includes('加上') || p.includes('去掉') || p.includes('把')) {
                        isEditIntent = true;
                    }
                }

                if (isEditIntent) {
                    if (!imagesToSend) {
                        // Find the most recent message in the chat history that had an image,
                        // regardless of whether it was uploaded by the user or generated by the assistant.
                        const lastMsgWithImages = [...messages].reverse().find(m => m.images && m.images.length > 0);
                        if (lastMsgWithImages && lastMsgWithImages.images) {
                            imagesToSend = lastMsgWithImages.images;
                        }
                    }
                }

                const imgResponse = await fetch('/api/generate-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({
                        prompt: toolCallDetected.prompt,
                        history,
                        images: imagesToSend,
                    }),
                    signal: controller.signal,
                });

                if (!imgResponse.ok) {
                    setIsImageGenerating(false);
                    if (imgResponse.status === 401) {
                        handleUnauthorized();
                        return;
                    }
                    const errData = await imgResponse.json().catch(() => ({}));
                    throw new Error(errData.error || `Image Gen Error: ${imgResponse.status}`);
                }

                const imgData = await imgResponse.json();
                setIsImageGenerating(false);

                const imgTextParts = imgData.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n') || '';
                const imgImageParts = imgData.parts?.filter((p: any) => p.type === 'image') || [];

                // Combine any streamed text with image results
                const combinedText = [streamedContent, imgTextParts].filter(Boolean).join('\n');

                const imgAssistantMessage: ChatMessage = {
                    id: (Date.now() + 2).toString(),
                    role: "assistant",
                    parts: [{ type: "text", text: combinedText }],
                    images: imgImageParts.map((p: any) => ({ data: p.data, mimeType: p.mimeType })),
                    thinking: thinkingContent,
                };

                const finalMessages = [...newMessages, imgAssistantMessage];
                setMessages(finalMessages);
                await saveMessages(finalMessages);
            } else {
                // Save final text-only messages
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
            setIsImageGenerating(false);
            setThinkingText("");
            abortControllerRef.current = null;
        }
    }, [messages, pendingImages, isLoading, getAuthHeaders, handleUnauthorized, model, systemInstruction, setMessages, saveMessages]);

    return {
        isLoading,
        isThinking,
        isImageGenerating,
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
