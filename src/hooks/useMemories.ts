import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';

export interface Memory {
    id: string;
    summary_text: string;
    created_at: string;
    session_id?: string;
}

export function useMemories() {
    const { getAuthHeaders } = useAuth();
    const [memories, setMemories] = useState<Memory[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchMemories = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/memories', {
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) {
                setMemories(data.memories || []);
            } else {
                setError(data.error || '加载记忆失败');
            }
        } catch (err: any) {
            setError(err.message || '网络错误，加载记忆失败');
        } finally {
            setIsLoading(false);
        }
    }, [getAuthHeaders]);

    const deleteMemory = useCallback(async (id: string) => {
        try {
            const res = await fetch('/api/memories', {
                method: 'DELETE',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id }),
            });
            const data = await res.json();
            if (data.success) {
                setMemories((prev) => prev.filter((m) => m.id !== id));
                return true;
            } else {
                setError(data.error || '删除记忆失败');
                return false;
            }
        } catch (err: any) {
            setError(err.message || '网络错误，删除记忆失败');
            return false;
        }
    }, [getAuthHeaders]);

    const clearAllMemories = useCallback(async () => {
        try {
            const res = await fetch('/api/memories', {
                method: 'DELETE',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ clearAll: true }),
            });
            const data = await res.json();
            if (data.success) {
                setMemories([]);
                return true;
            } else {
                setError(data.error || '清空记忆失败');
                return false;
            }
        } catch (err: any) {
            setError(err.message || '网络错误，清空记忆失败');
            return false;
        }
    }, [getAuthHeaders]);

    const updateMemory = useCallback(async (id: string, newContent: string) => {
        try {
            const res = await fetch('/api/memories', {
                method: 'PUT',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, content: newContent }),
            });
            const data = await res.json();
            if (data.success && data.memory) {
                setMemories((prev) =>
                    prev.map((m) => (m.id === id ? data.memory : m))
                );
                return true;
            } else {
                setError(data.error || '更新记忆失败');
                return false;
            }
        } catch (err: any) {
            setError(err.message || '网络错误，更新记忆失败');
            return false;
        }
    }, [getAuthHeaders]);

    return {
        memories,
        isLoading,
        error,
        fetchMemories,
        deleteMemory,
        clearAllMemories,
        updateMemory,
    };
}
