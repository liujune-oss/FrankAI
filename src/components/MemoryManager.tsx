import React, { useEffect, useState } from 'react';
import { useMemories, Memory } from '@/hooks/useMemories';
import { Loader2, BrainCircuit, Trash2, Edit2, Check, X, AlertTriangle } from 'lucide-react';

interface MemoryManagerProps {
    open: boolean;
    onClose: () => void;
}

export default function MemoryManager({ open, onClose }: MemoryManagerProps) {
    const { memories, isLoading, error, fetchMemories, deleteMemory, updateMemory, clearAllMemories } = useMemories();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        if (open) {
            fetchMemories();
        } else {
            setEditingId(null);
        }
    }, [open, fetchMemories]);

    if (!open) return null;

    const handleEditClick = (memory: Memory) => {
        setEditingId(memory.id);
        setEditContent(memory.summary_text);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditContent('');
    };

    const handleSaveEdit = async (id: string) => {
        if (!editContent.trim()) return;
        setIsUpdating(true);
        const success = await updateMemory(id, editContent);
        setIsUpdating(false);
        if (success) {
            setEditingId(null);
        } else {
            alert("保存失败，请稍后重试");
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('确定要删除这条记忆吗？')) {
            await deleteMemory(id);
        }
    };

    const handleClearAll = async () => {
        if (confirm('警告：此操作不可逆！确定要清空所有已保存的专属记忆吗？')) {
            await clearAllMemories();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-background border rounded-2xl shadow-xl w-full max-w-[95%] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-xl">
                            <BrainCircuit className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold leading-none mb-1">记忆管理</h2>
                            <p className="text-xs text-muted-foreground">管理 AI 为你提取的长期个人专属记忆</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                            <p className="text-sm">正在加载记忆库...</p>
                        </div>
                    ) : memories.length === 0 ? (
                        <div className="text-center py-16">
                            <BrainCircuit className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-foreground mb-1">记忆库空空如也</h3>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                在聊天页面的左侧抽屉中，点击会话列表旁边的星花图标，即可让 AI 长期记住当前对话中的核心信息。
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {memories.map(memory => (
                                <div key={memory.id} className="group bg-card border rounded-xl p-4 transition-all hover:border-primary/30 hover:shadow-sm">
                                    <div className="flex justify-between items-start mb-2 gap-4">
                                        <div className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-md">
                                            {new Date(memory.created_at).toLocaleString("zh-CN", {
                                                year: "numeric", month: "short", day: "numeric",
                                                hour: "2-digit", minute: "2-digit"
                                            })}
                                        </div>
                                        {memory.session_id && (
                                            <div className="text-xs text-muted-foreground font-mono bg-blue-500/10 px-2 py-0.5 rounded-md truncate max-w-[120px] sm:max-w-[200px]" title={`关联会话 ID: ${memory.session_id}`}>
                                                关联: {memory.session_id.substring(0, 8)}...
                                            </div>
                                        )}
                                        <div className="flex-1" />
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {editingId !== memory.id && (
                                                <>
                                                    <button onClick={() => handleEditClick(memory)} className="p-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 rounded-md transition-colors" title="编辑记忆文本并重新向量化">
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDelete(memory.id)} className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors" title="删除当前记忆">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {editingId === memory.id ? (
                                        <div className="mt-3">
                                            <textarea
                                                className="w-full min-h-[100px] text-sm bg-muted/40 border border-primary/50 text-foreground p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                            />
                                            <div className="flex justify-end gap-2 mt-3">
                                                <button
                                                    onClick={handleCancelEdit}
                                                    disabled={isUpdating}
                                                    className="px-3 py-1.5 text-sm hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={() => handleSaveEdit(memory.id)}
                                                    disabled={isUpdating || !editContent.trim() || editContent === memory.summary_text}
                                                    className="px-4 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                                >
                                                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                    重新向量化并保存
                                                </button>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                                修改文本后将调用模型重新生成嵌入向量，这可能会消耗少量 Token。
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                            {memory.summary_text}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {memories.length > 0 && (
                    <div className="px-6 py-4 border-t bg-muted/20 flex justify-between items-center">
                        <span className="text-xs text-muted-foreground font-medium">总计 {memories.length} 条记忆片段</span>
                        <button
                            onClick={handleClearAll}
                            className="text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 px-3 py-1.5 rounded-md transition-colors"
                        >
                            清空所有记忆
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
