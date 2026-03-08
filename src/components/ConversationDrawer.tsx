import { useState } from "react";
import { Conversation } from "@/lib/conversations";
import versionData from "../../version.json";
import { Beaker, CheckSquare, Calendar, MessageSquare, FolderKanban, Settings, RefreshCw, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
    onOpenMemoryManager: () => void;
    extractingMemories: Set<string>;
    systemInstruction: string;
    setSystemInstruction: (value: string) => void;
    defaultSystemInstruction: string;
    pushSystemInstruction: (value: string) => Promise<void>;
    isAdmin: boolean;
    onOpenSandbox: () => void;
}

export default function ConversationDrawer({
    open,
    onClose,
    conversations,
    activeId,
    onNew,
    onSwitch,
    onDelete,
    isAdmin,
    onOpenSandbox,
}: ConversationDrawerProps) {
    const [showSettings, setShowSettings] = useState(false);
    const pathname = usePathname();

    const navItems = [
        { href: "/",         icon: <MessageSquare size={16} />, label: "对话 (Chat)" },
        { href: "/tasks",    icon: <CheckSquare size={16} />,   label: "待办 (Tasks)" },
        { href: "/calendar", icon: <Calendar size={16} />,      label: "日程 (Calendar)" },
        { href: "/projects", icon: <FolderKanban size={16} />,  label: "项目 (Projects)" },
    ];

    return (
        <>
            {open && (
                <div className="absolute inset-0 bg-black/40 z-30 transition-opacity" onClick={onClose} />
            )}

            <div className={`absolute top-0 left-0 h-full w-72 bg-card border-r z-40 flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b flex-none">
                    <span className="text-sm font-bold tracking-tight">FrankAI</span>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* New conversation */}
                <div className="px-3 pt-3 pb-2 flex-none">
                    <button
                        onClick={onNew}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/70 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                        新建会话
                    </button>
                </div>

                {/* Scrollable area */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-4">

                    {/* Navigation */}
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground px-3 pt-1 pb-1">导航</p>
                        <div className="space-y-0.5">
                            {navItems.map(item => {
                                const isActive = item.href === "/"
                                    ? pathname === "/"
                                    : pathname === item.href || pathname.startsWith(item.href + "/");
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={onClose}
                                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${isActive ? "bg-foreground/10 text-foreground font-semibold" : "hover:bg-muted text-foreground"}`}
                                    >
                                        {item.icon}
                                        <span className="text-sm font-medium">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>

                    {/* Conversation history */}
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground px-3 pb-1">历史对话</p>
                        <div className="space-y-0.5">
                            {conversations.map((conv) => (
                                <div
                                    key={conv.id}
                                    className={`flex items-center rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${activeId === conv.id ? "bg-foreground/10 text-foreground font-semibold" : "hover:bg-muted text-foreground"}`}
                                    onClick={() => onSwitch(conv)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm truncate font-medium">{conv.title}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            {new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </p>
                                    </div>
                                    <button
                                        onClick={e => { e.stopPropagation(); if (confirm('确定要删除这个会话吗？')) onDelete(conv.id); }}
                                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-500 transition-all flex-shrink-0"
                                        title="删除"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Bottom: Settings (collapsible) + version */}
                <div className="flex-none border-t">
                    <button
                        onClick={() => setShowSettings(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <Settings size={14} />
                            设置
                        </span>
                        <ChevronDown size={14} className={`transition-transform ${showSettings ? "rotate-180" : ""}`} />
                    </button>

                    {showSettings && (
                        <div className="px-3 pb-3 space-y-1">
                            <button
                                onClick={() => {
                                    if ('serviceWorker' in navigator) {
                                        navigator.serviceWorker.getRegistrations().then(regs => {
                                            regs.forEach(r => r.unregister());
                                            window.location.reload();
                                        });
                                    } else {
                                        window.location.reload();
                                    }
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                            >
                                <RefreshCw size={13} />
                                强制刷新缓存
                            </button>

                            {isAdmin && (
                                <button
                                    onClick={() => { onClose(); onOpenSandbox(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-purple-400 hover:text-purple-300 rounded-lg hover:bg-purple-500/10 transition-colors"
                                >
                                    <Beaker size={13} />
                                    技能靶场
                                </button>
                            )}
                        </div>
                    )}

                    <p className="text-[10px] text-muted-foreground/40 text-center pb-3">
                        v{versionData.major}.{versionData.minor}.{versionData.build}
                    </p>
                </div>
            </div>
        </>
    );
}
