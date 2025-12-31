import { useState } from "react";
import { User, Bot, Zap, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";
import type { UsageTotals } from "@/types/chat";
import type { ToolLog } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type OrchestrationChatMessageProps = {
  message: {
    id: string;
    type: "user" | "assistant";
    content: string;
    timestamp: Date;
    usage?: UsageTotals;
    cost?: number;
    toolLogs?: ToolLog[];
  };
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Markdown rendering with MarkdownRenderer
const renderMarkdown = (text: string) => {
  return (
    <MarkdownRenderer content={text} className="prose-invert" />
  );
};

export default function OrchestrationChatMessage({
  message,
}: OrchestrationChatMessageProps) {
  const [activeLog, setActiveLog] = useState<ToolLog | null>(null);
  const isUser = message.type === "user";
  const hasUsage = !isUser && (message.usage || message.cost !== undefined);
  const toolLogs = !isUser ? message.toolLogs ?? [] : [];
  const hasToolLogs = toolLogs.length > 0;

  const statusBadge = (log: ToolLog) => {
    const status = log.status ?? "completed";
    if (status === "error") {
      return "오류";
    }
    if (status === "started") {
      return "진행 중";
    }
    return "완료";
  };

  return (
    <div
      className={cn("flex gap-3 animate-in fade-in slide-in-from-bottom-2", {
        "flex-row-reverse": isUser,
      })}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border",
          isUser
            ? "border-blue-500/40 bg-blue-500/10"
            : "border-cyan-500/40 bg-cyan-500/10"
        )}
      >
        {isUser ? (
          <User className={cn("h-4 w-4", isUser ? "text-blue-400" : "text-cyan-400")} />
        ) : (
          <Bot className={cn("h-4 w-4", isUser ? "text-blue-400" : "text-cyan-400")} />
        )}
      </div>

      {/* Message Content */}
      <div
        className={cn("flex max-w-2xl flex-col gap-1", {
          "items-end": isUser,
        })}
      >
        <div className="text-xs text-slate-500">{formatTime(message.timestamp)}</div>
        <div
          className={cn(
            "rounded-lg border px-4 py-2.5",
            isUser
              ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
              : "border-cyan-500/40 bg-cyan-500/10 text-slate-200"
          )}
        >
          {renderMarkdown(message.content)}
        </div>
        {hasUsage && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-cyan-500/20 pt-3 text-[10px] font-medium tracking-wider text-cyan-200/80">
            {message.usage && (
              <div className="flex items-center gap-1.5">
                <Zap className="h-3 w-3" />
                <span>{message.usage.total_tokens?.toLocaleString()} TOKENS</span>
              </div>
            )}
            {message.cost !== undefined && (
              <div className="flex items-center gap-1.5">
                <Coins className="h-3 w-3" />
                <span>${message.cost.toFixed(6)}</span>
              </div>
            )}
          </div>
        )}
        {hasToolLogs && (
          <div className="mt-3 flex w-full flex-wrap gap-2">
            {toolLogs.map((log) => {
              const label = log.name || log.rawToolName || "Tool";
              const serverLabel = log.serverName ? log.serverName.replace(/-MCP-Server$/i, "") : null;
              return (
                <Button
                  key={`${message.id}-${log.id}`}
                  variant="outline"
                  size="sm"
                  className="h-auto rounded-xl border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-left text-xs text-cyan-100 hover:bg-cyan-500/20"
                  onClick={() => setActiveLog(log)}
                >
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold">{label}</span>
                    <span className="text-[10px] text-cyan-200/80">
                      {statusBadge(log)}
                      {serverLabel ? ` · ${serverLabel}` : ""}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={Boolean(activeLog)} onOpenChange={(open) => !open && setActiveLog(null)}>
        <DialogContent className="max-w-2xl border border-slate-800/80 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">도구 실행 세부 정보</DialogTitle>
            <DialogDescription className="text-slate-400">
              MCP 도구 호출의 입력과 출력, 상태를 확인하세요.
            </DialogDescription>
          </DialogHeader>
          {activeLog ? (
            <div className="space-y-4 text-sm text-slate-200">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Tool</p>
                <p className="mt-1 text-lg font-semibold text-slate-50">
                  {activeLog.name || activeLog.rawToolName || "Tool"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                  {activeLog.status && <span>Status: {statusBadge(activeLog)}</span>}
                  {activeLog.serverName && <span>Server: {activeLog.serverName}</span>}
                  {activeLog.startedAt && <span>Start: {activeLog.startedAt.toLocaleTimeString()}</span>}
                  {activeLog.finishedAt && <span>End: {activeLog.finishedAt.toLocaleTimeString()}</span>}
                </div>
                {activeLog.description && (
                  <p className="mt-2 text-xs text-slate-300">{activeLog.description}</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Input Arguments</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-slate-200">
                  {JSON.stringify(activeLog.inputArgs ?? "<empty>", null, 2)}
                </pre>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Output</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-emerald-200">
                  {JSON.stringify(activeLog.outputResult ?? activeLog.outputText ?? "<empty>", null, 2)}
                </pre>
                {activeLog.error && (
                  <p className="mt-2 rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-xs text-rose-200">
                    {activeLog.error}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">선택된 도구 정보가 없습니다.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
