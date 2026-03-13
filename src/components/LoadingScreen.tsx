"use client";

import { useEffect, useState } from "react";

interface LoadingScreenProps {
  /** 显示模式：full - 全屏加载，skeleton - 骨架屏模式 */
  mode?: "full" | "skeleton";
  /** 全屏模式下的提示文字 */
  text?: string;
  /** 是否显示进度条动画 */
  showProgress?: boolean;
}

/**
 * 页面加载过渡组件
 * 提供全屏加载动画和骨架屏两种模式
 */
export default function LoadingScreen({
  mode = "full",
  text = "加载中",
  showProgress = true,
}: LoadingScreenProps) {
  const [dots, setDots] = useState("");
  const [progress, setProgress] = useState(0);

  // 动态省略号动画
  useEffect(() => {
    if (mode !== "full") return;
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 400);
    return () => clearInterval(interval);
  }, [mode]);

  // 进度条动画
  useEffect(() => {
    if (!showProgress || mode !== "full") return;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev; // 停在90%，实际加载完成后会消失
        return prev + Math.random() * 15;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [showProgress, mode]);

  if (mode === "skeleton") {
    return (
      <div className="h-[100dvh] w-full bg-background flex flex-col">
        {/* Header skeleton */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
            <div className="w-24 h-5 rounded bg-muted animate-pulse" />
          </div>
          <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
        </div>

        {/* Content skeleton - 消息列表骨架 */}
        <div className="flex-1 overflow-hidden p-4 space-y-4">
          {/* AI 消息骨架 */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          </div>

          {/* 用户消息骨架 */}
          <div className="flex gap-3 justify-end">
            <div className="max-w-[75%] space-y-2">
              <div className="h-4 w-32 rounded bg-muted animate-pulse ml-auto" />
            </div>
          </div>

          {/* 更多 AI 消息骨架 */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
              <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
            </div>
          </div>
        </div>

        {/* Input skeleton */}
        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 h-10 rounded-full bg-muted animate-pulse" />
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // 全屏加载模式
  return (
    <div className="h-[100dvh] w-full bg-background flex items-center justify-center">
      <div className="flex flex-col items-center space-y-6">
        {/* Logo 动画 */}
        <div className="relative">
          {/* 外圈旋转 */}
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary animate-pulse"
            >
              <path d="M12 2v20" />
              <path d="m3 12 18 0" />
              <path d="m19 5-14 14" />
              <path d="m5 5 14 14" />
            </svg>
          </div>
          
          {/* 旋转环 */}
          <div className="absolute inset-0 rounded-2xl border-2 border-primary/20 border-t-primary/60 animate-spin" 
               style={{ animationDuration: "1.5s" }} />
        </div>

        {/* 加载文字 */}
        <div className="text-center space-y-2">
          <p className="text-muted-foreground text-sm font-medium">
            {text}{dots}
          </p>
        </div>

        {/* 进度条 */}
        {showProgress && (
          <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/60 rounded-full transition-all duration-200 ease-out"
              style={{ width: `${Math.min(progress, 90)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 内联骨架组件 - 用于局部加载状态
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-muted animate-pulse rounded ${className}`}
    />
  );
}

/**
 * 消息骨架组件 - 用于消息列表加载
 */
export function MessageSkeleton() {
  return (
    <div className="flex gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
      </div>
    </div>
  );
}