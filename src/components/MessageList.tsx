"use client";

import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage } from "@/types/chat";

interface MessageListProps {
    messages: ChatMessage[];
    isLoading: boolean;
    isThinking: boolean;
    thinkingText: string;
    error: Error | null;
}

export default function MessageList({
    messages,
    isLoading,
    isThinking,
    thinkingText,
    error,
}: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledUp = useRef(false);

    const scrollToBottom = useCallback(() => {
        if (!userHasScrolledUp.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, []);

    const handleChatScroll = useCallback(() => {
        const el = chatContainerRef.current;
        if (!el) return;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        userHasScrolledUp.current = !isNearBottom;
    }, []);

    // Auto-scroll on new content
    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading, isThinking, thinkingText, scrollToBottom]);

    // Reset scroll lock when loading finishes
    useEffect(() => {
        if (!isLoading) {
            userHasScrolledUp.current = false;
        }
    }, [isLoading]);

    return (
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
                            {/* Images */}
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
    );
}
