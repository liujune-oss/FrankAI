"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { useActivities, Activity } from "@/hooks/useActivities";
import { isSameDay, addDays, format, startOfToday, parseISO } from "date-fns";
import { Mic, Loader2, AlertTriangle, CheckSquare, Square } from "lucide-react";

export default function CalendarPage() {
    const router = useRouter();
    const auth = useAuth();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
    const { activities, fetchActivities, isLoading, updateActivity } = useActivities();

    // Card-level voice note state
    const [cardRecordingId, setCardRecordingId] = useState<string | null>(null);
    const [cardProcessingId, setCardProcessingId] = useState<string | null>(null);
    const cardMediaRecorderRef = useRef<MediaRecorder | null>(null);

    // Global FAB voice state (create activity)
    const [fabRecording, setFabRecording] = useState(false);
    const [fabProcessing, setFabProcessing] = useState(false);
    const fabMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const fabAudioChunksRef = useRef<BlobPart[]>([]);

    useEffect(() => {
        getAllConversations().then(setConversations);
        getActiveConversationId().then(setActiveId);
        if (localStorage.getItem('sandbox_enabled') === 'true') setIsAdmin(true);
        fetch('/api/admin/check').then(res => { if (res.ok) setIsAdmin(true); }).catch(() => { });
    }, []);

    useEffect(() => {
        if (auth.isActivated) fetchActivities();
    }, [auth.isActivated, fetchActivities]);

    const dateTape = useMemo(() => {
        const today = startOfToday();
        const start = addDays(today, -1);
        return Array.from({ length: 30 }).map((_, i) => addDays(start, i));
    }, []);

    const getActivityDate = (activity: Activity) => {
        if (activity.start_time) return parseISO(activity.start_time);
        if (activity.end_time) return parseISO(activity.end_time);
        return parseISO(activity.created_at);
    };

    const calendarActivities = useMemo(() => {
        return activities.filter(a => a.start_time || a.end_time);
    }, [activities]);

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        router.push('/');
    };

    const handleToggleStatus = async (activity: Activity, e: React.MouseEvent) => {
        e.stopPropagation();
        if (activity.type === 'log') return;
        const newStatus = activity.status === 'completed' ? 'needs_action' : 'completed';
        await updateActivity(activity.id, { status: newStatus });
    };

    const handleCardMicToggle = async (activityId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (cardProcessingId) return;

        if (cardRecordingId === activityId) {
            cardMediaRecorderRef.current?.stop();
            setCardRecordingId(null);
            return;
        }
        if (cardRecordingId) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            cardMediaRecorderRef.current = mediaRecorder;
            const chunks: BlobPart[] = [];

            mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                setCardProcessingId(activityId);
                try {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    if (blob.size < 4000) { setCardProcessingId(null); return; }
                    const formData = new FormData();
                    formData.append('audio', blob, 'note.webm');
                    const sttRes = await fetch('/api/speech-to-text', {
                        method: 'POST',
                        headers: {
                            'x-activation-token': auth.getAuthHeaders()['x-activation-token'],
                            'x-device-fingerprint': auth.getAuthHeaders()['x-device-fingerprint'],
                        },
                        body: formData,
                    });
                    const { transcript } = await sttRes.json();
                    if (!transcript?.trim()) return;
                    const now = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const current = activities.find(a => a.id === activityId);
                    const newDesc = current?.description
                        ? `${current.description}\n\n[${now}] ${transcript.trim()}`
                        : `[${now}] ${transcript.trim()}`;
                    await updateActivity(activityId, { description: newDesc });
                } catch (err: any) {
                    alert('语音备注失败：' + err.message);
                } finally {
                    setCardProcessingId(null);
                }
            };

            mediaRecorder.start();
            setCardRecordingId(activityId);
        } catch (err: any) {
            alert('无法访问麦克风：' + err.message);
        }
    };

    const toggleFabRecording = async () => {
        if (fabProcessing) return;

        if (fabRecording && fabMediaRecorderRef.current) {
            fabMediaRecorderRef.current.stop();
            setFabRecording(false);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            fabMediaRecorderRef.current = mediaRecorder;
            fabAudioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) fabAudioChunksRef.current.push(e.data);
            };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(fabAudioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(t => t.stop());
                if (audioBlob.size < 4000) return;

                setFabProcessing(true);
                try {
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'record.webm');
                    const res = await fetch('/api/voice-intent-audio', {
                        method: 'POST',
                        headers: {
                            'x-activation-token': auth.getAuthHeaders()['x-activation-token'],
                            'x-device-fingerprint': auth.getAuthHeaders()['x-device-fingerprint'],
                        },
                        body: formData,
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || '语音处理失败');
                    await fetchActivities({ force: true });
                } catch (err: any) {
                    alert('语音处理失败：' + err.message);
                } finally {
                    setFabProcessing(false);
                }
            };

            mediaRecorder.start();
            setFabRecording(true);
        } catch (err: any) {
            alert('无法访问麦克风：' + err.message);
        }
    };

    if (!auth.isActivated) return null;

    const getDotsForDate = (date: Date) => {
        const dayActivities = calendarActivities.filter(a => isSameDay(getActivityDate(a), date));
        const colors = new Set<string>();
        dayActivities.forEach(a => {
            if (a.type === 'task') colors.add('bg-emerald-500');
            else if (a.type === 'event') colors.add('bg-blue-500');
            else if (a.type === 'reminder') colors.add('bg-pink-500');
            else if (a.type === 'log') colors.add('bg-purple-500');
            else if (a.type === 'milestone') colors.add('bg-amber-500');
        });
        return Array.from(colors);
    };

    const selectedDayActivities = calendarActivities.filter(a => isSameDay(getActivityDate(a), selectedDate));
    selectedDayActivities.sort((a, b) => getActivityDate(a).getTime() - getActivityDate(b).getTime());

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
            <ConversationDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                conversations={conversations}
                activeId={activeId || undefined}
                onNew={() => router.push('/')}
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
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">日历</h1>
                <div className="w-8" />
            </header>

            {/* Date Scroll Tape */}
            <div
                className="w-full overflow-x-auto border-b border-white/5 flex px-4 py-3 gap-2 hide-scrollbar"
                onWheel={(e) => { if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY; }}
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
                                {dots.length > 0 ? dots.map((dotClass, idx) => (
                                    <div key={idx} className={`w-1 h-1 rounded-full ${dotClass}`} />
                                )) : (
                                    <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-zinc-900' : 'bg-transparent'}`} />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Timeline List */}
            <div className="flex-1 overflow-y-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] space-y-6">
                <div className="flex flex-col gap-4">
                    <h2 className="text-sm font-semibold text-zinc-50 tracking-wide">{format(selectedDate, 'yyyy年M月d日 EEEE')}</h2>

                    {isLoading ? (
                        <div className="text-sm text-zinc-500 py-4 text-center">加载数据中...</div>
                    ) : selectedDayActivities.length === 0 ? (
                        <div className="text-sm text-zinc-500 py-4 text-center">当天没有日程安排</div>
                    ) : (
                        selectedDayActivities.map(activity => {
                            const isCompleted = activity.status === 'completed' || activity.status === 'cancelled';
                            const refTime = activity.end_time || activity.start_time;
                            const overdue = !isCompleted && activity.type !== 'log'
                                && !!refTime && new Date(refTime) < new Date();

                            let bgClass = "bg-zinc-900 border-white/5 border-l-zinc-500";
                            let textClass = "text-zinc-100";
                            let subtitleClass = "text-zinc-400";

                            if (isCompleted) {
                                bgClass = "bg-zinc-500/10 border-white/5 border-l-zinc-600 opacity-60";
                                textClass = "text-zinc-500 line-through";
                                subtitleClass = "text-zinc-600";
                            } else if (overdue) {
                                bgClass = "bg-red-500/15 border-red-500/50 border-l-red-500";
                                textClass = "text-red-100";
                                subtitleClass = "text-red-400/80";
                            } else if (activity.type === 'task') { bgClass = "bg-emerald-500/10 border-emerald-500/20 border-l-emerald-500"; textClass = "text-emerald-100"; subtitleClass = "text-emerald-400/80"; }
                            else if (activity.type === 'event') { bgClass = "bg-blue-500/10 border-blue-500/20 border-l-blue-500"; textClass = "text-blue-100"; subtitleClass = "text-blue-400/80"; }
                            else if (activity.type === 'reminder') { bgClass = "bg-pink-500/10 border-pink-500/20 border-l-pink-500"; textClass = "text-pink-100"; subtitleClass = "text-pink-400/80"; }
                            else if (activity.type === 'log') { bgClass = "bg-purple-500/10 border-purple-500/20 border-l-purple-500"; textClass = "text-purple-100"; subtitleClass = "text-purple-400/80"; }
                            else if (activity.type === 'milestone') { bgClass = "bg-amber-500/10 border-amber-500/20 border-l-amber-500"; textClass = "text-amber-100"; subtitleClass = "text-amber-400/80"; }

                            const actDate = getActivityDate(activity);

                            return (
                                <div key={activity.id} className="flex w-full gap-2 items-center">
                                    {/* 完成状态切换 */}
                                    <button
                                        onClick={(e) => handleToggleStatus(activity, e)}
                                        className="shrink-0 p-1"
                                    >
                                        {activity.type === 'log' ? (
                                            <div className="w-5 h-5" />
                                        ) : isCompleted ? (
                                            <CheckSquare size={18} className="text-emerald-500" />
                                        ) : (
                                            <Square size={18} className={overdue ? 'text-red-500/50' : activity.type === 'task' ? 'text-emerald-500/50' : activity.type === 'event' ? 'text-blue-500/50' : 'text-pink-500/50'} />
                                        )}
                                    </button>

                                    {/* 时间 */}
                                    <div className={`text-[13px] font-medium w-10 text-right flex-shrink-0 ${overdue ? 'text-red-400' : isCompleted ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                        {format(actDate, 'HH:mm')}
                                    </div>

                                    {/* 卡片内容 */}
                                    <div
                                        onClick={() => router.push(`/activities/${activity.id}`)}
                                        className={`flex-1 border-l-4 rounded-lg p-3 flex flex-col gap-1 cursor-pointer ${bgClass}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[15px] font-medium flex-1 ${textClass}`}>{activity.title}</span>
                                            {overdue && <span className="flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 shrink-0"><AlertTriangle size={10} />已过期</span>}
                                        </div>
                                        <span className={`text-[13px] ${subtitleClass}`}>
                                            {activity.type === 'task' ? '待办' : ''}
                                            {activity.type === 'event' && activity.start_time && activity.end_time ? `${format(parseISO(activity.start_time), 'HH:mm')} - ${format(parseISO(activity.end_time), 'HH:mm')}` : ''}
                                            {activity.type === 'reminder' ? '提醒' : ''}
                                            {activity.type === 'log' ? '随手记' : ''}
                                            {activity.type === 'milestone' ? '里程碑' : ''}
                                        </span>
                                    </div>

                                    {/* 卡片语音备注 */}
                                    <button
                                        onClick={(e) => handleCardMicToggle(activity.id, e)}
                                        disabled={!!cardProcessingId}
                                        className={`p-2 shrink-0 transition-colors ${cardRecordingId === activity.id ? 'text-red-400 animate-pulse' : cardProcessingId === activity.id ? 'text-zinc-400' : 'text-zinc-500 hover:text-blue-400'}`}
                                    >
                                        {cardProcessingId === activity.id
                                            ? <Loader2 size={18} className="animate-spin" />
                                            : <Mic size={18} />}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* 全局语音 FAB（创建活动） */}
            <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
                <button
                    onClick={toggleFabRecording}
                    disabled={fabProcessing}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${fabRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-zinc-50 hover:scale-105 active:scale-95'} ${fabProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                    {fabProcessing
                        ? <Loader2 size={24} className="text-zinc-950 animate-spin" />
                        : <Mic size={24} className={fabRecording ? 'text-white' : 'text-zinc-950'} />}
                </button>
            </div>

            <style jsx global>{`
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </main>
    );
}
