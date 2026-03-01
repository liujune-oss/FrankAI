"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { useActivities, Activity } from "@/hooks/useActivities";
import { isSameDay, addDays, format, startOfToday, parseISO } from "date-fns";

export default function CalendarPage() {
    const auth = useAuth();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    // Default selected date to today
    const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());

    const { activities, fetchActivities, isLoading } = useActivities();

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

    // Generate upcoming dates (e.g., today + next 14 days)
    const dateTape = useMemo(() => {
        const today = startOfToday();
        const start = addDays(today, -3); // start 3 days ago for some past context
        return Array.from({ length: 30 }).map((_, i) => addDays(start, i));
    }, []);

    // Helper: Which date does an activity belong to?
    const getActivityDate = (activity: Activity) => {
        if (activity.start_time) return parseISO(activity.start_time);
        if (activity.end_time) return parseISO(activity.end_time);
        return parseISO(activity.created_at); // Fallback but mostly calendar shouldn't show no-time items
    };

    // Filter out activities that have neither start_time nor end_time
    const calendarActivities = useMemo(() => {
        return activities.filter(a => a.start_time || a.end_time);
    }, [activities]);

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        window.location.href = '/';
    };

    const handleNew = async () => {
        window.location.href = '/';
    };

    if (!auth.isActivated) return null;

    // Build dots and group activities by day
    const getDotsForDate = (date: Date) => {
        const dayActivities = calendarActivities.filter(a => isSameDay(getActivityDate(a), date));
        const colors = new Set<string>();
        dayActivities.forEach(a => {
            if (a.type === 'task') colors.add('bg-emerald-500');
            else if (a.type === 'event') colors.add('bg-blue-500');
            else if (a.type === 'reminder') colors.add('bg-pink-500');
        });
        return Array.from(colors);
    };

    // Activities for the currently selected date
    const selectedDayActivities = calendarActivities.filter(a => isSameDay(getActivityDate(a), selectedDate));

    // Sort by time
    selectedDayActivities.sort((a, b) => getActivityDate(a).getTime() - getActivityDate(b).getTime());

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
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">Calendar</h1>
                <div className="w-8" />
            </header>

            {/* Date Scroll Tape */}
            <div
                className="w-full overflow-x-auto border-b border-white/5 flex px-4 py-3 gap-2 hide-scrollbar"
                onWheel={(e) => {
                    if (e.deltaY !== 0) {
                        e.currentTarget.scrollLeft += e.deltaY;
                    }
                }}
            >
                {dateTape.map((date, i) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const dots = getDotsForDate(date);
                    return (
                        <div
                            key={i}
                            onClick={() => setSelectedDate(date)}
                            className={`flex flex-col items-center min-w-[56px] py-2 px-1 rounded-xl cursor-pointer transition-colors ${isSelected ? 'bg-zinc-50' : 'hover:bg-zinc-900'}`}
                        >
                            <span className={`text-[10px] font-semibold mb-1 ${isSelected ? 'text-zinc-900' : 'text-zinc-500'}`}>{format(date, 'EEE')}</span>
                            <span className={`text-base font-semibold mb-1.5 ${isSelected ? 'text-zinc-900' : 'text-zinc-50'}`}>{format(date, 'd')}</span>
                            <div className="flex gap-0.5 h-1">
                                {dots.length > 0 ? (
                                    dots.map((dotClass, idx) => (
                                        <div key={idx} className={`w-1 h-1 rounded-full ${dotClass}`} />
                                    ))
                                ) : (
                                    <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-zinc-900' : 'bg-transparent'}`} />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Timeline List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                <div className="flex flex-col gap-4">
                    <h2 className="text-sm font-semibold text-zinc-50 tracking-wide">{format(selectedDate, 'EEEE, MMM d, yyyy')}</h2>

                    {isLoading ? (
                        <div className="text-sm text-zinc-500 py-4 text-center">加载数据中...</div>
                    ) : selectedDayActivities.length === 0 ? (
                        <div className="text-sm text-zinc-500 py-4 text-center">今天没有安排任何日程</div>
                    ) : (
                        selectedDayActivities.map(activity => {
                            let bgClass = "bg-zinc-900 border-white/5 border-l-zinc-500";
                            let textClass = "text-zinc-100";
                            let subtitleClass = "text-zinc-400";

                            if (activity.type === 'task') { bgClass = "bg-emerald-500/10 border-emerald-500/20 border-l-emerald-500"; textClass = "text-emerald-100"; subtitleClass = "text-emerald-400/80"; }
                            else if (activity.type === 'event') { bgClass = "bg-blue-500/10 border-blue-500/20 border-l-blue-500"; textClass = "text-blue-100"; subtitleClass = "text-blue-400/80"; }
                            else if (activity.type === 'reminder') { bgClass = "bg-pink-500/10 border-pink-500/20 border-l-pink-500"; textClass = "text-pink-100"; subtitleClass = "text-pink-400/80"; }

                            const actDate = getActivityDate(activity);

                            return (
                                <div key={activity.id} className="flex w-full gap-4">
                                    <div className="text-[13px] font-medium text-zinc-500 pt-1 w-12 text-right flex-shrink-0">
                                        {format(actDate, 'HH:mm')}
                                    </div>
                                    <div className={`flex-1 border-l-4 rounded-lg p-3 flex flex-col gap-1 ${bgClass}`}>
                                        <span className={`text-[15px] font-medium ${textClass}`}>{activity.title}</span>
                                        <span className={`text-[13px] ${subtitleClass}`}>
                                            {activity.type === 'task' ? 'Due Date' : ''}
                                            {activity.type === 'event' && activity.start_time && activity.end_time ? `${format(parseISO(activity.start_time), 'HH:mm')} - ${format(parseISO(activity.end_time), 'HH:mm')}` : ''}
                                            {activity.type === 'reminder' ? 'Reminder' : ''}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <style jsx global>{`
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </main>
    );
}
