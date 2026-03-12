"use client";

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

export interface ActivityStats {
    total: number;
    completed: number;
}

export type ProjectPriority = 'low' | 'medium' | 'high';

export interface Project {
    id: string;
    title: string;
    description?: string;
    status: 'planning' | 'in_progress' | 'completed' | 'on_hold';
    priority?: ProjectPriority;
    due_date?: string;
    color: string;
    created_at: string;
    updated_at: string;
    activity_stats?: ActivityStats;
}

export const PRIORITY_LABELS: Record<ProjectPriority, string> = {
    low: '低',
    medium: '中',
    high: '高',
};

export const PRIORITY_COLORS: Record<ProjectPriority, { bg: string; text: string; border: string }> = {
    low: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', border: 'border-zinc-500/30' },
    medium: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
    high: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
};

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

const CACHE_KEY = 'projects_cache';

function readCache(): Project[] {
    if (typeof window === 'undefined') return [];
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? JSON.parse(cached) : [];
    } catch { return []; }
}

function writeCache(data: Project[]) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { }
}

export function useProjects() {
    const auth = useAuth();
    const [projects, setProjects] = useState<Project[]>(() => readCache());
    // Only show spinner if there's truly nothing to show yet
    const [isLoading, setIsLoading] = useState(() => readCache().length === 0);

    const fetchProjects = useCallback(async () => {
        if (!auth.isActivated) return;
        // Silent refresh if we already have cached data
        if (readCache().length === 0) setIsLoading(true);
        try {
            const res = await fetch('/api/projects', { headers: auth.getAuthHeaders() });
            const data = await res.json();
            if (res.ok) {
                setProjects(data.projects || []);
                writeCache(data.projects || []);
            }
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
        setProjects(prev => {
            const next = [data.project, ...prev];
            writeCache(next);
            return next;
        });
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
        setProjects(prev => {
            const next = prev.map(p => p.id === id ? data.project : p);
            writeCache(next);
            return next;
        });
        return data.project as Project;
    };

    const deleteProject = async (id: string) => {
        const res = await fetch(`/api/projects/${id}`, {
            method: 'DELETE',
            headers: auth.getAuthHeaders(),
        });
        if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
        setProjects(prev => {
            const next = prev.filter(p => p.id !== id);
            writeCache(next);
            return next;
        });
    };

    return { projects, isLoading, fetchProjects, createProject, updateProject, deleteProject };
}
