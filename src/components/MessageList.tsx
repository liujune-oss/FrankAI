"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage } from "@/types/chat";

interface MessageListProps {
    messages: ChatMessage[];
    isLoading: boolean;
    isThinking: boolean;
    isImageGenerating?: boolean;
    thinkingText: string;
    error: Error | null;
}

export default function MessageList({
    messages,
    isLoading,
    isThinking,
    isImageGenerating,
    thinkingText,
    error,
}: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledUp = useRef(false);
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

    const handleDownload = useCallback(() => {
        if (!lightboxSrc) return;
        const a = document.createElement('a');
        a.href = lightboxSrc;
        a.download = `image-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }, [lightboxSrc]);

    // Close lightbox on ESC
    useEffect(() => {
        if (!lightboxSrc) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxSrc(null); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [lightboxSrc]);

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
    }, [messages, isLoading, isThinking, isImageGenerating, thinkingText, scrollToBottom]);

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
                    let content = m.parts
                        .filter((p) => p.type === "text")
                        .map((p) => (p as any).text)
                        .join("\n");

                    // Filter out the internal text placeholder used for image payloads
                    content = content.replace(/\[Generated \d+ image\(s\)\]\n?/g, "");

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
                            {/* Images (For User Uploads) */}
                            {m.role === "user" && m.images && m.images.length > 0 && (
                                <div className="flex w-full justify-end mb-1">
                                    <div className="flex flex-wrap gap-2 max-w-[85%]">
                                        {m.images.map((img, idx) => {
                                            const src = `data:${img.mimeType};base64,${img.data}`;
                                            return (
                                                <img
                                                    key={idx}
                                                    src={src}
                                                    alt="uploaded"
                                                    onClick={() => setLightboxSrc(src)}
                                                    className="rounded-xl max-h-48 max-w-[200px] object-cover border cursor-pointer hover:opacity-90 hover:shadow-lg transition-all active:scale-95"
                                                />
                                            );
                                        })}
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
                                    {/* Final Image Rendering */}
                                    {m.images && m.images.length > 0 && (
                                        <div className="mt-2 space-y-2">
                                            <div className="flex flex-wrap gap-2">
                                                {m.images.map((img, idx) => {
                                                    const src = `data:${img.mimeType};base64,${img.data}`;
                                                    return (
                                                        <img
                                                            key={idx}
                                                            src={src}
                                                            alt="Generated Image"
                                                            onClick={() => setLightboxSrc(src)}
                                                            className="rounded-xl w-[85%] sm:w-[320px] aspect-square object-cover shadow-sm border cursor-pointer hover:opacity-95 hover:shadow-md transition-all"
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })
            )}



            {/* Image Generating Skeleton */}
            {isImageGenerating && (
                <div className="flex w-full justify-start mt-4 mb-2">
                    <div className="w-[85%] sm:w-[320px] aspect-square rounded-2xl overflow-hidden relative shadow-sm border border-border/50 bg-muted/30">
                        {/* Shimmer Background */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-muted/20 via-muted-foreground/10 to-muted/20 animate-pulse" />

                        {/* Center Icon */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/40">
                            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse mb-3">
                                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                                <circle cx="9" cy="9" r="2" />
                                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                            </svg>
                            <span className="text-xs font-medium tracking-wide animate-pulse">正在渲染图像...</span>
                        </div>
                    </div>
                </div>
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

            {isLoading && !isThinking && !isImageGenerating && messages[messages.length - 1]?.role === "user" && (
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

            {/* Lightbox */}
            {lightboxSrc && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setLightboxSrc(null)}
                >
                    {/* Toolbar */}
                    <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium backdrop-blur-sm transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            下载
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}
                            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                    </div>
                    {/* Image */}
                    <img
                        src={lightboxSrc}
                        alt="preview"
                        onClick={(e) => e.stopPropagation()}
                        className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl object-contain"
                    />
                </div>
            )}
        </div>
    );
}
