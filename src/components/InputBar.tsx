import { RefObject, useRef, useEffect } from "react";

interface ChatModelOption {
    id: string;
    label: string;
    group: string;
}

interface InputBarProps {
    input: string;
    setInput: (value: string) => void;
    onSend: (text: string) => void;
    onStop: () => void;
    isLoading: boolean;
    isThinking: boolean;
    model: string;
    setModel: (value: string) => void;
    availableModels: ChatModelOption[];
    pendingImages: { data: string; mimeType: string }[];
    setPendingImages: React.Dispatch<React.SetStateAction<{ data: string; mimeType: string }[]>>;
    onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: RefObject<HTMLInputElement | null>;
}

export default function InputBar({
    input,
    setInput,
    onSend,
    onStop,
    isLoading,
    isThinking,
    model,
    setModel,
    availableModels,
    pendingImages,
    setPendingImages,
    onImageUpload,
    fileInputRef,
}: InputBarProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (input === "" && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, [input]);

    return (
        <div className="flex-none px-3 pt-2 pb-3 bg-background">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onImageUpload}
            />

            {/* Pending image preview */}
            {pendingImages.length > 0 && (
                <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
                    {pendingImages.map((img, idx) => (
                        <div key={idx} className="relative flex-shrink-0">
                            <img
                                src={`data:${img.mimeType};base64,${img.data}`}
                                alt="pending"
                                className="h-16 w-16 rounded-xl object-cover border"
                            />
                            <button
                                type="button"
                                onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    if (isLoading) { onStop(); return; }
                    if (!input.trim() && pendingImages.length === 0) return;
                    onSend(input);
                }}
                className="bg-muted/60 border border-input rounded-3xl overflow-hidden transition-all focus-within:border-primary/50 focus-within:bg-muted/80"
            >
                {/* Text input - auto-expanding textarea */}
                <textarea
                    ref={textareaRef}
                    className="w-full bg-transparent px-5 pt-3.5 pb-2 outline-none text-base placeholder:text-muted-foreground/60 resize-none overflow-hidden"
                    value={input}
                    placeholder="问问 Gemini"
                    rows={1}
                    style={{ maxHeight: '200px', overflowY: input.split('\n').length > 6 ? 'auto' : 'hidden' }}
                    onChange={(e) => {
                        setInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (isLoading) { onStop(); return; }
                            if (!input.trim() && pendingImages.length === 0) return;
                            onSend(input);
                            (e.target as HTMLTextAreaElement).style.height = 'auto';
                        }
                    }}
                />
                {/* Bottom toolbar */}
                <div className="flex items-center justify-between px-3 pb-2.5">
                    <div className="flex items-center space-x-1.5">
                        {/* Image upload button */}
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="p-1.5 rounded-full hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                            title="上传图片"
                            disabled={isLoading}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                        </button>
                        {/* Model selector badge */}
                        <select
                            className="appearance-none cursor-pointer text-[11px] text-muted-foreground bg-background/80 border border-input rounded-full pl-2.5 pr-5 py-0.5 outline-none hover:bg-muted transition-colors"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            disabled={isLoading}
                        >
                            {(() => {
                                const groups = new Map<string, ChatModelOption[]>();
                                availableModels.forEach(m => {
                                    if (!groups.has(m.group)) groups.set(m.group, []);
                                    groups.get(m.group)!.push(m);
                                });
                                return Array.from(groups.entries()).map(([group, models]) => (
                                    <optgroup key={group} label={group}>
                                        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </optgroup>
                                ));
                            })()}
                        </select>
                        {/* Status indicator */}
                        {isLoading && (
                            <span className="inline-flex items-center space-x-1 text-[11px] text-amber-500 px-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                <span>{isThinking ? '思考中' : '回复中'}</span>
                            </span>
                        )}
                    </div>
                    <div className="flex items-center space-x-1">
                        {isLoading ? (
                            <button
                                type="submit"
                                className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                                title="停止生成"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                    <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                disabled={!input.trim() && pendingImages.length === 0}
                                type="submit"
                                className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                            </button>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}
