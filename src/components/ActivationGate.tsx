import versionData from "../../version.json";

interface ActivationGateProps {
    activationCode: string;
    setActivationCode: (code: string) => void;
    handleActivate: () => void;
    activating: boolean;
    activationError: string;
}

export default function ActivationGate({
    activationCode,
    setActivationCode,
    handleActivate,
    activating,
    activationError,
}: ActivationGateProps) {
    return (
        <div className="h-[100dvh] w-full bg-background flex items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-6 text-center">
                {/* Logo */}
                <div className="flex flex-col items-center space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2v20" /><path d="m3 12 18 0" /><path d="m19 5-14 14" /><path d="m5 5 14 14" /></svg>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Gemini</h1>
                    <p className="text-sm text-muted-foreground">请输入激活码以开始使用</p>
                </div>

                {/* Input */}
                <div className="space-y-3">
                    <input
                        type="text"
                        maxLength={4}
                        className="w-full bg-muted/50 border border-input rounded-xl px-4 py-4 outline-none text-center text-3xl tracking-[1em] indent-[1em] font-mono focus:border-primary/50 transition-colors uppercase"
                        value={activationCode}
                        onChange={(e) => setActivationCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                        placeholder="ABCD"
                        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                        autoFocus
                    />
                    <button
                        onClick={handleActivate}
                        disabled={activating || activationCode.trim().length !== 4}
                        className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {activating ? '正在验证并绑定设备...' : '激活设备'}
                    </button>
                </div>

                {/* Error */}
                {activationError && (
                    <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{activationError}</p>
                )}

                {/* Version */}
                <p className="text-[10px] text-muted-foreground/40">
                    v{versionData.major}.{versionData.minor}.{versionData.build}
                </p>
            </div>
        </div>
    );
}
