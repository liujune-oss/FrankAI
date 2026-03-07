"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useProjects, Project, PROJECT_COLORS, STATUS_LABELS } from "@/hooks/useProjects";
import { Activity } from "@/hooks/useActivities";
import { ArrowLeft, Plus, Trash2, CheckSquare, Square, Loader2, Pencil, Check, X } from "lucide-react";

export default function ProjectDetailPage() {
    const params = useParams();
    const router = useRouter();
    const auth = useAuth();
    const id = params.id as string;

    const { updateProject, deleteProject } = useProjects();
    const [project, setProject] = useState<Project | null>(null);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Edit project title inline
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');

    // Add task form
    const [showAddTask, setShowAddTask] = useState(false);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDueDate, setTaskDueDate] = useState('');
    const [isSavingTask, setIsSavingTask] = useState(false);

    // Delete task dialog
    const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

    const loadProject = useCallback(async () => {
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

    useEffect(() => {
        if (auth.isActivated) loadProject();
    }, [auth.isActivated, loadProject]);

    const handleStatusChange = async (status: Project['status']) => {
        if (!project) return;
        const updated = await updateProject(id, { status });
        setProject(updated);
    };

    const handleColorChange = async (color: string) => {
        if (!project) return;
        const updated = await updateProject(id, { color });
        setProject(updated);
    };

    const handleTitleSave = async () => {
        if (!titleDraft.trim() || !project) return;
        const updated = await updateProject(id, { title: titleDraft.trim() });
        setProject(updated);
        setEditingTitle(false);
    };

    const handleAddTask = async () => {
        if (!taskTitle.trim()) return;
        setIsSavingTask(true);
        try {
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: taskTitle.trim(),
                    type: 'task',
                    status: 'needs_action',
                    project_id: id,
                    end_time: taskDueDate ? new Date(taskDueDate).toISOString() : undefined,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setActivities(prev => [data.activity, ...prev]);
                setTaskTitle(''); setTaskDueDate(''); setShowAddTask(false);
            }
        } finally {
            setIsSavingTask(false);
        }
    };

    const handleToggleTask = async (activity: Activity) => {
        const newStatus = activity.status === 'completed' ? 'needs_action' : 'completed';
        const res = await fetch('/api/activities', {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activity.id, status: newStatus }),
        });
        const data = await res.json();
        if (res.ok) setActivities(prev => prev.map(a => a.id === activity.id ? data.activity : a));
    };

    const handleDeleteTask = async (taskId: string) => {
        const res = await fetch(`/api/activities?id=${taskId}`, {
            method: 'DELETE',
            headers: auth.getAuthHeaders(),
        });
        if (res.ok) setActivities(prev => prev.filter(a => a.id !== taskId));
        setDeleteTaskId(null);
    };

    const handleDeleteProject = async () => {
        await deleteProject(id);
        router.push('/projects');
    };

    if (!auth.isActivated || isLoading) {
        return (
            <main className="flex items-center justify-center h-[100dvh] bg-background">
                <Loader2 size={24} className="animate-spin text-zinc-500" />
            </main>
        );
    }

    if (!project) return null;

    const completedCount = activities.filter(a => a.status === 'completed').length;

    return (
        <main className="flex flex-col h-[100dvh] bg-background w-full md:max-w-4xl mx-auto shadow-sm pb-[env(safe-area-inset-bottom)] relative overflow-hidden">
            {/* Header */}
            <header className="flex-none px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-card text-card-foreground z-10">
                <button onClick={() => router.push('/projects')} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                    {editingTitle ? (
                        <div className="flex items-center gap-2">
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={e => setTitleDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false); }}
                                className="flex-1 bg-zinc-800 text-zinc-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                            <button onClick={handleTitleSave} className="p-1 text-emerald-400"><Check size={16} /></button>
                            <button onClick={() => setEditingTitle(false)} className="p-1 text-zinc-500"><X size={16} /></button>
                        </div>
                    ) : (
                        <button
                            onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
                            className="flex items-center gap-2 group"
                        >
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
                            <span className="text-base font-semibold truncate">{project.title}</span>
                            <Pencil size={13} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </button>
                    )}
                </div>
            </header>

            {/* Project meta */}
            <div className="flex-none px-4 py-3 border-b border-white/5 space-y-3">
                {/* Status */}
                <div className="flex items-center gap-2 flex-wrap">
                    {(Object.keys(STATUS_LABELS) as Project['status'][]).map(s => (
                        <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`text-[11px] font-medium px-3 py-1 rounded-full transition-colors ${project.status === s
                                ? 'bg-white/15 text-zinc-100'
                                : 'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300'
                                }`}
                        >
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
                {/* Color + due + task count */}
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex gap-1.5">
                        {PROJECT_COLORS.map(c => (
                            <button
                                key={c}
                                onClick={() => handleColorChange(c)}
                                className={`w-5 h-5 rounded-full transition-transform ${project.color === c ? 'scale-125 ring-2 ring-white/40' : ''}`}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                    {project.due_date && (
                        <span className="text-xs text-zinc-500">
                            截止 {new Date(project.due_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                    )}
                    {activities.length > 0 && (
                        <span className="text-xs text-zinc-500">
                            {completedCount}/{activities.length} 已完成
                        </span>
                    )}
                </div>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {activities.length === 0 && !showAddTask && (
                    <p className="text-center text-sm text-zinc-500 py-8">暂无任务，点击下方 + 添加</p>
                )}
                {activities.map(a => (
                    <div key={a.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${a.status === 'completed' ? 'bg-zinc-500/10 border-white/5 opacity-50' : 'bg-zinc-900 border-white/5'}`}>
                        <button onClick={() => handleToggleTask(a)} className="flex-shrink-0">
                            {a.status === 'completed'
                                ? <CheckSquare size={18} className="text-emerald-500" />
                                : <Square size={18} className="text-emerald-500/50" />
                            }
                        </button>
                        <div className="flex-1 min-w-0">
                            <span className={`text-[14px] font-medium ${a.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
                                {a.title}
                            </span>
                            {a.end_time && (
                                <p className="text-[11px] text-zinc-500 mt-0.5">
                                    {new Date(a.end_time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                                </p>
                            )}
                        </div>
                        <button onClick={() => setDeleteTaskId(a.id)} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0">
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}

                {/* Inline add task form */}
                {showAddTask && (
                    <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-3 space-y-2">
                        <input
                            autoFocus
                            value={taskTitle}
                            onChange={e => setTaskTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') setShowAddTask(false); }}
                            placeholder="任务名称"
                            className="w-full bg-transparent text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none"
                        />
                        <input
                            type="date"
                            value={taskDueDate}
                            onChange={e => setTaskDueDate(e.target.value)}
                            className="w-full bg-transparent text-zinc-400 text-xs focus:outline-none"
                        />
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => { setShowAddTask(false); setTaskTitle(''); setTaskDueDate(''); }}
                                className="flex-1 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-xs font-medium hover:bg-zinc-600 transition-colors"
                            >取消</button>
                            <button
                                onClick={handleAddTask}
                                disabled={!taskTitle.trim() || isSavingTask}
                                className="flex-1 py-2 rounded-lg bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 hover:bg-indigo-400 transition-colors flex items-center justify-center gap-1"
                            >
                                {isSavingTask ? <Loader2 size={13} className="animate-spin" /> : '添加'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Add task FAB */}
            <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] right-6">
                <button
                    onClick={() => setShowAddTask(true)}
                    className="w-12 h-12 rounded-full bg-indigo-500 hover:bg-indigo-400 flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95"
                >
                    <Plus size={22} className="text-white" />
                </button>
            </div>

            {/* Delete task dialog */}
            {deleteTaskId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm">
                        <h3 className="text-base font-semibold text-zinc-100 mb-2">删除任务</h3>
                        <p className="text-sm text-zinc-400 mb-6">确定要删除这条任务吗？</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setDeleteTaskId(null)} className="px-4 py-2 rounded-xl text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors">取消</button>
                            <button onClick={() => handleDeleteTask(deleteTaskId)} className="px-4 py-2 rounded-xl text-sm text-white bg-red-500/80 hover:bg-red-500 transition-colors">删除</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
