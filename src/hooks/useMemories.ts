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
                setError(data.error || 'Failed to fetch memories');
            }
        } catch (err: any) {
            setError(err.message || 'Network error fetching memories');
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
                setError(data.error || 'Failed to delete memory');
                return false;
            }
        } catch (err: any) {
            setError(err.message || 'Network error deleting memory');
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
                setError(data.error || 'Failed to clear memories');
                return false;
            }
        } catch (err: any) {
            setError(err.message || 'Network error clearing memories');
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
                setError(data.error || 'Failed to update memory');
                return false;
            }
        } catch (err: any) {
            setError(err.message || 'Network error updating memory');
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
