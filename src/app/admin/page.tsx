'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, KeyRound, MonitorSmartphone, Ban, ShieldCheck, LogOut, Loader2, RefreshCw, Settings, Cpu, Plus, Trash2, Save, Download } from 'lucide-react';

type ChatModel = {
    id: string;
    label: string;
    group: string;
};

type ApiModel = {
    id: string;
    displayName: string;
    description: string;
    supportedActions: string[];
};

type Device = {
    id: string;
    device_fingerprint: string;
    is_active: boolean;
    last_active_at: string;
    created_at: string;
};

type Code = {
    id: string;
    code: string;
    max_uses: number;
    usage_count: number;
    is_active: boolean;
    created_at: string;
};

type User = {
    id: string;
    username: string;
    is_active: boolean;
    created_at: string;
    activation_codes: Code[];
    user_devices: Device[];
};

export default function AdminDashboard() {
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Form states
    const [newUsername, setNewUsername] = useState('');
    const [newMaxUses, setNewMaxUses] = useState(3);
    const [isCreating, setIsCreating] = useState(false);
    const [activeTab, setActiveTab] = useState<'users' | 'models'>('users');

    // Model config states
    const [chatModels, setChatModels] = useState<ChatModel[]>([]);
    const [defaultChatModel, setDefaultChatModel] = useState('');
    const [memorySummaryModel, setMemorySummaryModel] = useState('');
    const [memoryEmbeddingModel, setMemoryEmbeddingModel] = useState('');
    const [imageGenModel, setImageGenModel] = useState('');
    const [configLoading, setConfigLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [configDirty, setConfigDirty] = useState(false);
    const [apiModels, setApiModels] = useState<ApiModel[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [showApiModels, setShowApiModels] = useState(false);

    // New model form
    const [newModelId, setNewModelId] = useState('');
    const [newModelLabel, setNewModelLabel] = useState('');
    const [newModelGroup, setNewModelGroup] = useState('');

    useEffect(() => {
        fetchUsers();
        fetchConfig();
    }, []);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/users');
            if (res.status === 401) {
                router.push('/admin/login');
                return;
            }
            const data = await res.json();
            if (data.success) {
                setUsers(data.users);
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('Failed to fetch users');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await fetch('/api/admin/auth', { method: 'DELETE' });
        router.push('/admin/login');
    };

    const fetchConfig = async () => {
        try {
            setConfigLoading(true);
            const res = await fetch('/api/admin/config');
            if (res.status === 401) return;
            const data = await res.json();
            if (data.success && data.configs) {
                const c = data.configs;
                setChatModels(Array.isArray(c.chat_models) ? c.chat_models : []);
                setDefaultChatModel(c.default_chat_model || '');
                setMemorySummaryModel(c.memory_summary_model || '');
                setMemoryEmbeddingModel(c.memory_embedding_model || '');
                setImageGenModel(c.image_gen_model || '');
                setConfigDirty(false);
            }
        } catch { }
        finally { setConfigLoading(false); }
    };

    const fetchApiModels = async () => {
        setFetchingModels(true);
        try {
            const res = await fetch('/api/admin/models');
            const data = await res.json();
            if (data.success) {
                setApiModels(data.models || []);
                setShowApiModels(true);
            } else {
                alert('获取模型失败: ' + data.error);
            }
        } catch {
            alert('网络错误');
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSaveConfig = async () => {
        setConfigSaving(true);
        try {
            const updates = [
                { key: 'chat_models', value: chatModels },
                { key: 'default_chat_model', value: defaultChatModel },
                { key: 'memory_summary_model', value: memorySummaryModel },
                { key: 'memory_embedding_model', value: memoryEmbeddingModel },
                { key: 'image_gen_model', value: imageGenModel },
            ];
            for (const u of updates) {
                const res = await fetch('/api/admin/config', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(u),
                });
                if (!res.ok) throw new Error(`Failed to save ${u.key}`);
            }
            setConfigDirty(false);
            alert('配置已保存 ✓');
        } catch (err: any) {
            alert('保存失败: ' + err.message);
        } finally {
            setConfigSaving(false);
        }
    };

    const addChatModel = () => {
        if (!newModelId.trim()) return;
        setChatModels(prev => [...prev, {
            id: newModelId.trim(),
            label: newModelLabel.trim() || newModelId.trim(),
            group: newModelGroup.trim() || 'Custom',
        }]);
        setNewModelId('');
        setNewModelLabel('');
        setNewModelGroup('');
        setConfigDirty(true);
    };

    const removeChatModel = (idx: number) => {
        setChatModels(prev => prev.filter((_, i) => i !== idx));
        setConfigDirty(true);
    };

    const addFromApiModel = (apiModel: ApiModel) => {
        if (chatModels.some(m => m.id === apiModel.id)) return;
        setChatModels(prev => [...prev, {
            id: apiModel.id,
            label: apiModel.displayName || apiModel.id,
            group: 'API',
        }]);
        setConfigDirty(true);
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newUsername.trim()) return;
        setIsCreating(true);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: newUsername, maxUses: newMaxUses }),
            });
            const data = await res.json();
            if (data.success) {
                setNewUsername('');
                fetchUsers();
            } else {
                alert(data.error);
            }
        } catch (err) {
            alert('Error creating user');
        } finally {
            setIsCreating(false);
        }
    };

    const handleToggleUser = async (userId: string, currentStatus: boolean) => {
        const confirmMsg = currentStatus
            ? "Are you sure you want to DEACTIVATE this user's entire account? All their devices will instantly be blocked."
            : "Reactivate this user?";
        if (!confirm(confirmMsg)) return;

        try {
            const res = await fetch('/api/admin/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, is_active: !currentStatus }),
            });
            if (res.ok) fetchUsers();
        } catch (err) {
            console.error(err);
        }
    };

    const handleToggleCode = async (codeId: string, currentStatus: boolean) => {
        try {
            const res = await fetch('/api/admin/users/code', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code_id: codeId, is_active: !currentStatus }),
            });
            if (res.ok) fetchUsers();
        } catch (err) {
            console.error(err);
        }
    };

    const handleToggleDevice = async (deviceId: string, currentStatus: boolean) => {
        try {
            const res = await fetch('/api/admin/users/device', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: deviceId, is_active: !currentStatus }),
            });
            if (res.ok) fetchUsers();
        } catch (err) {
            console.error(err);
        }
    };

    const handleGenerateNewCode = async (userId: string) => {
        if (!confirm("Generate a new access code for this user?")) return;
        try {
            const res = await fetch('/api/admin/users/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, maxUses: 3 }),
            });
            if (res.ok) fetchUsers();
        } catch (err) {
            console.error(err);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="h-[100dvh] overflow-y-auto bg-gray-50 dark:bg-[#030712] text-gray-900 dark:text-gray-100 p-4 md:p-8 font-sans">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-xl">
                            <ShieldCheck className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">Admin Central</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Manage users, models, and configurations</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={fetchUsers} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            <RefreshCw className="w-5 h-5" />
                        </button>
                        <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors">
                            <LogOut className="w-4 h-4" /> Logout
                        </button>
                    </div>
                </header>

                {error && (
                    <div className="p-4 bg-red-100 text-red-700 rounded-lg border border-red-200">
                        {error}
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-2xl overflow-hidden">
                    <button
                        onClick={() => setActiveTab('users')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'users'
                            ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/10 dark:text-blue-400'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                    >
                        <Users className="w-4 h-4" /> 用户管理
                    </button>
                    <button
                        onClick={() => setActiveTab('models')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'models'
                            ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50/50 dark:bg-purple-900/10 dark:text-purple-400'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                    >
                        <Cpu className="w-4 h-4" /> 模型管理
                    </button>
                </div>

                {activeTab === 'users' && (<>
                    {/* Create User Card */}
                    <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700">
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
                            <Users className="w-5 h-5 text-blue-500" /> Create New User
                        </h2>
                        <form onSubmit={handleCreateUser} className="flex flex-col sm:flex-row items-end gap-4">
                            <div className="flex-1 w-full space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Username / Identifier</label>
                                <input
                                    type="text"
                                    required
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="e.g. John Doe, IT Dept..."
                                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                            </div>
                            <div className="w-full sm:w-32 space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Max Devices</label>
                                <input
                                    type="number"
                                    min="1" max="10"
                                    value={newMaxUses}
                                    onChange={(e) => setNewMaxUses(parseInt(e.target.value) || 1)}
                                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isCreating}
                                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
                            >
                                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                                Generate Code
                            </button>
                        </form>
                    </section>
                </>)}

                {activeTab === 'models' && (
                    <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Cpu className="w-5 h-5 text-purple-500" /> Model Configuration
                            </h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={fetchApiModels}
                                    disabled={fetchingModels}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40 rounded-lg transition-colors border border-purple-200 dark:border-purple-800 disabled:opacity-50"
                                >
                                    {fetchingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                    获取所有可用模型
                                </button>
                                {configDirty && (
                                    <button
                                        onClick={handleSaveConfig}
                                        disabled={configSaving}
                                        className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                        保存配置
                                    </button>
                                )}
                            </div>
                        </div>

                        {configLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                            </div>
                        ) : (
                            <>
                                {/* API Models Panel */}
                                {showApiModels && apiModels.length > 0 && (
                                    <div className="border border-purple-200 dark:border-purple-800 rounded-xl p-4 bg-purple-50/30 dark:bg-purple-900/10">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                                                Gemini API 可用模型 ({apiModels.length})
                                            </h3>
                                            <button onClick={() => setShowApiModels(false)} className="text-xs text-gray-500 hover:text-gray-700">收起</button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                                            {apiModels.map(m => {
                                                const alreadyAdded = chatModels.some(cm => cm.id === m.id);
                                                return (
                                                    <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
                                                        <div className="truncate flex-1 mr-2">
                                                            <div className="font-medium truncate" title={m.id}>{m.id}</div>
                                                            <div className="text-gray-500 truncate">{m.displayName}</div>
                                                        </div>
                                                        <button
                                                            onClick={() => addFromApiModel(m)}
                                                            disabled={alreadyAdded}
                                                            className={`flex-none text-xs px-2 py-1 rounded-md font-medium transition-colors ${alreadyAdded
                                                                ? 'text-gray-400 bg-gray-100 dark:bg-gray-700 cursor-not-allowed'
                                                                : 'text-green-700 bg-green-100 hover:bg-green-200 dark:text-green-400 dark:bg-green-900/30'
                                                                }`}
                                                        >
                                                            {alreadyAdded ? '已添加' : '+ 添加'}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Chat Model List */}
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Settings className="w-4 h-4" /> 聊天可用模型
                                    </h3>
                                    <div className="space-y-2 mb-3">
                                        {chatModels.map((m, idx) => (
                                            <div key={idx} className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">{m.group}</span>
                                                <span className="font-mono text-sm flex-1">{m.id}</span>
                                                <span className="text-xs text-gray-500">{m.label}</span>
                                                <button onClick={() => removeChatModel(idx)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Add model form */}
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input value={newModelId} onChange={e => { setNewModelId(e.target.value); }} placeholder="模型 ID" className="flex-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500" />
                                        <input value={newModelLabel} onChange={e => setNewModelLabel(e.target.value)} placeholder="显示名称" className="w-full sm:w-28 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500" />
                                        <input value={newModelGroup} onChange={e => setNewModelGroup(e.target.value)} placeholder="分组" className="w-full sm:w-28 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500" />
                                        <button onClick={addChatModel} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 rounded-lg transition-colors border border-purple-200 dark:border-purple-800">
                                            <Plus className="w-3.5 h-3.5" /> 添加
                                        </button>
                                    </div>
                                </div>

                                {/* Default model selects */}
                                {(() => {
                                    // Build unified model options for selects
                                    const allModelOptions = apiModels.length > 0
                                        ? apiModels.map(m => ({ id: m.id, label: m.displayName || m.id }))
                                        : chatModels.map(m => ({ id: m.id, label: m.label }));
                                    return (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">默认聊天模型</label>
                                                <select value={defaultChatModel} onChange={e => { setDefaultChatModel(e.target.value); setConfigDirty(true); }} className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500">
                                                    {chatModels.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">记忆摘要模型</label>
                                                <select value={memorySummaryModel} onChange={e => { setMemorySummaryModel(e.target.value); setConfigDirty(true); }} className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500">
                                                    {!allModelOptions.some(m => m.id === memorySummaryModel) && <option value={memorySummaryModel}>{memorySummaryModel}</option>}
                                                    {allModelOptions.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">向量嵌入模型</label>
                                                <select value={memoryEmbeddingModel} onChange={e => { setMemoryEmbeddingModel(e.target.value); setConfigDirty(true); }} className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500">
                                                    {!allModelOptions.some(m => m.id === memoryEmbeddingModel) && <option value={memoryEmbeddingModel}>{memoryEmbeddingModel}</option>}
                                                    {allModelOptions.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">图片生成模型</label>
                                                <select value={imageGenModel} onChange={e => { setImageGenModel(e.target.value); setConfigDirty(true); }} className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500">
                                                    {!allModelOptions.some(m => m.id === imageGenModel) && <option value={imageGenModel}>{imageGenModel}</option>}
                                                    {allModelOptions.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </>
                        )}
                    </section>
                )}

                {activeTab === 'users' && (<>
                    {/* User List */}
                    <section className="space-y-6">
                        <h2 className="text-xl font-bold px-2">Registered Users ({users.length})</h2>

                        <div className="grid grid-cols-1 gap-6">
                            {users.map((user) => (
                                <div key={user.id} className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border ${user.is_active ? 'border-gray-200 dark:border-gray-700' : 'border-red-300 dark:border-red-900'} overflow-hidden`}>
                                    {/* User Header */}
                                    <div className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/20">
                                        <div>
                                            <h3 className="text-xl font-bold flex items-center gap-3">
                                                {user.username}
                                                {!user.is_active && <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full flex items-center gap-1"><Ban className="w-3 h-3" /> Blacklisted</span>}
                                            </h3>
                                            <p className="text-sm text-gray-500 mt-1 font-mono text-xs">ID: {user.id}</p>
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-auto">
                                            <button
                                                onClick={() => handleGenerateNewCode(user.id)}
                                                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
                                            >
                                                + New Access Code
                                            </button>
                                            <button
                                                onClick={() => handleToggleUser(user.id, user.is_active)}
                                                className={`flex-none p-2 rounded-lg border transition-colors ${user.is_active
                                                    ? 'text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 dark:border-red-900/50'
                                                    : 'text-green-600 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-900/50 dark:hover:bg-green-900/20'
                                                    }`}
                                                title={user.is_active ? "Blacklist User" : "Reactivate User"}
                                            >
                                                <Ban className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                                        {/* Activation Codes */}
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                                <KeyRound className="w-4 h-4" /> Issued Codes
                                            </h4>
                                            {user.activation_codes?.length === 0 ? (
                                                <p className="text-sm text-gray-400 italic">No access codes generated yet.</p>
                                            ) : (
                                                <div className="space-y-3">
                                                    {user.activation_codes?.map(code => (
                                                        <div key={code.id} className={`flex items-center justify-between p-3 rounded-lg border ${code.is_active ? 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700' : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 opacity-60'}`}>
                                                            <div>
                                                                <div className="font-mono text-lg font-bold tracking-widest text-blue-600 dark:text-blue-400">
                                                                    {code.code}
                                                                </div>
                                                                <div className="text-xs text-gray-500 mt-1">
                                                                    Used {code.usage_count}/{code.max_uses} times
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleToggleCode(code.id, code.is_active)}
                                                                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${code.is_active
                                                                    ? 'text-orange-700 bg-orange-100 hover:bg-orange-200 dark:text-orange-400 dark:bg-orange-900/30 dark:hover:bg-orange-900/50'
                                                                    : 'text-gray-600 bg-gray-200 hover:bg-gray-300 dark:text-gray-400 dark:bg-gray-700'
                                                                    }`}
                                                            >
                                                                {code.is_active ? 'Revoke Code' : 'Revoked'}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Bound Devices */}
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                                <MonitorSmartphone className="w-4 h-4" /> Active Devices
                                            </h4>
                                            {user.user_devices?.length === 0 ? (
                                                <p className="text-sm text-gray-400 italic">No devices have been explicitly activated yet.</p>
                                            ) : (
                                                <div className="space-y-3">
                                                    {user.user_devices?.map(device => (
                                                        <div key={device.id} className={`flex items-center justify-between p-3 rounded-lg border ${device.is_active ? 'bg-green-50/30 dark:bg-green-900/10 border-green-100 dark:border-green-900/30' : 'bg-red-50/30 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'}`}>
                                                            <div className="truncate pr-4 flex-1">
                                                                <div className="font-mono text-xs font-medium text-gray-700 dark:text-gray-300 truncate" title={device.device_fingerprint}>
                                                                    {device.device_fingerprint.substring(0, 24)}...
                                                                </div>
                                                                <div className="text-[11px] text-gray-500 mt-1">
                                                                    Last seen: {new Date(device.last_active_at).toLocaleDateString()}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleToggleDevice(device.id, device.is_active)}
                                                                className={`text-xs px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${device.is_active
                                                                    ? 'text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50'
                                                                    : 'text-gray-600 bg-gray-200 hover:bg-gray-300 dark:text-gray-400 dark:bg-gray-700'
                                                                    }`}
                                                            >
                                                                {device.is_active ? 'Kick Device' : 'Kicked'}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                    </div>
                                </div>
                            ))}
                        </div>

                        {users.length === 0 && (
                            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 border-dashed">
                                <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">No users found</h3>
                                <p className="text-gray-500 mt-1">Create your first user using the form above.</p>
                            </div>
                        )}

                    </section>
                </>)}
            </div>
        </div>
    );
}
