import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";
import type { ToolLog } from "@/types/chat";

type OrchestrationRunCardProps = {
  run: {
    id: string;
    prompt: string;
    serverLabel: string;
    status: "running" | "completed" | "error";
    response: string;
    startedAt: Date;
    finishedAt?: Date;
    toolLogs?: ToolLog[];
  };
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDuration = (start: Date, end?: Date) => {
  const duration = ((end || new Date()).getTime() - start.getTime()) / 1000;
  if (duration < 1) return "< 1초";
  if (duration < 60) return `${Math.round(duration)}초`;
  return `${Math.round(duration / 60)}분`;
};

export default function OrchestrationRunCard({ run }: OrchestrationRunCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCopied, setIsCopied] = useState(false);

  const statusConfig = {
    completed: {
      border: "border-emerald-500/40",
      bg: "bg-emerald-500/5",
      badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
      dot: "bg-emerald-500",
      label: "완료",
    },
    error: {
      border: "border-rose-500/40",
      bg: "bg-rose-500/5",
      badge: "border-rose-500/40 bg-rose-500/10 text-rose-200",
      dot: "bg-rose-500",
      label: "오류",
    },
    running: {
      border: "border-cyan-500/40",
      bg: "bg-cyan-500/5",
      badge: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
      dot: "bg-cyan-500 animate-pulse",
      label: "실행 중",
    },
  };

  const config = statusConfig[run.status];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(run.response);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Markdown rendering with MarkdownRenderer
  const renderResponse = (text: string) => {
    if (!text) return "응답이 없습니다.";

    return (
      <div className="text-slate-200">
        <MarkdownRenderer content={text} className="prose-invert" />
      </div>
    );
  };

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-200",
        "hover:shadow-lg hover:shadow-slate-800/30",
        config.border,
        config.bg
      )}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between gap-4 px-5 py-4 cursor-pointer hover:bg-slate-800/10"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className={cn("h-2 w-2 rounded-full", config.dot)} />
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{run.serverLabel}</p>
          </div>
          <p className="text-sm font-medium text-slate-100 truncate">{run.prompt}</p>
          <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
            <span>{formatTime(run.startedAt)}</span>
            {run.finishedAt && <span>•</span>}
            {run.finishedAt && <span>{formatDuration(run.startedAt, run.finishedAt)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium whitespace-nowrap", config.badge)}>
            {config.label}
          </span>
          {run.toolLogs && run.toolLogs.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-100">
              {run.toolLogs.length} tool{run.toolLogs.length > 1 ? "s" : ""}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-500" />
          ) : (
            <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-500" />
          )}
        </div>
      </div>

      {/* Expanded Response */}
      {isExpanded && (
        <>
          <div className="border-t border-slate-800/50" />
          <div className="px-5 py-4">
            {/* Response Container */}
            <div className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-4 mb-3">
              {run.status === "running" && (
                <div className="flex items-center gap-2 text-slate-400 mb-2">
                  <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-sm">실행 중입니다...</span>
                </div>
              )}
              {(run.response || run.status !== "running") && renderResponse(run.response)}
            </div>

            {/* Copy Button */}
            {run.response && run.status !== "running" && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                {isCopied ? (
                  <>
                    <Check className="h-4 w-4" />
                    복사됨
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    복사
                  </>
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
