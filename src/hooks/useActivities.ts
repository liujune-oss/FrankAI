"use client";

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

export interface Activity {
    id: string;
    title: string;
    description?: string;
    type: 'task' | 'event' | 'reminder' | 'log' | 'milestone';
    status: 'needs_action' | 'in_process' | 'completed' | 'cancelled';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    start_time?: string;
    end_time?: string;
    is_all_day: boolean;
    location?: string;
    tags: string[];
    created_at: string;
    updated_at: string;
}

export function useActivities() {
    const auth = useAuth();
    const [activities, setActivities] = useState<Activity[]>(() => {
        if (typeof window !== 'undefined') {
            try {
                const cached = localStorage.getItem('activities_cache');
                if (cached) return JSON.parse(cached);
            } catch (e) { }
        }
        return [];
    });
    // Only show loading if we have absolutely no cached data
    const [isLoading, setIsLoading] = useState(() => activities.length === 0);
    const [error, setError] = useState<string | null>(null);

    const fetchActivities = useCallback(async (params?: { type?: string; status?: string; start?: string; end?: string; force?: boolean }) => {
        if (!auth.isActivated) return;

        // If we have no activities at all, show the loading spinner. Otherwise, do it silently.
        if (activities.length === 0) {
            setIsLoading(true);
        }
        setError(null);
        try {
            const queryParams = new URLSearchParams();
            if (params?.type) queryParams.append('type', params.type);
            if (params?.status) queryParams.append('status', params.status);
            if (params?.start) queryParams.append('start', params.start);
            if (params?.end) queryParams.append('end', params.end);

            const url = '/api/activities' + (queryParams.toString() ? '?' + queryParams.toString() : '');

            const res = await fetch(url, { headers: auth.getAuthHeaders() });
            const data = await res.json();

            if (res.ok) {
                setActivities(data.activities || []);
                // Only cache the raw unfiltered list
                if (!params || Object.keys(params).filter(k => k !== 'force').length === 0) {
                    localStorage.setItem('activities_cache', JSON.stringify(data.activities || []));
                }
            } else {
                throw new Error(data.error || 'Failed to fetch activities');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [auth.isActivated, auth.getAuthHeaders, activities.length]);

    // Listen for background updates (e.g., when the AI chat finishes modifying the database)
    useEffect(() => {
        const handleChatComplete = () => {
            // Silently fetch to update cache in the background
            fetchActivities({ force: true });
        };
        window.addEventListener('chat_response_completed', handleChatComplete);
        return () => window.removeEventListener('chat_response_completed', handleChatComplete);
    }, [fetchActivities]);

    const createActivity = async (activityData: Partial<Activity>) => {
        try {
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: {
                    ...auth.getAuthHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(activityData),
            });
            const data = await res.json();
            if (res.ok) {
                setActivities(prev => {
                    const next = [data.activity, ...prev];
                    localStorage.setItem('activities_cache', JSON.stringify(next));
                    return next;
                });
                return data.activity;
            } else {
                throw new Error(data.error);
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const updateActivity = async (id: string, updateData: Partial<Activity>) => {
        try {
            const res = await fetch('/api/activities', {
                method: 'PUT',
                headers: {
                    ...auth.getAuthHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id, ...updateData }),
            });
            const data = await res.json();
            if (res.ok) {
                setActivities(prev => {
                    const next = prev.map(a => a.id === id ? data.activity : a);
                    localStorage.setItem('activities_cache', JSON.stringify(next));
                    return next;
                });
                return data.activity;
            } else {
                throw new Error(data.error);
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const deleteActivity = async (id: string) => {
        try {
            const res = await fetch(`/api/activities?id=${id}`, {
                method: 'DELETE',
                headers: auth.getAuthHeaders(),
            });
            if (res.ok) {
                setActivities(prev => {
                    const next = prev.filter(a => a.id !== id);
                    localStorage.setItem('activities_cache', JSON.stringify(next));
                    return next;
                });
            } else {
                const data = await res.json();
                throw new Error(data.error);
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    return {
        activities,
        isLoading,
        error,
        fetchActivities,
        createActivity,
        updateActivity,
        deleteActivity
    };
}
