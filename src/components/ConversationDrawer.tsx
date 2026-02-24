import { useState } from "react";
import { Conversation } from "@/lib/conversations";
import versionData from "../../version.json";

interface ConversationDrawerProps {
    open: boolean;
    onClose: () => void;
    conversations: Conversation[];
    activeId: string | undefined;
    onNew: () => void;
    onSwitch: (conv: Conversation) => void;
    onDelete: (id: string) => void;
    onClearAll: () => void;
    onMemory: (id: string) => void;
    systemInstruction: string;
    setSystemInstruction: (value: string) => void;
    defaultSystemInstruction: string;
    pushSystemInstruction: (value: string) => Promise<void>;
}

export default function ConversationDrawer({
    open,
    onClose,
    conversations,
    activeId,
    onNew,
    onSwitch,
    onDelete,
    onClearAll,
    onMemory,
    systemInstruction,
    setSystemInstruction,
    defaultSystemInstruction,
    pushSystemInstruction,
}: ConversationDrawerProps) {
    const [showSystemInstruction, setShowSystemInstruction] = useState(false);

    return (
        <>
            {/* Drawer Overlay */}
            {open && (
                <div
                    className="absolute inset-0 bg-black/40 z-30 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Drawer */}
            <div
                className={`absolute top-0 left-0 h-full w-72 bg-card border-r z-40 flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"
                    }`}
            >
                {/* Drawer header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h2 className="text-sm font-semibold">会话列表</h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-muted transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* New Chat button */}
                <button
                    onClick={onNew}
                    className="mx-3 mt-3 flex items-center space-x-2 px-3 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/70 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    <span>新建会话</span>
                </button>

                {/* Conversation list */}
                <div className="flex-1 overflow-y-auto mt-2 px-2 space-y-1">
                    {conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className={`flex items-center rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${activeId === conv.id
                                ? "bg-foreground/10 text-foreground font-semibold"
                                : "hover:bg-muted text-foreground"
                                }`}
                            onClick={() => onSwitch(conv)}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm truncate font-medium">{conv.title}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {new Date(conv.updatedAt).toLocaleDateString("zh-CN", {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    })}
                                </p>
                            </div>
                            <div className="flex items-center ml-1 flex-shrink-0">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onMemory(conv.id);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-blue-500/10 text-muted-foreground/50 hover:text-blue-500 transition-all"
                                    title="持续记忆（提炼当前会话知识）"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /></svg>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('确定要删除这个会话吗？')) {
                                            onDelete(conv.id);
                                        }
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-500 transition-all"
                                    title="删除"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* System Instruction */}
                <div className="px-3 py-2 border-t">
                    <button
                        onClick={() => setShowSystemInstruction(!showSystemInstruction)}
                        className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors"
                    >
                        <span className="flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
                            系统指令
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showSystemInstruction ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    {showSystemInstruction && (
                        <div className="mt-2 space-y-2">
                            <textarea
                                value={systemInstruction}
                                onChange={(e) => {
                                    setSystemInstruction(e.target.value);
                                    localStorage.setItem('system-instruction', e.target.value);
                                }}
                                onBlur={() => pushSystemInstruction(systemInstruction)}
                                className="w-full h-32 text-xs bg-muted/50 border rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                                placeholder="输入系统指令..."
                            />
                            <button
                                onClick={() => {
                                    setSystemInstruction(defaultSystemInstruction);
                                    localStorage.setItem('system-instruction', defaultSystemInstruction);
                                    pushSystemInstruction(defaultSystemInstruction);
                                }}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                恢复默认
                            </button>
                        </div>
                    )}
                </div>

                {/* Clear all */}
                {conversations.length > 1 && (
                    <div className="px-3 py-3 border-t">
                        <button
                            onClick={onClearAll}
                            className="w-full text-xs text-muted-foreground hover:text-red-500 py-2 rounded-lg hover:bg-red-500/5 transition-colors"
                        >
                            清空所有会话
                        </button>
                    </div>
                )}

                {/* Version */}
                <div className="px-3 py-2 border-t">
                    <p className="text-[10px] text-muted-foreground/50 text-center">
                        v{versionData.major}.{versionData.minor}.{versionData.build}
                    </p>
                </div>
            </div>
        </>
    );
}
