"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useProjects, Project, PROJECT_COLORS, STATUS_LABELS } from "@/hooks/useProjects";
import ConversationDrawer from "@/components/ConversationDrawer";
import { getAllConversations, getActiveConversationId, setActiveConversationId, Conversation } from "@/lib/conversations";
import { Plus, Trash2, ChevronRight, Loader2, Mic, Copy, X as XIcon } from "lucide-react";
import Link from "next/link";

export default function ProjectsPage() {
    const router = useRouter();
    const auth = useAuth();
    const { projects, isLoading, fetchProjects, createProject, deleteProject } = useProjects();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    // New project form
    const [showForm, setShowForm] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formDueDate, setFormDueDate] = useState('');
    const [formColor, setFormColor] = useState(PROJECT_COLORS[0]);
    const [isSaving, setIsSaving] = useState(false);

    // Delete dialog
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Voice recording
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingVoice, setIsProcessingVoice] = useState(false);
    const [voiceLog, setVoiceLog] = useState<string | null>(null);
    const [logCopied, setLogCopied] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);

    useEffect(() => {
        getAllConversations().then(setConversations);
        getActiveConversationId().then(setActiveId);
        fetch('/api/admin/check').then(res => { if (res.ok) setIsAdmin(true); }).catch(() => { });
    }, []);

    useEffect(() => {
        if (auth.isActivated) fetchProjects();
    }, [auth.isActivated, fetchProjects]);

    const handleCreate = async () => {
        if (!formTitle.trim()) return;
        setIsSaving(true);
        try {
            await createProject({
                title: formTitle.trim(),
                description: formDesc.trim() || undefined,
                due_date: formDueDate ? new Date(formDueDate).toISOString() : undefined,
                color: formColor,
            });
            setShowForm(false);
            setFormTitle(''); setFormDesc(''); setFormDueDate(''); setFormColor(PROJECT_COLORS[0]);
        } finally {
            setIsSaving(false);
        }
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
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(t => t.stop());
                setIsProcessingVoice(true);
                const t0 = Date.now();
                const logs: string[] = [];
                const addLog = (msg: string) => { logs.push(msg); };
                addLog(`音频大小: ${(audioBlob.size / 1024).toFixed(1)}KB`);
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
                    addLog(`Gemini 转写+意图+工具调用: ${Date.now() - t0}ms\n识别结果: "${data.transcript || ''}"`);
                    if (!res.ok || !data.success) throw new Error(data.error || '语音处理失败');
                    const t3 = Date.now();
                    await fetchProjects();
                    addLog(`列表刷新完成: ${Date.now() - t3}ms`);
                    addLog(`全链路总计: ${Date.now() - t0}ms`);
                    setVoiceLog(logs.join('\n'));
                } catch (err: any) {
                    alert('语音处理失败：' + err.message);
                } finally {
                    setIsProcessingVoice(false);
                }
            };
            mediaRecorder.start();
            setIsRecording(true);
        } catch {
            alert('无法访问麦克风，请检查浏览器权限。');
        }
    };

    const handleSwitch = async (conv: Conversation) => {
        await setActiveConversationId(conv.id);
        router.push('/');
    };

    if (!auth.isActivated) return null;

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
            <ConversationDrawer
                open={drawerOpen} onClose={() => setDrawerOpen(false)}
                conversations={conversations} activeId={activeId || undefined}
                onNew={() => { window.location.href = '/'; }} onSwitch={handleSwitch}
                onDelete={() => { }} onClearAll={() => { }} onMemory={() => { }}
                onOpenMemoryManager={() => { }} extractingMemories={new Set()}
                systemInstruction={""} setSystemInstruction={() => { }}
                defaultSystemInstruction={""} pushSystemInstruction={async () => { }}
                isAdmin={isAdmin} onOpenSandbox={() => { }}
            />

            {/* Header */}
            <header className="flex-none px-4 py-3 border-b border-white/5 flex items-center justify-between bg-card text-card-foreground z-10">
                <button onClick={() => setDrawerOpen(true)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
                </button>
                <h1 className="text-base font-semibold tracking-tight mx-3 flex-1 text-center">Projects</h1>
                <button
                    onClick={() => setShowForm(true)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                    <Plus size={20} />
                </button>
            </header>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    <div className="text-center text-sm text-zinc-500 py-10">加载中...</div>
                ) : projects.length === 0 ? (
                    <div className="text-center text-sm text-zinc-500 py-10">
                        暂无项目，点击右上角 + 新建
                    </div>
                ) : (
                    projects.map(p => (
                        <div key={p.id} className="relative">
                            <Link href={`/projects/${p.id}`}>
                                <div className="flex items-center gap-3 p-4 rounded-xl bg-zinc-900 border border-white/5 hover:bg-zinc-800/60 transition-colors">
                                    <div className="w-3 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[15px] font-medium text-zinc-100 truncate">{p.title}</p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-zinc-400">
                                                {STATUS_LABELS[p.status]}
                                            </span>
                                            {p.due_date && (
                                                <span className="text-[11px] text-zinc-500">
                                                    截止 {new Date(p.due_date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-zinc-600 flex-shrink-0" />
                                </div>
                            </Link>
                            <button
                                onClick={() => setDeleteId(p.id)}
                                className="absolute top-3 right-8 p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* New Project Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-t-2xl w-full max-w-lg p-6 space-y-4 animate-in slide-in-from-bottom-4 duration-200">
                        <h2 className="text-base font-semibold text-zinc-100">新建项目</h2>
                        <input
                            autoFocus
                            value={formTitle}
                            onChange={e => setFormTitle(e.target.value)}
                            placeholder="项目名称"
                            className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                        />
                        <input
                            value={formDesc}
                            onChange={e => setFormDesc(e.target.value)}
                            placeholder="描述（可选）"
                            className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                        />
                        <input
                            type="date"
                            value={formDueDate}
                            onChange={e => setFormDueDate(e.target.value)}
                            className="w-full bg-zinc-800 text-zinc-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                        />
                        {/* Color picker */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">颜色</span>
                            {PROJECT_COLORS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setFormColor(c)}
                                    className={`w-6 h-6 rounded-full transition-transform ${formColor === c ? 'scale-125 ring-2 ring-white/50' : ''}`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => { setShowForm(false); setFormTitle(''); setFormDesc(''); setFormDueDate(''); }}
                                className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!formTitle.trim() || isSaving}
                                className="flex-1 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : '创建'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Voice FAB */}
            <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
                <button
                    onClick={toggleRecording}
                    disabled={isProcessingVoice}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-zinc-50 hover:scale-105 active:scale-95'} ${isProcessingVoice ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                    {isProcessingVoice
                        ? <Loader2 size={24} className="text-zinc-950 animate-spin" />
                        : <Mic size={24} className={isRecording ? 'text-white' : 'text-zinc-950'} />
                    }
                </button>
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
                                    <Copy size={13} />{logCopied ? '已复制' : '复制'}
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

            {/* Delete confirm */}
            {deleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm">
                        <h3 className="text-base font-semibold text-zinc-100 mb-2">确认删除</h3>
                        <p className="text-sm text-zinc-400 mb-6">删除项目后，关联的子任务不会被删除，但会解除关联。</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-xl text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors">取消</button>
                            <button
                                onClick={async () => { await deleteProject(deleteId); setDeleteId(null); }}
                                className="px-4 py-2 rounded-xl text-sm text-white bg-red-500/80 hover:bg-red-500 transition-colors"
                            >确认删除</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
