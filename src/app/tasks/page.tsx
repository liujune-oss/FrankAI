"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { CheckSquare, Square, Mic, Calendar as CalendarIcon, Bell, Trash2, FileText, Loader2, Copy, X as XIcon } from "lucide-react";
import { useActivities, Activity } from "@/hooks/useActivities";

export default function TasksPage() {
    const auth = useAuth();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const { activities, fetchActivities, isLoading, updateActivity, deleteActivity } = useActivities();
    const [filter, setFilter] = useState<'all' | 'task' | 'event' | 'log'>('all');

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingVoice, setIsProcessingVoice] = useState(false);
    const [voiceIntentModel, setVoiceIntentModel] = useState('gemini-3.1-flash-lite-preview');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);

    // STT mode: 'deepgram' = streaming WebSocket, 'local' = Web Speech API, 'server' = Gemini STT
    const [sttMode, setSttMode] = useState<'deepgram' | 'local' | 'server'>('deepgram');
    const recognitionRef = useRef<any>(null);
    const deepgramWsRef = useRef<WebSocket | null>(null);
    const [liveTranscript, setLiveTranscript] = useState('');

    // Voice timing log overlay
    const [voiceLog, setVoiceLog] = useState<string | null>(null);
    const [logCopied, setLogCopied] = useState(false);

    // Custom Delete Dialog State
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [activityToDeleteId, setActivityToDeleteId] = useState<string | null>(null);

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

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setActivityToDeleteId(id);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (activityToDeleteId) {
            await deleteActivity(activityToDeleteId);
        }
        setIsDeleteDialogOpen(false);
        setActivityToDeleteId(null);
    };

    const cancelDelete = () => {
        setIsDeleteDialogOpen(false);
        setActivityToDeleteId(null);
    };

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        window.location.href = '/';
    };

    const handleNew = async () => {
        window.location.href = '/';
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
                    // 1. Send to Speech-to-Text
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'record.webm');

                    const sttRes = await fetch('/api/speech-to-text', {
                        method: 'POST',
                        headers: {
                            'x-activation-token': auth.getAuthHeaders()['x-activation-token'],
                            'x-device-fingerprint': auth.getAuthHeaders()['x-device-fingerprint']
                        },
                        body: formData
                    });

                    if (!sttRes.ok) throw new Error('STT request failed');
                    const { transcript } = await sttRes.json();
                    addLog(`STT 完成: ${Date.now() - t0}ms\n识别结果: "${transcript}"`);

                    if (transcript && transcript.trim() !== '') {
                        // 2. 调用轻量语音意图端点（无 RAG / 无 Phase 2）
                        const t2 = Date.now();
                        const intentRes = await fetch('/api/voice-intent', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
                            body: JSON.stringify({ transcript })
                        });

                        const intentData = await intentRes.json();
                        addLog(`语音意图+工具调用完成: ${Date.now() - t2}ms`);
                        if (!intentRes.ok || !intentData.success) {
                            throw new Error(intentData.error || '意图解析失败');
                        }
                        // Refresh the UI explicitly just in case Event Listener misses
                        const t3 = Date.now();
                        await fetchActivities({ force: true });
                        addLog(`列表刷新完成: ${Date.now() - t3}ms`);
                        addLog(`全链路总计: ${Date.now() - t0}ms`);
                        setVoiceLog(logs.join('\n'));
                    }
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
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">Tasks</h1>
                <div className="w-8" />
            </header>

            {/* Filters */}
            <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar flex-none">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${filter === 'all' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80'}`}
                >全部</button>
                <button
                    onClick={() => setFilter('task')}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${filter === 'task' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80'}`}
                >待办</button>
                <button
                    onClick={() => setFilter('event')}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${filter === 'event' ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80'}`}
                >日程</button>
                <button
                    onClick={() => setFilter('log')}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${filter === 'log' ? 'bg-purple-500/20 text-purple-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80'}`}
                >随手记</button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    <div className="text-center text-sm text-zinc-500 py-10">加载中...</div>
                ) : activities.filter(a => filter === 'all' || a.type === filter).length === 0 ? (
                    <div className="text-center text-sm text-zinc-500 py-10">暂无{filter === 'all' ? '待办事项' : filter === 'task' ? '待办事项' : filter === 'event' ? '日程安排' : '随手记录'}</div>
                ) : (
                    activities.filter(a => filter === 'all' || a.type === filter).map((activity) => {
                        const isCompleted = activity.status === 'completed';

                        let bgClass = "bg-zinc-900 border-white/5";
                        let typeColor = "text-zinc-400 bg-zinc-500/10";
                        if (!isCompleted) {
                            if (activity.type === 'task') { bgClass = "bg-emerald-500/10 border-emerald-500/20"; typeColor = "text-emerald-400 bg-emerald-500/10"; }
                            if (activity.type === 'event') { bgClass = "bg-blue-500/10 border-blue-500/20"; typeColor = "text-blue-400 bg-blue-500/10"; }
                            if (activity.type === 'reminder') { bgClass = "bg-pink-500/10 border-pink-500/20"; typeColor = "text-pink-400 bg-pink-500/10"; }
                            if (activity.type === 'log') { bgClass = "bg-purple-500/10 border-purple-500/20"; typeColor = "text-purple-400 bg-purple-500/10"; }
                        } else {
                            bgClass = "bg-zinc-500/10 border-white/5 opacity-50";
                        }

                        return (
                            <div key={activity.id} className={`w-full flex items-center p-4 gap-3 rounded-xl border ${bgClass}`}>
                                <div className="flex-shrink-0">
                                    {activity.type === 'log' ? (
                                        <div className="w-5 h-5 flex items-center justify-center pt-0.5"><FileText size={18} className="text-purple-500/50" /></div>
                                    ) : (
                                        <button onClick={() => handleToggleStatus(activity)} className="flex items-center justify-center">
                                            {isCompleted ? (
                                                <CheckSquare size={20} className="text-emerald-500" />
                                            ) : (
                                                <Square size={20} className={activity.type === 'task' ? 'text-emerald-500/50' : activity.type === 'event' ? 'text-blue-500/50' : 'text-pink-500/50'} />
                                            )}
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1 w-full min-w-0">
                                    <span className={`text-[15px] font-medium truncate ${isCompleted ? 'text-zinc-500 line-through' : (activity.type === 'task' ? 'text-emerald-100' : activity.type === 'event' ? 'text-blue-100' : activity.type === 'log' ? 'text-purple-100' : 'text-pink-100')}`}>
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
                                <button onClick={(e) => handleDelete(activity.id, e)} className="p-2 ml-auto shrink-0 text-zinc-500 hover:text-red-400 transition-colors">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        );
                    })
                )}
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
                    onClick={sttMode === 'deepgram' ? toggleDeepgramRecording : sttMode === 'local' ? toggleLocalRecording : toggleRecording}
                    disabled={isProcessingVoice}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-zinc-50 hover:scale-105 active:scale-95'} ${isProcessingVoice ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                    {isProcessingVoice ? (
                        <Loader2 size={24} className="text-zinc-950 animate-spin" />
                    ) : (
                        <Mic size={24} className={isRecording ? 'text-white' : 'text-zinc-950'} />
                    )}
                </button>
                <button
                    onClick={() => setSttMode(m => m === 'deepgram' ? 'local' : m === 'local' ? 'server' : 'deepgram')}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                    {sttMode === 'deepgram' ? '流式' : sttMode === 'local' ? '本地' : '云端'}
                </button>
            </div>

            {/* Custom Delete Dialog */}
            {isDeleteDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-semibold text-zinc-100 mb-2">确认删除</h3>
                        <p className="text-sm text-zinc-400 mb-6">您确定要删除这条记录吗？此操作无法撤销。</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={cancelDelete}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-500/80 hover:bg-red-500 transition-colors"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
