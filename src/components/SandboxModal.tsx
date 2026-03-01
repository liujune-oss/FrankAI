import { useState, useRef, useEffect } from "react";
import { X, Beaker, Play, Mic, CalendarDays, BrainCircuit, Square, Loader2, Copy, Check, RotateCcw } from "lucide-react";

interface SandboxModalProps {
    open: boolean;
    onClose: () => void;
}

type TabType = "voice" | "calendar" | "memory";

export default function SandboxModal({ open, onClose }: SandboxModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>("voice");

    // Test states
    const defaultPrompt = `你是一个智能语音分析助手。请理解这段语音的内容，去掉语气词，总结意图并将其提取为一个符合数据库定义的活动记录 (Activity)。

【数据库 Schema 定义参考】
\`\`\`sql
CREATE TABLE activities (
    title TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK (type IN ('task', 'event', 'reminder')) NOT NULL,
    status TEXT CHECK (status IN ('needs_action', 'in_process', 'completed', 'cancelled')) DEFAULT 'needs_action',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    -- A task has a due date (end_time), no start_time.
    -- An event has both start_time and end_time.
    -- A reminder might only have a start_time (when to alert).
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    is_all_day BOOLEAN DEFAULT FALSE,
    location TEXT
);
\`\`\`

【非常重要：枚举值严格约束】
- type 字段【必须且只能】是从 schema 的约束中挑选："task", "event", "reminder"。绝对不能输出其他词语！(例如绝对不能输出 "meeting" 或 "开会")
- priority 字段【必须且只能】是从 schema 的约束中挑选："low", "medium", "high", "urgent"。

【极其重要：禁止自行发明字段】
这不仅是一次内容理解，这是一次**严格的数据结构转换**。
请**绝对不要**返回诸如 "absolute_time", "original_text", 或以 "event" 作为 key 的任何你自己发明的字段。
你的整个返回数据，**必须且只能包含以下 8 个 key**：

请严格按以下 JSON 格式输出，只能是个 JSON 对象，不要输出任何多余内容或 markdown 标记：
{
  "title": "活动标题",
  "description": "详细描述（可为空字符串）",
  "type": "task" | "event" | "reminder",
  "priority": "low" | "medium" | "high" | "urgent",
  "start_time": "ISO 8601 格式或 null (重要：必须是这个 key 名字，绝不能用 absolute_time)",
  "end_time": "ISO 8601 格式或 null",
  "is_all_day": boolean,
  "location": "地点或 null"
}`;
    const [testPrompt, setTestPrompt] = useState(defaultPrompt);
    const [result, setResult] = useState("等待输入...");
    const [copied, setCopied] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    // Audio states
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBase64, setAudioBase64] = useState<string>("");
    const [audioMime, setAudioMime] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        const savedPrompt = localStorage.getItem("sandbox_voice_prompt");
        if (savedPrompt) {
            setTestPrompt(savedPrompt);
        }
    }, []);

    const handlePromptChange = (newPrompt: string) => {
        setTestPrompt(newPrompt);
        localStorage.setItem("sandbox_voice_prompt", newPrompt);
    };

    const resetPrompt = () => {
        setTestPrompt(defaultPrompt);
        localStorage.removeItem("sandbox_voice_prompt");
    };

    if (!open) return null;

    const startRecording = async () => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                setResult("无法访问麦克风 API: 浏览器环境不安全。请确保在 localhost (127.0.0.1) 下访问本应用，或部署并使用 HTTPS 访问。");
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
                setAudioMime(mediaRecorder.mimeType);

                // Convert to base64
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const base64String = (reader.result as string).split(',')[1];
                    setAudioBase64(base64String);
                };

                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
            setAudioUrl(null);
            setAudioBase64("");
            setResult("正在录音中...");
        } catch (err: any) {
            console.error("Mic access denied:", err);
            setResult("无法访问麦克风权限: " + err.message);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setResult("已结束录音，等待发送...");
        }
    };

    const handleVoiceTest = async () => {
        if (!audioBase64) {
            setResult("请先录制一段语音！");
            return;
        }
        setIsLoading(true);
        setResult("正在向原生 Gemini 3.0 Flash 发送音频流进行解码与提炼...");
        try {
            const res = await fetch('/api/admin/voice-test', {
                method: 'POST',
                body: JSON.stringify({ audioBase64, mimeType: audioMime, prompt: testPrompt }),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (res.ok) {
                try {
                    // Gemini might wrap the json response in markdown ```json ... ``` tags
                    let rawResult = data.result.trim();
                    if (rawResult.startsWith('```json')) {
                        rawResult = rawResult.replace(/^```json\n/, '').replace(/\n```$/, '');
                    } else if (rawResult.startsWith('```')) {
                        rawResult = rawResult.replace(/^```\n/, '').replace(/\n```$/, '');
                    }

                    // Try to pretty print JSON if applicable
                    const parsed = JSON.parse(rawResult);
                    setResult(JSON.stringify(parsed, null, 2));
                } catch {
                    // Not JSON or plain text
                    setResult(data.result);
                }
            } else {
                setResult("模型解析报错: " + data.error);
            }
        } catch (e: any) {
            setResult("请求失败: " + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        if (!result || result === "等待输入...") return;
        navigator.clipboard.writeText(result);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const tabs = [
        { id: "voice" as TabType, label: "语音大模型测试", icon: Mic },
        { id: "calendar" as TabType, label: "日程管理测试", icon: CalendarDays },
        { id: "memory" as TabType, label: "记忆修剪测试", icon: BrainCircuit },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-4xl h-[600px] rounded-2xl shadow-xl flex flex-col border border-border overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
                    <div className="flex items-center gap-2 text-primary">
                        <Beaker size={20} className="text-purple-500" />
                        <h2 className="text-lg font-semibold bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">
                            AI 技能靶场 (Admin Sandbox)
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                {/* Body: Responsive Two-columns layout */}
                <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-muted/10">
                    {/* Sidebar / Top Navigation Tabs */}
                    <div className="w-full md:w-56 border-b md:border-b-0 md:border-r flex flex-row md:flex-col p-3 gap-2 overflow-x-auto md:overflow-y-auto shrink-0 hidden-scrollbar">
                        <div className="hidden md:block px-2 py-2 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            可用技能节点
                        </div>
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-auto md:w-full flex-shrink-0 flex items-center gap-2 md:gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive
                                        ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        }`}
                                >
                                    <Icon size={16} className="shrink-0" />
                                    <span className="whitespace-nowrap">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                        {activeTab === "voice" && (
                            <div className="flex flex-col h-full space-y-6">
                                <div>
                                    <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                                        <Mic size={18} className="text-purple-500" />
                                        原生音频大模型接入点 (Gemini 3.0 Flash)
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        直接调用浏览器原生麦克风，录制二进制音频流直接喂给大模型引擎测试转化效果。
                                    </p>
                                </div>

                                <div className="space-y-2 flex-shrink-0 relative group">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            提词器 (Prompt for the Audio Context)
                                        </label>
                                        <button
                                            onClick={resetPrompt}
                                            className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                            title="恢复默认提示词"
                                        >
                                            <RotateCcw size={12} />
                                            重置
                                        </button>
                                    </div>
                                    {isMounted ? (
                                        <textarea
                                            value={testPrompt}
                                            onChange={(e) => handlePromptChange(e.target.value)}
                                            className="w-full h-56 px-4 py-3 bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none text-sm font-mono leading-relaxed"
                                        />
                                    ) : (
                                        <div className="w-full h-56 px-4 py-3 bg-muted/50 border rounded-xl animate-pulse" />
                                    )}
                                </div>

                                <div className="flex items-center justify-between shrink-0 bg-muted/30 p-4 rounded-xl border border-border/50">
                                    <div className="flex items-center gap-3">
                                        {!isRecording ? (
                                            <button
                                                onClick={startRecording}
                                                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-xl text-sm font-medium transition-all"
                                            >
                                                <Mic size={16} /> 开始录音 (Mic)
                                            </button>
                                        ) : (
                                            <button
                                                onClick={stopRecording}
                                                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 animate-pulse transition-all"
                                            >
                                                <Square size={16} className="fill-current" /> 停止录音...
                                            </button>
                                        )}
                                        {audioUrl && (
                                            <audio src={audioUrl} controls className="h-9 w-48" />
                                        )}
                                    </div>
                                    <button
                                        onClick={handleVoiceTest}
                                        disabled={!audioBase64 || isLoading}
                                        className="flex items-center gap-2 px-4 py-2 bg-foreground text-background disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium hover:bg-foreground/90 transition-all active:scale-95"
                                    >
                                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                                        提交给 Gemini 解码
                                    </button>
                                </div>

                                <div className="space-y-2 pt-4 border-t flex-1 flex flex-col min-h-0 relative group">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex justify-between">
                                        <span>大模型返回结果 (净化提取后)</span>
                                        {audioMime && <span>{audioMime}</span>}
                                    </label>
                                    <div className="flex-1 w-full bg-black rounded-xl p-4 font-mono text-sm leading-relaxed text-green-400 overflow-y-auto whitespace-pre-wrap relative">
                                        <button
                                            onClick={handleCopy}
                                            className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors opacity-0 group-hover:opacity-100"
                                            title="复制结果"
                                        >
                                            {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                                        </button>
                                        {result}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab !== "voice" && (
                            <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
                                <Beaker size={48} className="opacity-20 mb-4" />
                                <p>该技能模块正在施工中...</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
