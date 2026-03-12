"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { CheckSquare, Square, Mic, Calendar as CalendarIcon, Bell, FileText, Loader2, Copy, X as XIcon, AlertTriangle, ChevronDown, ChevronRight, LayoutList, Clock, List, Flag, ArrowUp } from "lucide-react";
import { useActivities, Activity } from "@/hooks/useActivities";

export default function TasksPage() {
    const router = useRouter();
    const auth = useAuth();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const { activities, fetchActivities, isLoading, updateActivity, deleteActivity } = useActivities();

    const ALL_TYPES = ['task', 'event', 'reminder', 'log', 'milestone'] as const;
    type FilterType = typeof ALL_TYPES[number];
    const [selectedTypes, setSelectedTypes] = useState<Set<FilterType>>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('task_filter_types');
                if (saved) {
                    const arr = JSON.parse(saved) as FilterType[];
                    const valid = arr.filter(t => (ALL_TYPES as readonly string[]).includes(t));
                    if (valid.length > 0) return new Set(valid);
                }
            } catch { }
        }
        return new Set(ALL_TYPES);
    });

    useEffect(() => {
        localStorage.setItem('task_filter_types', JSON.stringify([...selectedTypes]));
    }, [selectedTypes]);

    const isAllSelected = selectedTypes.size === ALL_TYPES.length;
    const toggleType = (type: FilterType) => {
        setSelectedTypes(prev => {
            const next = new Set(prev);
            next.has(type) ? next.delete(type) : next.add(type);
            return next;
        });
    };
    const toggleAll = () => {
        setSelectedTypes(isAllSelected ? new Set() : new Set(ALL_TYPES));
    };

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingVoice, setIsProcessingVoice] = useState(false);
    const [voiceIntentModel, setVoiceIntentModel] = useState('gemini-3.1-flash-lite-preview');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);

    // STT mode: 'server' = Gemini 合并(转写+意图), 'deepgram' = streaming WebSocket, 'local' = Web Speech API
    const [sttMode, setSttMode] = useState<'deepgram' | 'local' | 'server'>('server');
    const recognitionRef = useRef<any>(null);
    const deepgramWsRef = useRef<WebSocket | null>(null);
    const [liveTranscript, setLiveTranscript] = useState('');

    // Voice timing log overlay
    const [voiceLog, setVoiceLog] = useState<string | null>(null);
    const [logCopied, setLogCopied] = useState(false);

    const [showCompleted, setShowCompleted] = useState(false);

    type SortMode = 'time' | 'group';
    const [sortMode, setSortMode] = useState<SortMode>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('task_sort_mode') as SortMode) || 'time';
        }
        return 'time';
    });
    const toggleSortMode = () => {
        setSortMode(prev => {
            const next = prev === 'time' ? 'group' : 'time';
            localStorage.setItem('task_sort_mode', next);
            return next;
        });
    };

    // Card-level voice note state
    const [cardRecordingId, setCardRecordingId] = useState<string | null>(null);
    const [cardProcessingId, setCardProcessingId] = useState<string | null>(null);
    const cardMediaRecorderRef = useRef<MediaRecorder | null>(null);

    useEffect(() => {
        getAllConversations().then(setConversations);
        getActiveConversationId().then(setActiveId);
        if (localStorage.getItem('sandbox_enabled') === 'true') setIsAdmin(true);
        fetch('/api/admin/check').then(res => { if (res.ok) setIsAdmin(true); }).catch(() => { });
    }, []);

    useEffect(() => {
        if (!auth.isActivated) return;
        fetch('/api/config', { headers: auth.getAuthHeaders() })
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data?.voiceIntentModel) setVoiceIntentModel(data.voiceIntentModel); })
            .catch(() => { });
    }, [auth.isActivated]);

    useEffect(() => {
        if (auth.isActivated) {
            fetchActivities();
        }
    }, [auth.isActivated, fetchActivities]);

    const handleToggleStatus = async (activity: Activity) => {
        if (activity.type === 'log') return; // Logs don't have completion status in the same way
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
                    if (blob.size < 4000) { setCardProcessingId(null); return; } // 静音/太短，跳过
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

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        router.push('/');
    };

    const handleNew = async () => {
        router.push('/');
    };

    // ── Deepgram 流式 STT（边说边识别）─────────────────────────────────────────
    const toggleDeepgramRecording = async () => {
        if (isProcessingVoice) return;

        // 停止录音
        if (isRecording) {
            deepgramWsRef.current?.send(JSON.stringify({ type: 'CloseStream' }));
            setIsRecording(false);
            return;
        }

        try {
            // 获取临时 token
            const tokenRes = await fetch('/api/speech-token', { headers: auth.getAuthHeaders() });
            if (!tokenRes.ok) throw new Error('无法获取语音 token');
            const { token: dgToken } = await tokenRes.json();

            // 打开 Deepgram WebSocket（nova-2 支持中文，不指定 encoding 让 Deepgram 自动检测 webm/opus）
            const ws = new WebSocket(
                'wss://api.deepgram.com/v1/listen?language=zh-CN&model=nova-2&interim_results=true&endpointing=500',
                ['token', dgToken]
            );
            deepgramWsRef.current = ws;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            mediaRecorderRef.current = mediaRecorder;

            let finalTranscript = '';
            const t0 = Date.now();
            const logs: string[] = [];
            const addLog = (msg: string) => { logs.push(msg); console.log(`[Deepgram] ${msg}`); };

            ws.onopen = () => {
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
                };
                mediaRecorder.start(250); // 每 250ms 发一次音频块
                setIsRecording(true);
                setLiveTranscript('');
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                const alt = data.channel?.alternatives?.[0];
                if (!alt?.transcript) return;

                if (!data.is_final) {
                    // 实时显示中间结果
                    setLiveTranscript(alt.transcript);
                } else if (alt.transcript.trim()) {
                    finalTranscript = alt.transcript.trim();
                    setLiveTranscript(finalTranscript);
                    addLog(`Deepgram STT 完成: ${Date.now() - t0}ms\n识别结果: "${finalTranscript}"`);

                    // 停止录音，关闭 WebSocket
                    mediaRecorder.stop();
                    stream.getTracks().forEach(t => t.stop());
                    ws.send(JSON.stringify({ type: 'CloseStream' }));
                    setIsRecording(false);
                    setLiveTranscript('');
                    setIsProcessingVoice(true);

                    try {
                        const t2 = Date.now();
                        const intentRes = await fetch('/api/voice-intent', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
                            body: JSON.stringify({ transcript: finalTranscript })
                        });
                        const intentData = await intentRes.json();
                        addLog(`语音意图+工具调用完成: ${Date.now() - t2}ms`);
                        if (!intentRes.ok || !intentData.success) throw new Error(intentData.error || '意图解析失败');
                        const t3 = Date.now();
                        await fetchActivities({ force: true });
                        addLog(`列表刷新完成: ${Date.now() - t3}ms`);
                        addLog(`全链路总计: ${Date.now() - t0}ms`);
                        setVoiceLog(logs.join('\n'));
                    } catch (err: any) {
                        alert('语音处理失败：' + err.message);
                    } finally {
                        setIsProcessingVoice(false);
                    }
                }
            };

            ws.onerror = () => {
                setIsRecording(false);
                setLiveTranscript('');
                mediaRecorder.stop();
                stream.getTracks().forEach(t => t.stop());
                alert('Deepgram 连接失败，请切换为云端模式');
            };

            ws.onclose = () => {
                if (isRecording) setIsRecording(false);
                setLiveTranscript('');
            };

        } catch (err: any) {
            setIsRecording(false);
            alert('启动失败：' + err.message);
        }
    };

    // ── 本地 STT（Web Speech API）──────────────────────────────────────────────
    const toggleLocalRecording = () => {
        if (isProcessingVoice) return;

        if (isRecording) {
            recognitionRef.current?.stop();
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('当前浏览器不支持本地语音识别，请切换为云端模式。');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognitionRef.current = recognition;

        recognition.onstart = () => setIsRecording(true);

        recognition.onresult = async (event: any) => {
            const transcript = event.results[0][0].transcript;
            recognition.stop();
            setIsRecording(false);
            setIsProcessingVoice(true);
            const t0 = Date.now();
            const logs: string[] = [];
            const addLog = (msg: string) => { logs.push(msg); console.log(`[Voice-Local] ${msg}`); };
            addLog(`本地 STT 完成: <100ms\n识别结果: "${transcript}"`);
            try {
                const t2 = Date.now();
                const intentRes = await fetch('/api/voice-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
                    body: JSON.stringify({ transcript })
                });
                const intentData = await intentRes.json();
                addLog(`语音意图+工具调用完成: ${Date.now() - t2}ms`);
                if (!intentRes.ok || !intentData.success) throw new Error(intentData.error || '意图解析失败');
                const t3 = Date.now();
                await fetchActivities({ force: true });
                addLog(`列表刷新完成: ${Date.now() - t3}ms`);
                addLog(`全链路总计: ${Date.now() - t0}ms`);
                setVoiceLog(logs.join('\n'));
            } catch (err: any) {
                console.error('Local voice error:', err);
                alert('语音处理失败：' + err.message);
            } finally {
                setIsProcessingVoice(false);
            }
        };

        recognition.onerror = (event: any) => {
            setIsRecording(false);
            if (event.error !== 'aborted') alert('语音识别错误：' + event.error);
        };

        recognition.onend = () => setIsRecording(false);

        recognition.start();
    };

    const toggleRecording = async () => {
        if (isProcessingVoice) return;

        if (isRecording && mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());

                setIsProcessingVoice(true);
                const t0 = Date.now();
                const logs: string[] = [];
                const addLog = (msg: string) => { logs.push(msg); console.log(`[Voice] ${msg}`); };
                addLog(`音频大小: ${(audioBlob.size / 1024).toFixed(1)}KB`);
                try {
                    // 一步到位：音频 → Gemini（转写 + 意图 + 工具调用）
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'record.webm');

                    const res = await fetch('/api/voice-intent-audio', {
                        method: 'POST',
                        headers: {
                            'x-activation-token': auth.getAuthHeaders()['x-activation-token'],
                            'x-device-fingerprint': auth.getAuthHeaders()['x-device-fingerprint']
                        },
                        body: formData
                    });

                    const data = await res.json();
                    addLog(`Gemini 转写+意图+工具调用: ${Date.now() - t0}ms\n识别结果: "${data.transcript || ''}"`);
                    if (!res.ok || !data.success) throw new Error(data.error || '语音处理失败');

                    const t3 = Date.now();
                    await fetchActivities({ force: true });
                    addLog(`列表刷新完成: ${Date.now() - t3}ms`);
                    addLog(`全链路总计: ${Date.now() - t0}ms`);
                    setVoiceLog(logs.join('\n'));
                } catch (err) {
                    console.error("Voice processing error:", err);
                    alert("语音处理失败，请重试或检查后端的 STT 接口配置");
                } finally {
                    setIsProcessingVoice(false);
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Microphone access denied or error:", err);
            alert("无法访问麦克风，请检查浏览器权限。");
        }
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
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">活动</h1>
                <button
                    onClick={toggleSortMode}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-muted transition-colors"
                    title={sortMode === 'time' ? '切换为分组视图' : '切换为时间视图'}
                >
                    {sortMode === 'time' ? <LayoutList size={18} /> : <Clock size={18} />}
                </button>
            </header>

            {/* Filters */}
            <div className="flex items-center gap-1.5 px-4 py-2 flex-none border-b border-white/5">
                <button onClick={toggleAll} title="全部" className={`p-2 rounded-lg transition-colors ${isAllSelected ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><List size={16} /></button>
                <button onClick={() => toggleType('task')} title="待办" className={`p-2 rounded-lg transition-colors ${selectedTypes.has('task') ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><CheckSquare size={16} /></button>
                <button onClick={() => toggleType('event')} title="日程" className={`p-2 rounded-lg transition-colors ${selectedTypes.has('event') ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><CalendarIcon size={16} /></button>
                <button onClick={() => toggleType('reminder')} title="提醒" className={`p-2 rounded-lg transition-colors ${selectedTypes.has('reminder') ? 'bg-pink-500/20 text-pink-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><Bell size={16} /></button>
                <button onClick={() => toggleType('log')} title="随手记" className={`p-2 rounded-lg transition-colors ${selectedTypes.has('log') ? 'bg-purple-500/20 text-purple-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><FileText size={16} /></button>
                <button onClick={() => toggleType('milestone')} title="里程碑" className={`p-2 rounded-lg transition-colors ${selectedTypes.has('milestone') ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}><Flag size={16} /></button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    <div className="text-center text-sm text-zinc-500 py-10">加载中...</div>
                ) : (() => {
                    const filtered = activities.filter(a => selectedTypes.has(a.type as FilterType));
                    const activeItems = filtered.filter(a => a.status !== 'completed' && a.status !== 'cancelled');
                    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
                    const completedItems = filtered.filter(a => (a.status === 'completed' || a.status === 'cancelled') && new Date(a.updated_at) >= cutoff);

                    const renderCard = (activity: Activity) => {
                        const isCompleted = activity.status === 'completed' || activity.status === 'cancelled';
                        const refTime = activity.end_time || activity.start_time;
                        const overdue = !isCompleted && activity.type !== 'log' && !!refTime && new Date(refTime) < new Date();

                        let bgClass = "bg-zinc-900 border-white/5";
                        let typeColor = "text-zinc-400 bg-zinc-500/10";
                        if (overdue) {
                            bgClass = "bg-red-500/15 border-red-500/50";
                            typeColor = "text-red-400 bg-red-500/10";
                        } else if (!isCompleted) {
                            if (activity.type === 'task') { bgClass = "bg-emerald-500/10 border-emerald-500/20"; typeColor = "text-emerald-400 bg-emerald-500/10"; }
                            if (activity.type === 'event') { bgClass = "bg-blue-500/10 border-blue-500/20"; typeColor = "text-blue-400 bg-blue-500/10"; }
                            if (activity.type === 'reminder') { bgClass = "bg-pink-500/10 border-pink-500/20"; typeColor = "text-pink-400 bg-pink-500/10"; }
                            if (activity.type === 'log') { bgClass = "bg-purple-500/10 border-purple-500/20"; typeColor = "text-purple-400 bg-purple-500/10"; }
                        } else {
                            bgClass = "bg-zinc-500/10 border-white/5 opacity-50";
                        }

                        // 子任务进度
                        const subtasks = activity.subtasks || [];
                        const subtaskDone = subtasks.filter(s => s.completed).length;
                        // 高优先级样式
                        const isHighPriority = !isCompleted && (activity.priority === 'high' || activity.priority === 'urgent');

                        return (
                            <div key={activity.id} onClick={() => router.push(`/activities/${activity.id}`)} className={`w-full flex items-center p-4 gap-3 rounded-xl border cursor-pointer ${bgClass} ${isHighPriority && !overdue ? 'border-l-[3px] border-l-red-400' : ''}`}>
                                <div className="flex-shrink-0">
                                    {activity.type === 'log' ? (
                                        <div className="w-5 h-5 flex items-center justify-center pt-0.5"><FileText size={18} className="text-purple-500/50" /></div>
                                    ) : (
                                        <button onClick={e => { e.stopPropagation(); handleToggleStatus(activity); }} className="flex items-center justify-center">
                                            {isCompleted ? (
                                                <CheckSquare size={20} className="text-emerald-500" />
                                            ) : (
                                                <Square size={20} className={activity.type === 'task' ? 'text-emerald-500/50' : activity.type === 'event' ? 'text-blue-500/50' : 'text-pink-500/50'} />
                                            )}
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1 w-full min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {isHighPriority && (
                                            <ArrowUp size={14} className={activity.priority === 'urgent' ? 'text-red-400 flex-shrink-0' : 'text-orange-400 flex-shrink-0'} />
                                        )}
                                        <span className={`text-[15px] font-medium truncate ${isCompleted ? 'text-zinc-500 line-through' : (activity.type === 'task' ? 'text-emerald-100' : activity.type === 'event' ? 'text-blue-100' : activity.type === 'log' ? 'text-purple-100' : 'text-pink-100')}`}>
                                            {activity.title}
                                        </span>
                                    </div>
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
                                        {overdue && (
                                            <span className="flex items-center gap-0.5 text-[11px] font-medium px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                                                <AlertTriangle size={10} />已过期
                                            </span>
                                        )}
                                        {subtasks.length > 0 && (
                                            <span className="text-[11px] text-zinc-500">
                                                {subtaskDone}/{subtasks.length} 子任务
                                            </span>
                                        )}
                                    </div>
                                    {subtasks.length > 0 && (
                                        <div className="h-1 bg-zinc-700/60 rounded-full overflow-hidden mt-0.5">
                                            <div
                                                className="h-full rounded-full transition-all bg-indigo-500/70"
                                                style={{ width: `${subtaskDone / subtasks.length * 100}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => handleCardMicToggle(activity.id, e)}
                                    disabled={!!cardProcessingId}
                                    className={`p-2 ml-auto shrink-0 transition-colors ${cardRecordingId === activity.id ? 'text-red-400 animate-pulse' : cardProcessingId === activity.id ? 'text-zinc-400' : 'text-zinc-500 hover:text-blue-400'}`}
                                >
                                    {cardProcessingId === activity.id
                                        ? <Loader2 size={18} className="animate-spin" />
                                        : <Mic size={18} />}
                                </button>
                            </div>
                        );
                    };

                    if (filtered.length === 0) return (
                        <div className="text-center text-sm text-zinc-500 py-10">暂无匹配的活动</div>
                    );

                    const getRefTime = (a: Activity) => a.start_time || a.end_time || a.created_at;
                    // 优先级权重：urgent > high > medium > low
                    const PRIORITY_WEIGHT: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
                    const sortByPriorityThenTime = (arr: Activity[]) => [...arr].sort((a, b) => {
                        const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
                        const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
                        if (pa !== pb) return pb - pa;
                        return new Date(getRefTime(a)).getTime() - new Date(getRefTime(b)).getTime();
                    });
                    const sortByTime = (arr: Activity[]) => sortByPriorityThenTime(arr);

                    const GROUP_LABELS: Record<string, string> = { task: '待办', event: '日程', reminder: '提醒', log: '随手记', milestone: '里程碑' };
                    const GROUP_ORDER = ['task', 'event', 'reminder', 'milestone', 'log'];

                    const renderCompleted = () => completedItems.length > 0 && (
                        <div className="pt-2">
                            <button onClick={() => setShowCompleted(v => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors mb-3">
                                {showCompleted ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                已完成 ({completedItems.length})
                            </button>
                            {showCompleted && <div className="space-y-3">{sortByTime(completedItems).map(renderCard)}</div>}
                        </div>
                    );

                    if (sortMode === 'time') {
                        return (
                            <>
                                {activeItems.length === 0 && completedItems.length > 0 && (
                                    <div className="text-center text-sm text-zinc-600 py-4">所有事项已完成</div>
                                )}
                                {sortByTime(activeItems).map(renderCard)}
                                {renderCompleted()}
                            </>
                        );
                    }

                    // 分组模式
                    const groups = GROUP_ORDER.filter(t => selectedTypes.has(t as FilterType)).map(type => ({
                        type,
                        label: GROUP_LABELS[type],
                        items: sortByTime(activeItems.filter(a => a.type === type)),
                    })).filter(g => g.items.length > 0);

                    return (
                        <>
                            {activeItems.length === 0 && completedItems.length > 0 && (
                                <div className="text-center text-sm text-zinc-600 py-4">所有事项已完成</div>
                            )}
                            {groups.map(g => (
                                <div key={g.type} className="space-y-3">
                                    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 px-1">{g.label}</h3>
                                    {g.items.map(renderCard)}
                                </div>
                            ))}
                            {renderCompleted()}
                        </>
                    );
                })()}
            </div>

            {/* Live transcript bubble */}
            {liveTranscript && (
                <div className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 w-[80%] max-w-xs">
                    <div className="bg-zinc-800/90 backdrop-blur-sm text-zinc-100 text-sm px-4 py-2 rounded-2xl text-center shadow-lg">
                        {liveTranscript}
                    </div>
                </div>
            )}

            {/* FAB */}
            <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
                <button
                    onClick={isAdmin ? (sttMode === 'deepgram' ? toggleDeepgramRecording : sttMode === 'local' ? toggleLocalRecording : toggleRecording) : toggleRecording}
                    disabled={isProcessingVoice}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-zinc-50 hover:scale-105 active:scale-95'} ${isProcessingVoice ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                    {isProcessingVoice ? (
                        <Loader2 size={24} className="text-zinc-950 animate-spin" />
                    ) : (
                        <Mic size={24} className={isRecording ? 'text-white' : 'text-zinc-950'} />
                    )}
                </button>
                {isAdmin ? (
                    <button
                        onClick={() => setSttMode(m => m === 'deepgram' ? 'local' : m === 'local' ? 'server' : 'deepgram')}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        {sttMode === 'deepgram' ? '流式' : sttMode === 'local' ? '本地' : '云端'}
                    </button>
                ) : (
                    <span className="text-[10px] text-zinc-500">
                        {isRecording ? '再次点击停止' : '点击说话'}
                    </span>
                )}
            </div>

            {/* Voice Timing Log Overlay */}
            {voiceLog && (
                <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
                        <div className="flex items-center justify-between px-4 pt-4 pb-2">
                            <span className="text-sm font-semibold text-zinc-200">语音延迟日志</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { navigator.clipboard.writeText(voiceLog); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000); }}
                                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
                                >
                                    <Copy size={13} />
                                    {logCopied ? '已复制' : '复制'}
                                </button>
                                <button onClick={() => setVoiceLog(null)} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
                                    <XIcon size={16} />
                                </button>
                            </div>
                        </div>
                        <pre className="px-4 pb-4 text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{voiceLog}</pre>
                    </div>
                </div>
            )}
        </main>
    );
}
