"use client";

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

export interface Project {
    id: string;
    title: string;
    description?: string;
    status: 'planning' | 'in_progress' | 'completed' | 'on_hold';
    due_date?: string;
    color: string;
    created_at: string;
    updated_at: string;
}

export const PROJECT_COLORS = [
    '#6366f1', '#10b981', '#0ea5e9', '#f59e0b',
    '#f43f5e', '#8b5cf6', '#f97316', '#14b8a6',
];

export const STATUS_LABELS: Record<Project['status'], string> = {
    planning: '规划中',
    in_progress: '进行中',
    completed: '已完成',
    on_hold: '已暂停',
};

export function useProjects() {
    const auth = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchProjects = useCallback(async () => {
        if (!auth.isActivated) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/projects', { headers: auth.getAuthHeaders() });
            const data = await res.json();
            if (res.ok) setProjects(data.projects || []);
        } finally {
            setIsLoading(false);
        }
    }, [auth.isActivated, auth.getAuthHeaders]);

    const createProject = async (payload: Partial<Project>) => {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setProjects(prev => [data.project, ...prev]);
        return data.project as Project;
    };

    const updateProject = async (id: string, payload: Partial<Project>) => {
        const res = await fetch(`/api/projects/${id}`, {
            method: 'PUT',
            headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setProjects(prev => prev.map(p => p.id === id ? data.project : p));
        return data.project as Project;
    };

    const deleteProject = async (id: string) => {
        const res = await fetch(`/api/projects/${id}`, {
            method: 'DELETE',
            headers: auth.getAuthHeaders(),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error);
        }
        setProjects(prev => prev.filter(p => p.id !== id));
    };

    return { projects, isLoading, fetchProjects, createProject, updateProject, deleteProject };
}
