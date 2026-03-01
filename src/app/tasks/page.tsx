"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { CheckSquare, Square, Mic, Calendar as CalendarIcon, Bell } from "lucide-react";
import { useActivities, Activity } from "@/hooks/useActivities";

export default function TasksPage() {
    const auth = useAuth();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const { activities, fetchActivities, isLoading, updateActivity } = useActivities();

    useEffect(() => {
        getAllConversations().then(setConversations);
        getActiveConversationId().then(setActiveId);
        if (localStorage.getItem('sandbox_enabled') === 'true') setIsAdmin(true);
        fetch('/api/admin/check').then(res => { if (res.ok) setIsAdmin(true); }).catch(() => { });
    }, []);

    useEffect(() => {
        if (auth.isActivated) {
            fetchActivities();
        }
    }, [auth.isActivated, fetchActivities]);

    const handleToggleStatus = async (activity: Activity) => {
        const newStatus = activity.status === 'completed' ? 'needs_action' : 'completed';
        await updateActivity(activity.id, { status: newStatus });
    };

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        window.location.href = '/';
    };

    const handleNew = async () => {
        window.location.href = '/';
    };

    if (!auth.isActivated) return null;

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
            <ConversationDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                conversations={conversations}
                activeId={activeId || undefined}
                onNew={handleNew}
                onSwitch={handleSwitch}
                onDelete={() => { }}
                onClearAll={() => { }}
                onMemory={() => { }}
                onOpenMemoryManager={() => { }}
                extractingMemories={new Set()}
                systemInstruction={""}
                setSystemInstruction={() => { }}
                defaultSystemInstruction={""}
                pushSystemInstruction={async () => { }}
                isAdmin={isAdmin}
                onOpenSandbox={() => { }}
            />

            {/* Header */}
            <header className="flex-none px-4 py-3 border-b border-white/5 flex items-center justify-between bg-card text-card-foreground z-10">
                <button onClick={() => setDrawerOpen(true)} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
                </button>
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">Tasks</h1>
                <div className="w-8" />
            </header>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    <div className="text-center text-sm text-zinc-500 py-10">加载中...</div>
                ) : activities.length === 0 ? (
                    <div className="text-center text-sm text-zinc-500 py-10">暂无待办事项</div>
                ) : (
                    activities.map((activity) => {
                        const isCompleted = activity.status === 'completed';

                        let bgClass = "bg-zinc-900 border-white/5";
                        let typeColor = "text-zinc-400 bg-zinc-500/10";
                        if (!isCompleted) {
                            if (activity.type === 'task') { bgClass = "bg-emerald-500/10 border-emerald-500/20"; typeColor = "text-emerald-400 bg-emerald-500/10"; }
                            if (activity.type === 'event') { bgClass = "bg-blue-500/10 border-blue-500/20"; typeColor = "text-blue-400 bg-blue-500/10"; }
                            if (activity.type === 'reminder') { bgClass = "bg-pink-500/10 border-pink-500/20"; typeColor = "text-pink-400 bg-pink-500/10"; }
                        } else {
                            bgClass = "bg-zinc-500/10 border-white/5 opacity-50";
                        }

                        return (
                            <div key={activity.id} className={`w-full flex items-center p-4 gap-3 rounded-xl border ${bgClass}`}>
                                <button onClick={() => handleToggleStatus(activity)} className="flex-shrink-0">
                                    {isCompleted ? (
                                        <CheckSquare size={20} className="text-emerald-500" />
                                    ) : (
                                        <Square size={20} className={activity.type === 'task' ? 'text-emerald-500/50' : activity.type === 'event' ? 'text-blue-500/50' : 'text-pink-500/50'} />
                                    )}
                                </button>
                                <div className="flex flex-col gap-1 w-full min-w-0">
                                    <span className={`text-[15px] font-medium truncate ${isCompleted ? 'text-zinc-500 line-through' : (activity.type === 'task' ? 'text-emerald-100' : activity.type === 'event' ? 'text-blue-100' : 'text-pink-100')}`}>
                                        {activity.title}
                                    </span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {(activity.start_time || activity.end_time) && (
                                            <span className={`text-[13px] ${isCompleted ? 'text-zinc-500' : (activity.type === 'task' ? 'text-emerald-400/80' : activity.type === 'event' ? 'text-blue-400/80' : 'text-pink-400/80')}`}>
                                                {activity.start_time ? new Date(activity.start_time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                                {activity.start_time && activity.end_time ? ' - ' : ''}
                                                {activity.end_time ? new Date(activity.end_time).toLocaleString('zh-CN', { ...(activity.start_time ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }) : ''}
                                            </span>
                                        )}
                                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded w-fit ${typeColor}`}>
                                            {activity.type}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* FAB */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
                <button className="w-14 h-14 bg-zinc-50 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                    <Mic size={24} className="text-zinc-950" />
                </button>
            </div>
        </main>
    );
}
