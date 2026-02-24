"use client";

import { useEffect, useState, useCallback } from "react";

export function useAuth() {
    const [isActivated, setIsActivated] = useState(false);
    const [activationCode, setActivationCode] = useState("");
    const [activationError, setActivationError] = useState("");
    const [activating, setActivating] = useState(false);
    const [checkingAuth, setCheckingAuth] = useState(true);

    // System instruction
    const DEFAULT_SYSTEM_INSTRUCTION = "你是一个真诚、有深度的AI助手。请遵循以下原则：\n1. 拒绝顺从陷阱：不要为了讨好用户而无条件赞同。如果用户的观点有问题，礼貌但直接地指出。\n2. 多角度分析：对任何问题提供多个视角的观点，包括正面、反面和潜在的灰色地带。\n3. 诚实表达不确定性：当你不确定某件事时，明确说明而不是编造答案。\n4. 鼓励批判性思维：引导用户自行思考，而不是盲目接受你的回答。\n5. 用中文回复，除非用户使用其他语言提问。";
    const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);

    // Device fingerprint
    const getFingerprint = useCallback(() => {
        if (typeof window === 'undefined') return '';
        const nav = window.navigator;
        const screen = window.screen;
        const raw = [
            nav.userAgent,
            nav.language,
            screen.width + 'x' + screen.height,
            screen.colorDepth,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            nav.hardwareConcurrency || 0,
        ].join('|');
        // Simple hash
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            const chr = raw.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash.toString(36);
    }, []);

    // Auth headers helper
    const getAuthHeaders = useCallback(() => {
        const token = localStorage.getItem('activation-token') || '';
        const fp = localStorage.getItem('device-fingerprint') || getFingerprint();
        return {
            'x-activation-token': token,
            'x-device-fingerprint': fp,
        };
    }, [getFingerprint]);

    // Check activation on mount
    useEffect(() => {
        const token = localStorage.getItem('activation-token');
        if (token) {
            setIsActivated(true);
        }
        // Load saved system instruction
        const savedInstruction = localStorage.getItem('system-instruction');
        if (savedInstruction !== null) {
            setSystemInstruction(savedInstruction);
        }
        setCheckingAuth(false);
    }, []);

    // Handle activation
    const handleActivate = useCallback(async () => {
        if (!activationCode.trim() || activating) return;
        setActivating(true);
        setActivationError("");
        try {
            const fp = getFingerprint();
            const res = await fetch('/api/activate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: activationCode.trim(), fingerprint: fp }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '激活失败');
            localStorage.setItem('activation-token', data.token);
            localStorage.setItem('device-fingerprint', fp);
            setIsActivated(true);
        } catch (err: any) {
            setActivationError(err.message || '激活失败');
        } finally {
            setActivating(false);
        }
    }, [activationCode, activating, getFingerprint]);

    const handleUnauthorized = useCallback(() => {
        localStorage.removeItem('activation-token');
        localStorage.removeItem('device-fingerprint');
        setIsActivated(false);
    }, []);

    return {
        isActivated,
        checkingAuth,
        activationCode,
        setActivationCode,
        activationError,
        activating,
        handleActivate,
        handleUnauthorized,
        getAuthHeaders,
        systemInstruction,
        setSystemInstruction,
        DEFAULT_SYSTEM_INSTRUCTION,
    };
}
