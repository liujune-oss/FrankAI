"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useProjects, Project, PROJECT_COLORS, STATUS_LABELS } from "@/hooks/useProjects";
import { Activity } from "@/hooks/useActivities";
import { ArrowLeft, Plus, Trash2, CheckSquare, Square, Loader2, Pencil, Check, X, Mic, Copy, X as XIcon, Flag, CalendarDays, ListTodo, Bell, LayoutList, Clock } from "lucide-react";

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
    milestone: { label: '里程碑', icon: <Flag size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    event:     { label: '会议',   icon: <CalendarDays size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    task:      { label: '待办',   icon: <ListTodo size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    reminder:  { label: '提醒',   icon: <Bell size={14} />, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
};
const TYPE_ORDER = ['milestone', 'event', 'task', 'reminder'];

function ActivityCard({ a, showTypeBadge, onToggle, onDelete }: {
    a: Activity;
    showTypeBadge?: boolean;
    onToggle: (a: Activity) => void;
    onDelete: (id: string) => void;
}) {
    const cfg = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.task;
    const isMilestone = a.type === 'milestone';
    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${a.status === 'completed' ? 'bg-zinc-500/10 border-white/5 opacity-50' : `${cfg.bg} ${cfg.border}`}`}>
            {isMilestone ? (
                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    <div className={`w-2.5 h-2.5 rotate-45 ${a.status === 'completed' ? 'bg-zinc-500' : 'bg-amber-400'}`} />
                </div>
            ) : (
                <button onClick={() => onToggle(a)} className="flex-shrink-0">
                    {a.status === 'completed'
                        ? <CheckSquare size={18} className={cfg.color} />
                        : <Square size={18} className={`${cfg.color} opacity-50`} />}
                </button>
            )}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[14px] font-medium ${a.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
                        {a.title}
                    </span>
                    {showTypeBadge && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                            {cfg.label}
                        </span>
                    )}
                </div>
                {(a.start_time || a.end_time || isMilestone) && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                        {isMilestone
                            ? new Date(a.start_time || a.end_time || a.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
                            : new Date(a.start_time || a.end_time!).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        }
                    </p>
                )}
            </div>
            <button onClick={() => onDelete(a.id)} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0">
                <Trash2 size={15} />
            </button>
        </div>
    );
}

export default function ProjectDetailPage() {
    const params = useParams();
    const router = useRouter();
    const auth = useAuth();
    const id = params.id as string;

    const { updateProject, deleteProject } = useProjects();
    const [project, setProject] = useState<Project | null>(null);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Inline title editing
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');

    // Add item form
    const [showAddForm, setShowAddForm] = useState(false);
    const [addType, setAddType] = useState<string>('task');
    const [addTitle, setAddTitle] = useState('');
    const [addDate, setAddDate] = useState('');
    const [isSavingItem, setIsSavingItem] = useState(false);

    // Delete dialog
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

    // View mode
    const [viewMode, setViewMode] = useState<'grouped' | 'timeline'>('grouped');

    // Voice recording
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingVoice, setIsProcessingVoice] = useState(false);
    const [voiceLog, setVoiceLog] = useState<string | null>(null);
    const [logCopied, setLogCopied] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);

    const loadData = useCallback(async () => {
        if (!auth.isActivated) return;
        try {
            const [projRes, actRes] = await Promise.all([
                fetch(`/api/projects/${id}`, { headers: auth.getAuthHeaders() }),
                fetch(`/api/activities?project_id=${id}`, { headers: auth.getAuthHeaders() }),
            ]);
            if (!projRes.ok) { router.push('/projects'); return; }
            const { project: p } = await projRes.json();
            const { activities: a } = await actRes.json();
            setProject(p);
            setActivities(a || []);
        } finally {
            setIsLoading(false);
        }
    }, [auth.isActivated, auth.getAuthHeaders, id, router]);

    useEffect(() => { if (auth.isActivated) loadData(); }, [auth.isActivated, loadData]);

    const handleStatusChange = async (status: Project['status']) => {
        if (!project) return;
        setProject(await updateProject(id, { status }));
    };

    const handleColorChange = async (color: string) => {
        if (!project) return;
        setProject(await updateProject(id, { color }));
    };

    const handleTitleSave = async () => {
        if (!titleDraft.trim() || !project) return;
        setProject(await updateProject(id, { title: titleDraft.trim() }));
        setEditingTitle(false);
    };

    const handleAddItem = async () => {
        if (!addTitle.trim()) return;
        setIsSavingItem(true);
        try {
            const body: Record<string, unknown> = {
                title: addTitle.trim(), type: addType,
                status: 'needs_action', project_id: id,
            };
            if (addDate) {
                if (addType === 'task') body.end_time = new Date(addDate).toISOString();
                else body.start_time = new Date(addDate).toISOString();
            }
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.ok) {
                setActivities(prev => [data.activity, ...prev]);
                setAddTitle(''); setAddDate(''); setShowAddForm(false);
            }
        } finally {
            setIsSavingItem(false);
        }
    };

    const handleToggle = async (a: Activity) => {
        const newStatus = a.status === 'completed' ? 'needs_action' : 'completed';
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id, status: newStatus }),
        });
        const data = await res.json();
        if (res.ok) setActivities(prev => prev.map(x => x.id === a.id ? data.activity : x));
    };

    const handleDeleteItem = async (itemId: string) => {
        const res = await fetch(`/api/activities?id=${itemId}`, { method: 'DELETE', headers: auth.getAuthHeaders() });
        if (res.ok) setActivities(prev => prev.filter(a => a.id !== itemId));
        setDeleteItemId(null);
    };

    // ── Voice recording ────────────────────────────────────────────────────────
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
                const addLog = (msg: string) => logs.push(msg);
                addLog(`音频大小: ${(audioBlob.size / 1024).toFixed(1)}KB`);
                try {
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'record.webm');
                    formData.append('project_id', id);
                    const res = await fetch('/api/voice-intent-audio', {
                        method: 'POST',
                        headers: {
                            'x-activation-token': auth.getAuthHeaders()['x-activation-token'],
                            'x-device-fingerprint': auth.getAuthHeaders()['x-device-fingerprint'],
                        },
                        body: formData,
                    });
                    const data = await res.json();
                    addLog(`Gemini 转写+意图+工具调用: ${Date.now() - t0}ms\n识别: "${data.transcript || ''}"\n工具: ${data.tool || '?'}`);
                    if (!res.ok || !data.success) throw new Error(data.error || '语音处理失败');
                    const t3 = Date.now();
                    await loadData();
                    addLog(`列表刷新: ${Date.now() - t3}ms`);
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

    if (!auth.isActivated || isLoading) {
        return <main className="flex items-center justify-center h-[100dvh] bg-background"><Loader2 size={24} className="animate-spin text-zinc-500" /></main>;
    }
    if (!project) return null;

    const completedCount = activities.filter(a => a.status === 'completed').length;

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
            {/* Header */}
            <header className="flex-none px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-card z-10">
                <button onClick={() => router.push('/projects')} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                    {editingTitle ? (
                        <div className="flex items-center gap-2">
                            <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false); }}
                                className="flex-1 bg-zinc-800 text-zinc-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-white/20" />
                            <button onClick={handleTitleSave} className="p-1 text-emerald-400"><Check size={16} /></button>
                            <button onClick={() => setEditingTitle(false)} className="p-1 text-zinc-500"><X size={16} /></button>
                        </div>
                    ) : (
                        <button onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }} className="flex items-center gap-2 group">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
                            <span className="text-base font-semibold truncate">{project.title}</span>
                            <Pencil size={13} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </button>
                    )}
                </div>
                {/* View mode toggle */}
                <button
                    onClick={() => setViewMode(v => v === 'grouped' ? 'timeline' : 'grouped')}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0 text-zinc-400 hover:text-zinc-200"
                    title={viewMode === 'grouped' ? '切换为时间线' : '切换为分组'}
                >
                    {viewMode === 'grouped' ? <Clock size={18} /> : <LayoutList size={18} />}
                </button>
            </header>

            {/* Project meta */}
            <div className="flex-none px-4 py-3 border-b border-white/5 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                    {(Object.keys(STATUS_LABELS) as Project['status'][]).map(s => (
                        <button key={s} onClick={() => handleStatusChange(s)}
                            className={`text-[11px] font-medium px-3 py-1 rounded-full transition-colors ${project.status === s ? 'bg-white/15 text-zinc-100' : 'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300'}`}>
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex gap-1.5">
                        {PROJECT_COLORS.map(c => (
                            <button key={c} onClick={() => handleColorChange(c)}
                                className={`w-5 h-5 rounded-full transition-transform ${project.color === c ? 'scale-125 ring-2 ring-white/40' : ''}`}
                                style={{ backgroundColor: c }} />
                        ))}
                    </div>
                    {project.due_date && (
                        <span className="text-xs text-zinc-500">截止 {new Date(project.due_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    )}
                    {activities.length > 0 && (
                        <span className="text-xs text-zinc-500">{completedCount}/{activities.length} 已完成</span>
                    )}
                </div>
            </div>

            {/* Activity list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {activities.length === 0 && (
                    <p className="text-center text-sm text-zinc-500 py-8">按下麦克风，用语音添加里程碑、会议、待办或提醒</p>
                )}

                {viewMode === 'grouped' ? (
                    // ── Grouped view ──────────────────────────────────────────
                    <>
                        {TYPE_ORDER.map(typeKey => {
                            const group = activities.filter(a => a.type === typeKey);
                            if (group.length === 0) return null;
                            const cfg = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.task;
                            return (
                                <div key={typeKey}>
                                    <div className={`flex items-center gap-1.5 text-xs font-semibold mb-2 ${cfg.color}`}>
                                        {cfg.icon}<span>{cfg.label}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {group.map(a => <ActivityCard key={a.id} a={a} onToggle={handleToggle} onDelete={id => setDeleteItemId(id)} />)}
                                    </div>
                                </div>
                            );
                        })}
                        {activities.filter(a => !TYPE_ORDER.includes(a.type)).map(a => (
                            <ActivityCard key={a.id} a={a} onToggle={handleToggle} onDelete={id => setDeleteItemId(id)} />
                        ))}
                    </>
                ) : (
                    // ── Timeline view ─────────────────────────────────────────
                    <div className="space-y-2">
                        {[...activities]
                            .sort((a, b) => {
                                const ta = new Date(a.start_time || a.end_time || a.created_at).getTime();
                                const tb = new Date(b.start_time || b.end_time || b.created_at).getTime();
                                return ta - tb;
                            })
                            .map(a => <ActivityCard key={a.id} a={a} showTypeBadge onToggle={handleToggle} onDelete={id => setDeleteItemId(id)} />)
                        }
                    </div>
                )}
            </div>

            {/* Bottom FABs: mic (center) + manual add (right) */}
            <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-0 right-0 flex justify-center items-end px-6 gap-4 pointer-events-none">
                <div className="pointer-events-auto">
                    <button
                        onClick={toggleRecording}
                        disabled={isProcessingVoice}
                        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-zinc-50 hover:scale-105 active:scale-95'} ${isProcessingVoice ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {isProcessingVoice ? <Loader2 size={24} className="text-zinc-950 animate-spin" /> : <Mic size={24} className={isRecording ? 'text-white' : 'text-zinc-950'} />}
                    </button>
                </div>
                <div className="pointer-events-auto mb-1">
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center shadow transition-all hover:scale-105 active:scale-95"
                    >
                        <Plus size={18} className="text-zinc-200" />
                    </button>
                </div>
            </div>

            {/* Manual add form */}
            {showAddForm && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-t-2xl w-full max-w-lg p-5 space-y-3 animate-in slide-in-from-bottom-4 duration-200">
                        <h2 className="text-sm font-semibold text-zinc-100">手动添加</h2>
                        {/* Type selector */}
                        <div className="flex gap-2">
                            {TYPE_ORDER.map(t => {
                                const cfg = TYPE_CONFIG[t];
                                return (
                                    <button key={t} onClick={() => setAddType(t)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${addType === t ? `${cfg.bg} ${cfg.color} ring-1 ring-current` : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                                        {cfg.icon}{cfg.label}
                                    </button>
                                );
                            })}
                        </div>
                        <input autoFocus value={addTitle} onChange={e => setAddTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setShowAddForm(false); }}
                            placeholder="标题"
                            className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20" />
                        <input type="datetime-local" value={addDate} onChange={e => setAddDate(e.target.value)}
                            className="w-full bg-zinc-800 text-zinc-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20" />
                        <div className="flex gap-3 pt-1">
                            <button onClick={() => { setShowAddForm(false); setAddTitle(''); setAddDate(''); }}
                                className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors">取消</button>
                            <button onClick={handleAddItem} disabled={!addTitle.trim() || isSavingItem}
                                className="flex-1 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 hover:bg-indigo-400 transition-colors flex items-center justify-center gap-2">
                                {isSavingItem ? <Loader2 size={15} className="animate-spin" /> : '添加'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Voice timing log */}
            {voiceLog && (
                <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl">
                        <div className="flex items-center justify-between px-4 pt-4 pb-2">
                            <span className="text-sm font-semibold text-zinc-200">语音延迟日志</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => { navigator.clipboard.writeText(voiceLog); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000); }}
                                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-white/5">
                                    <Copy size={13} />{logCopied ? '已复制' : '复制'}
                                </button>
                                <button onClick={() => setVoiceLog(null)} className="p-1 text-zinc-500 hover:text-zinc-200"><XIcon size={16} /></button>
                            </div>
                        </div>
                        <pre className="px-4 pb-4 text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{voiceLog}</pre>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {deleteItemId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm">
                        <h3 className="text-base font-semibold text-zinc-100 mb-2">删除条目</h3>
                        <p className="text-sm text-zinc-400 mb-6">确定要删除吗？</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setDeleteItemId(null)} className="px-4 py-2 rounded-xl text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors">取消</button>
                            <button onClick={() => handleDeleteItem(deleteItemId)} className="px-4 py-2 rounded-xl text-sm text-white bg-red-500/80 hover:bg-red-500 transition-colors">删除</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
