import { useState } from "react";
import { Conversation } from "@/lib/conversations";
import versionData from "../../version.json";
import { Beaker, CheckSquare, Calendar, FolderKanban, Settings, RefreshCw, ChevronDown, BrainCircuit, Plus, Trash2, CloudOff } from "lucide-react";
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
    onClearCloud?: () => void;
}

const NAV_ITEMS = [
    { href: "/tasks",    icon: <CheckSquare size={20} />,   label: "活动",  activeColor: "text-emerald-400", activeBg: "bg-emerald-500/10", activeIconBg: "bg-emerald-500/25 shadow-emerald-500/20" },
    { href: "/calendar", icon: <Calendar size={20} />,      label: "日历",  activeColor: "text-blue-400",    activeBg: "bg-blue-500/10",    activeIconBg: "bg-blue-500/25 shadow-blue-500/20" },
    { href: "/projects", icon: <FolderKanban size={20} />,  label: "项目",  activeColor: "text-indigo-400",  activeBg: "bg-indigo-500/10",  activeIconBg: "bg-indigo-500/25 shadow-indigo-500/20" },
];

export default function ConversationDrawer({
    open,
    onClose,
    conversations,
    activeId,
    onNew,
    onSwitch,
    onDelete,
    onOpenMemoryManager,
    isAdmin,
    onOpenSandbox,
    onClearCloud,
}: ConversationDrawerProps) {
    const [showSettings, setShowSettings] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingClearCloud, setPendingClearCloud] = useState(false);
    const pathname = usePathname();

    return (
        <>
            {open && (
                <div className="absolute inset-0 bg-black/40 z-30 transition-opacity" onClick={onClose} />
            )}

            <div className={`absolute top-0 left-0 h-full w-72 bg-card border-r z-40 flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}>

                {/* ── Fixed top ─────────────────────────────────────────────── */}

                {/* Header */}
                <div className="flex-none flex items-center justify-between px-4 py-3 border-b">
                    <span className="text-sm font-bold tracking-tight">FrankAI</span>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>

                {/* Nav cards */}
                <div className="flex-none grid grid-cols-3 gap-2 px-3 py-3 border-b">
                    {NAV_ITEMS.map(item => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={onClose}
                                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all ${isActive ? `${item.activeColor} ${item.activeBg}` : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"}`}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-sm ${isActive ? `${item.activeIconBg} shadow` : "bg-white/5 group-hover:bg-white/10"}`}>
                                    {item.icon}
                                </div>
                                <span className="text-[11px] font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>

                {/* New conversation — fixed */}
                <div className="flex-none px-3 pt-3 pb-2">
                    <p className="text-[11px] font-semibold text-muted-foreground/60 px-1 mb-2 uppercase tracking-wide">对话</p>
                    <button
                        onClick={onNew}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/70 transition-colors"
                    >
                        <Plus size={15} />
                        新建会话
                    </button>
                </div>

                {/* ── Scrollable conversation list ──────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 min-h-0">
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`flex items-center rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${activeId === conv.id ? "bg-foreground/10 text-foreground font-semibold" : "hover:bg-muted text-foreground"}`}
                            onClick={() => { setPendingDeleteId(null); onSwitch(conv); }}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm truncate font-medium">{conv.title}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </p>
                            </div>
                            {pendingDeleteId === conv.id ? (
                                <button
                                    onClick={e => { e.stopPropagation(); onDelete(conv.id); setPendingDeleteId(null); }}
                                    className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-[11px] font-semibold flex-shrink-0 transition-all"
                                >
                                    确认
                                </button>
                            ) : (
                                <button
                                    onClick={e => { e.stopPropagation(); setPendingDeleteId(conv.id); }}
                                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-500 transition-all flex-shrink-0"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {/* ── Fixed bottom ──────────────────────────────────────────── */}
                <div className="flex-none border-t">
                    {isAdmin && (
                    <button
                        onClick={() => setShowSettings(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <span className="flex items-center gap-2"><Settings size={14} />设置</span>
                        <ChevronDown size={14} className={`transition-transform ${showSettings ? "rotate-180" : ""}`} />
                    </button>
                    )}

                    {isAdmin && showSettings && (
                        <div className="px-3 pb-3 space-y-1">
                            <button
                                onClick={() => { onClose(); onOpenMemoryManager(); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-400 hover:text-blue-300 rounded-lg hover:bg-blue-500/10 transition-colors"
                            >
                                <BrainCircuit size={13} />记忆管理
                            </button>
                            <button
                                onClick={() => {
                                    if ("serviceWorker" in navigator) {
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
                                <RefreshCw size={13} />强制刷新缓存
                            </button>
                            {pendingClearCloud ? (
                                <div className="flex items-center gap-1 px-3 py-2">
                                    <span className="text-xs text-red-400 flex-1">确认清空云端？</span>
                                    <button
                                        onClick={() => { onClearCloud?.(); setPendingClearCloud(false); }}
                                        className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-500/20 text-red-400"
                                    >确认</button>
                                    <button
                                        onClick={() => setPendingClearCloud(false)}
                                        className="text-[11px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-400"
                                    >取消</button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setPendingClearCloud(true)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400/70 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                                >
                                    <CloudOff size={13} />清空云端记录
                                </button>
                            )}
                            <button
                                onClick={() => { onClose(); onOpenSandbox(); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-purple-400 hover:text-purple-300 rounded-lg hover:bg-purple-500/10 transition-colors"
                            >
                                <Beaker size={13} />技能靶场
                            </button>
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
