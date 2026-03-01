"use client";

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

export interface Activity {
    id: string;
    title: string;
    description?: string;
    type: 'task' | 'event' | 'reminder';
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
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchActivities = useCallback(async (params?: { type?: string; status?: string; start?: string; end?: string }) => {
        if (!auth.isActivated) return;
        setIsLoading(true);
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
            } else {
                throw new Error(data.error || 'Failed to fetch activities');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [auth]);

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
                setActivities(prev => [data.activity, ...prev]);
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
                setActivities(prev => prev.map(a => a.id === id ? data.activity : a));
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
                setActivities(prev => prev.filter(a => a.id !== id));
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
