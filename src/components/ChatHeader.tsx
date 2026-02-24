interface ChatHeaderProps {
    title: string;
    isLoading: boolean;
    onOpenDrawer: () => void;
}

export default function ChatHeader({ title, isLoading, onOpenDrawer }: ChatHeaderProps) {
    return (
        <header className="flex-none px-4 py-3 border-b flex items-center justify-between bg-card text-card-foreground z-10">
            {/* Left: hamburger */}
            <button
                onClick={onOpenDrawer}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
            </button>
            {/* Center: conversation title */}
            <h1 className="text-base font-semibold tracking-tight truncate mx-3 flex-1 text-center">
                {title === "新会话" ? "Gemini" : title || "Gemini"}
            </h1>
            {/* Right: status dot */}
            <div className="p-1.5 flex-shrink-0">
                <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLoading ? 'bg-amber-400' : 'bg-green-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isLoading ? 'bg-amber-500' : 'bg-green-500'}`}></span>
                </span>
            </div>
        </header>
    );
}
