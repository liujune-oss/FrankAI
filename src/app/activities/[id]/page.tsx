"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Activity, Subtask } from "@/hooks/useActivities";
import { ArrowLeft, Pencil, Check, X, Trash2, Loader2, MapPin, Tag, Calendar, AlignLeft, Mic, Plus, Circle, CheckCircle2 } from "lucide-react";

const TYPE_OPTIONS = [
    { value: 'task',      label: '待办',   color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    { value: 'event',     label: '日程',   color: 'text-blue-400',    bg: 'bg-blue-500/15' },
    { value: 'reminder',  label: '提醒',   color: 'text-pink-400',    bg: 'bg-pink-500/15' },
    { value: 'log',       label: '随手记', color: 'text-purple-400',  bg: 'bg-purple-500/15' },
    { value: 'milestone', label: '里程碑', color: 'text-amber-400',   bg: 'bg-amber-500/15' },
] as const;

const STATUS_OPTIONS = [
    { value: 'needs_action', label: '待处理' },
    { value: 'in_process',   label: '进行中' },
    { value: 'completed',    label: '已完成' },
    { value: 'cancelled',    label: '已取消' },
] as const;

const PRIORITY_OPTIONS = [
    { value: 'low',    label: '低',   color: 'text-zinc-400' },
    { value: 'medium', label: '中',   color: 'text-blue-400' },
    { value: 'high',   label: '高',   color: 'text-orange-400' },
    { value: 'urgent', label: '紧急', color: 'text-red-400' },
] as const;

// Convert ISO UTC string → datetime-local input value (local time)
function toInputVal(iso?: string) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(iso: string) {
    return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// Invalidate activities_cache after an edit/delete
function patchCache(id: string, updated: Activity | null) {
    try {
        const raw = localStorage.getItem('activities_cache');
        if (!raw) return;
        const arr: Activity[] = JSON.parse(raw);
        const next = updated
            ? arr.map(a => a.id === id ? updated : a)
            : arr.filter(a => a.id !== id);
        localStorage.setItem('activities_cache', JSON.stringify(next));
        window.dispatchEvent(new Event('activities_cache_updated'));
    } catch { }
}

export default function ActivityDetailPage() {
    const params = useParams();
    const router = useRouter();
    const auth = useAuth();
    const id = params.id as string;

    const [activity, setActivity] = useState<Activity | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [draft, setDraft] = useState<Partial<Activity>>({});
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    // Subtask state
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [isAddingSubtask, setIsAddingSubtask] = useState(false);

    useEffect(() => {
        if (!auth.isActivated) return;
        fetch(`/api/activities?id=${id}`, { headers: auth.getAuthHeaders() })
            .then(res => res.json())
            .then(data => {
                if (data.activity) {
                    setActivity(data.activity);
                    setDraft(data.activity);
                }
            })
            .finally(() => setIsLoading(false));
    }, [auth.isActivated]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSave = async () => {
        if (!activity) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/activities', {
                method: 'PUT',
                headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...draft }),
            });
            const data = await res.json();
            if (res.ok) {
                setActivity(data.activity);
                setDraft(data.activity);
                setIsEditing(false);
                patchCache(id, data.activity);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleStatusToggle = async () => {
        if (!activity) return;
        const newStatus = activity.status === 'completed' ? 'needs_action' : 'completed';
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status: newStatus }),
        });
        const data = await res.json();
        if (res.ok) {
            setActivity(data.activity);
            patchCache(id, data.activity);
        }
    };

    const handleMicToggle = async () => {
        if (isTranscribing) return;

        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            const chunks: BlobPart[] = [];

            mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: 'audio/webm' });
                if (blob.size < 4000) return;
                setIsTranscribing(true);
                try {
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
                    const newDesc = activity?.description
                        ? `${activity.description}\n\n[${now}] ${transcript.trim()}`
                        : `[${now}] ${transcript.trim()}`;
                    const res = await fetch('/api/activities', {
                        method: 'PUT',
                        headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, description: newDesc }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                        setActivity(data.activity);
                        setDraft(data.activity);
                        patchCache(id, data.activity);
                    }
                } catch (err: any) {
                    alert('语音备注失败：' + err.message);
                } finally {
                    setIsTranscribing(false);
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err: any) {
            alert('无法访问麦克风：' + err.message);
        }
    };

    const handleDelete = async () => {
        const res = await fetch(`/api/activities?id=${id}`, {
            method: 'DELETE',
            headers: auth.getAuthHeaders(),
        });
        if (res.ok) {
            patchCache(id, null);
            router.back();
        }
    };

    // ── Subtask handlers ─────────────────────────────────────────────────────
    const handleAddSubtask = async () => {
        if (!newSubtaskTitle.trim() || !activity) return;
        const newSubtask: Subtask = {
            id: crypto.randomUUID(),
            title: newSubtaskTitle.trim(),
            completed: false,
        };
        const updatedSubtasks = [...(activity.subtasks || []), newSubtask];
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, subtasks: updatedSubtasks }),
        });
        const data = await res.json();
        if (res.ok) {
            setActivity(data.activity);
            patchCache(id, data.activity);
            setNewSubtaskTitle('');
            setIsAddingSubtask(false);
        }
    };

    const handleToggleSubtask = async (subtaskId: string) => {
        if (!activity) return;
        const updatedSubtasks = (activity.subtasks || []).map(st =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
        );
        // 全部子任务完成 → 父任务自动标为已完成；有未完成 → 恢复 needs_action（若当前已完成）
        const allDone = updatedSubtasks.length > 0 && updatedSubtasks.every(s => s.completed);
        const newStatus = allDone ? 'completed'
            : (activity.status === 'completed' ? 'needs_action' : activity.status);
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, subtasks: updatedSubtasks, status: newStatus }),
        });
        const data = await res.json();
        if (res.ok) {
            setActivity(data.activity);
            setDraft(data.activity);
            patchCache(id, data.activity);
        }
    };

    const handleDeleteSubtask = async (subtaskId: string) => {
        if (!activity) return;
        const updatedSubtasks = (activity.subtasks || []).filter(st => st.id !== subtaskId);
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, subtasks: updatedSubtasks }),
        });
        const data = await res.json();
        if (res.ok) {
            setActivity(data.activity);
            patchCache(id, data.activity);
        }
    };

    // Calculate subtask progress
    const subtaskProgress = (() => {
        if (!activity?.subtasks?.length) return null;
        const completed = activity.subtasks.filter(st => st.completed).length;
        return { completed, total: activity.subtasks.length };
    })();

    if (!auth.isActivated || isLoading) {
        return (
            <main className="flex items-center justify-center h-[100dvh] bg-background">
                <Loader2 size={24} className="animate-spin text-zinc-500" />
            </main>
        );
    }

    if (!activity) {
        return (
            <main className="flex flex-col items-center justify-center h-[100dvh] bg-background gap-3">
                <p className="text-zinc-500 text-sm">未找到该条目</p>
                <button onClick={() => router.back()} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">返回</button>
            </main>
        );
    }

    const typeCfg = TYPE_OPTIONS.find(t => t.value === activity.type) ?? TYPE_OPTIONS[0];
    const statusCfg = STATUS_OPTIONS.find(s => s.value === activity.status) ?? STATUS_OPTIONS[0];
    const priorityCfg = PRIORITY_OPTIONS.find(p => p.value === activity.priority) ?? PRIORITY_OPTIONS[1];
    const canToggleStatus = activity.type !== 'log' && activity.type !== 'milestone';

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] overflow-hidden">

            {/* Header */}
            <header className="flex-none px-4 py-3 border-b border-white/5 flex items-center gap-2 bg-card">
                <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1" />
                {isEditing ? (
                    <>
                        <button
                            onClick={() => { setIsEditing(false); setDraft(activity); }}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-zinc-400"
                        >
                            <X size={18} />
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-400 transition-colors disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            保存
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                            <Trash2 size={18} />
                        </button>
                        <button
                            onClick={handleMicToggle}
                            disabled={isTranscribing}
                            className={`p-1.5 rounded-lg transition-colors ${isRecording ? 'text-red-400 animate-pulse' : 'text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10'}`}
                        >
                            {isTranscribing
                                ? <Loader2 size={18} className="animate-spin" />
                                : <Mic size={18} />}
                        </button>
                        <button
                            onClick={() => setIsEditing(true)}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-zinc-400 hover:text-zinc-200"
                        >
                            <Pencil size={18} />
                        </button>
                    </>
                )}
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {isEditing ? (
                    // ── Edit mode ────────────────────────────────────────────────────
                    <>
                        {/* Title */}
                        <input
                            autoFocus
                            value={draft.title || ''}
                            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                            placeholder="标题"
                            className="w-full bg-zinc-800 text-zinc-100 text-lg font-semibold placeholder:text-zinc-500 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-white/20"
                        />

                        {/* Type */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">类型</p>
                            <div className="flex flex-wrap gap-2">
                                {TYPE_OPTIONS.map(t => (
                                    <button
                                        key={t.value}
                                        onClick={() => setDraft(d => ({ ...d, type: t.value as Activity['type'] }))}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${draft.type === t.value ? `${t.bg} ${t.color} ring-1 ring-current` : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Status */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">状态</p>
                            <div className="flex flex-wrap gap-2">
                                {STATUS_OPTIONS.map(s => (
                                    <button
                                        key={s.value}
                                        onClick={() => setDraft(d => ({ ...d, status: s.value as Activity['status'] }))}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${draft.status === s.value ? 'bg-white/15 text-zinc-100 ring-1 ring-white/20' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Priority */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">优先级</p>
                            <div className="flex gap-2">
                                {PRIORITY_OPTIONS.map(p => (
                                    <button
                                        key={p.value}
                                        onClick={() => setDraft(d => ({ ...d, priority: p.value as Activity['priority'] }))}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${draft.priority === p.value ? `bg-zinc-700 ${p.color} ring-1 ring-current` : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">备注</p>
                            <textarea
                                value={draft.description || ''}
                                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                                placeholder="添加备注..."
                                rows={3}
                                className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                            />
                        </div>

                        {/* Subtasks (edit mode) */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">子任务</p>
                            <div className="space-y-1.5 mb-2">
                                {(draft.subtasks || []).map(st => (
                                    <div key={st.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800">
                                        <button onClick={() => setDraft(d => ({ ...d, subtasks: (d.subtasks || []).map(s => s.id === st.id ? { ...s, completed: !s.completed } : s) }))} className="flex-shrink-0">
                                            {st.completed
                                                ? <CheckCircle2 size={16} className="text-emerald-400" />
                                                : <Circle size={16} className="text-zinc-500" />}
                                        </button>
                                        <span className={`text-sm flex-1 ${st.completed ? 'line-through text-zinc-500' : 'text-zinc-300'}`}>{st.title}</span>
                                        <button onClick={() => setDraft(d => ({ ...d, subtasks: (d.subtasks || []).filter(s => s.id !== st.id) }))} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={newSubtaskTitle}
                                    onChange={e => setNewSubtaskTitle(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const title = newSubtaskTitle.trim();
                                            if (!title) return;
                                            const newSt: Subtask = { id: crypto.randomUUID(), title, completed: false };
                                            setDraft(d => ({ ...d, subtasks: [...(d.subtasks || []), newSt] }));
                                            setNewSubtaskTitle('');
                                        }
                                    }}
                                    placeholder="添加子任务（回车确认）"
                                    className="flex-1 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                                />
                                <button
                                    onClick={() => {
                                        const title = newSubtaskTitle.trim();
                                        if (!title) return;
                                        const newSt: Subtask = { id: crypto.randomUUID(), title, completed: false };
                                        setDraft(d => ({ ...d, subtasks: [...(d.subtasks || []), newSt] }));
                                        setNewSubtaskTitle('');
                                    }}
                                    disabled={!newSubtaskTitle.trim()}
                                    className="px-3 py-2 bg-zinc-700 text-zinc-300 rounded-xl text-sm hover:bg-zinc-600 transition-colors disabled:opacity-40 flex-shrink-0"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Start time */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">开始时间</p>
                            <input
                                type="datetime-local"
                                value={toInputVal(draft.start_time)}
                                onChange={e => setDraft(d => ({ ...d, start_time: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                                className="w-full bg-zinc-800 text-zinc-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                        </div>

                        {/* End time */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">结束时间 / 截止</p>
                            <input
                                type="datetime-local"
                                value={toInputVal(draft.end_time)}
                                onChange={e => setDraft(d => ({ ...d, end_time: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                                className="w-full bg-zinc-800 text-zinc-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                        </div>

                        {/* Location */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">地点</p>
                            <input
                                value={draft.location || ''}
                                onChange={e => setDraft(d => ({ ...d, location: e.target.value }))}
                                placeholder="地点或链接"
                                className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                        </div>

                        {/* Tags */}
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-2 font-medium uppercase tracking-wide">标签（逗号分隔）</p>
                            <input
                                value={(draft.tags || []).join(', ')}
                                onChange={e => setDraft(d => ({ ...d, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
                                placeholder="例：工作, 重要"
                                className="w-full bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                        </div>
                    </>
                ) : (
                    // ── View mode ────────────────────────────────────────────────────
                    <>
                        {/* Badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${typeCfg.bg} ${typeCfg.color}`}>
                                {typeCfg.label}
                            </span>
                            <button
                                onClick={canToggleStatus ? handleStatusToggle : undefined}
                                className={`text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-zinc-300 transition-colors ${canToggleStatus ? 'hover:bg-white/10 cursor-pointer' : 'cursor-default'}`}
                            >
                                {statusCfg.label}
                            </button>
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 ${priorityCfg.color}`}>
                                {priorityCfg.label}优先级
                            </span>
                        </div>

                        {/* Title */}
                        <h1 className={`text-xl font-semibold leading-snug ${activity.status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-50'}`}>
                            {activity.title}
                        </h1>

                        {/* Description */}
                        {activity.description && (
                            <div className="flex gap-3 text-sm text-zinc-300 leading-relaxed">
                                <AlignLeft size={16} className="text-zinc-500 flex-shrink-0 mt-0.5" />
                                <p className="whitespace-pre-wrap">{activity.description}</p>
                            </div>
                        )}

                        {/* Time */}
                        {(activity.start_time || activity.end_time) && (
                            <div className="flex gap-3 items-start text-sm text-zinc-300">
                                <Calendar size={16} className="text-zinc-500 flex-shrink-0 mt-0.5" />
                                <div className="space-y-0.5">
                                    {activity.start_time && <p>{fmtTime(activity.start_time)}</p>}
                                    {activity.end_time && (
                                        <p className="text-zinc-400">
                                            {activity.start_time ? '→ ' : ''}{fmtTime(activity.end_time)}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Location */}
                        {activity.location && (
                            <div className="flex gap-3 text-sm text-zinc-300">
                                <MapPin size={16} className="text-zinc-500 flex-shrink-0 mt-0.5" />
                                <p>{activity.location}</p>
                            </div>
                        )}

                        {/* Tags */}
                        {activity.tags?.length > 0 && (
                            <div className="flex gap-3 items-center">
                                <Tag size={16} className="text-zinc-500 flex-shrink-0" />
                                <div className="flex flex-wrap gap-1.5">
                                    {activity.tags.map(tag => (
                                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Subtasks */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide">子任务</p>
                                {subtaskProgress && (
                                    <span className="text-[11px] text-zinc-400">{subtaskProgress.completed}/{subtaskProgress.total}</span>
                                )}
                            </div>
                            {/* Progress bar */}
                            {subtaskProgress && (
                                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-emerald-500 transition-all duration-300"
                                        style={{ width: `${(subtaskProgress.completed / subtaskProgress.total) * 100}%` }}
                                    />
                                </div>
                            )}
                            {/* Subtask list */}
                            <div className="space-y-1">
                                {(activity.subtasks || []).map(st => (
                                    <div key={st.id} className="flex items-center gap-2 group">
                                        <button
                                            onClick={() => handleToggleSubtask(st.id)}
                                            className="flex-shrink-0"
                                        >
                                            {st.completed
                                                ? <CheckCircle2 size={16} className="text-emerald-400" />
                                                : <Circle size={16} className="text-zinc-500" />
                                            }
                                        </button>
                                        <span className={`flex-1 text-sm ${st.completed ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                                            {st.title}
                                        </span>
                                        <button
                                            onClick={() => handleDeleteSubtask(st.id)}
                                            className="p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {/* Add subtask input */}
                            {isAddingSubtask ? (
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        autoFocus
                                        value={newSubtaskTitle}
                                        onChange={e => setNewSubtaskTitle(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleAddSubtask();
                                            if (e.key === 'Escape') { setIsAddingSubtask(false); setNewSubtaskTitle(''); }
                                        }}
                                        placeholder="子任务名称"
                                        className="flex-1 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                                    />
                                    <button onClick={handleAddSubtask} className="p-2 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors">
                                        <Check size={16} />
                                    </button>
                                    <button onClick={() => { setIsAddingSubtask(false); setNewSubtaskTitle(''); }} className="p-2 text-zinc-500 hover:bg-zinc-800 rounded-lg transition-colors">
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsAddingSubtask(true)}
                                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-1"
                                >
                                    <Plus size={14} />添加子任务
                                </button>
                            )}
                        </div>

                        {/* Meta */}
                        <div className="pt-3 border-t border-white/5 text-[11px] text-zinc-600 space-y-1">
                            <p>创建于 {fmtTime(activity.created_at)}</p>
                            {activity.updated_at !== activity.created_at && (
                                <p>更新于 {fmtTime(activity.updated_at)}</p>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Delete confirm */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-base font-semibold text-zinc-100 mb-2">确认删除</h3>
                        <p className="text-sm text-zinc-400 mb-6">确定要删除这条记录吗？此操作无法撤销。</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 rounded-xl text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-xl text-sm text-white bg-red-500/80 hover:bg-red-500 transition-colors"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
