import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Bot, ChevronDown, Loader2, Sparkles, User, Wrench } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReasoningStep, DocumentReference, ToolLog } from "@/types/chat";

interface ChatMessageProps {
  message: string;
  isUser: boolean;
  timestamp?: Date;
  reasoningSteps?: ReasoningStep[];
  isThinking?: boolean;
  references?: DocumentReference[];
}
const ChatMessage = ({ message, isUser, timestamp, reasoningSteps: _reasoningSteps = [], isThinking = false, references = [] }: ChatMessageProps) => {
  const [referenceOpenState, setReferenceOpenState] = useState<Record<number, boolean>>({});
  const [isToolModalOpen, setIsToolModalOpen] = useState(false);
  const [activeToolLog, setActiveToolLog] = useState<ToolLog | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState<boolean>(Boolean(isThinking));

  useEffect(() => {
    if (isThinking) {
      setReasoningOpen(true);
    } else if ((_reasoningSteps?.length ?? 0) > 0) {
      setReasoningOpen(false);
    }
  }, [isThinking, _reasoningSteps?.length]);

  const openToolLogModal = (log: ToolLog) => {
    setActiveToolLog(log);
    setIsToolModalOpen(true);
  };

  const handleToolModalChange = (open: boolean) => {
    setIsToolModalOpen(open);
    if (!open) {
      setActiveToolLog(null);
    }
  };

  const formatToolTimestamp = (timestamp?: Date) => {
    if (!timestamp) return null;
    try {
      return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  };

  const toggleReference = (idx: number) => {
    setReferenceOpenState((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const alignment = isUser ? "justify-end" : "justify-start";
  const cardClasses = isUser
    ? "rounded-3xl border border-slate-800/80 bg-slate-900/80 px-5 py-4 text-slate-100 shadow-[0_18px_40px_-32px_rgba(59,130,246,0.5)]"
    : "rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-slate-900/40 px-6 py-5 text-slate-100 shadow-[0_30px_80px_-40px_rgba(6,182,212,0.55)] backdrop-blur-xl";

  return (
    <div className={cn("flex w-full gap-4", alignment)}>
      {!isUser && (
        <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 shadow-inner">
          <Bot className="h-5 w-5" />
        </div>
      )}

      <div className={cn("flex max-w-3xl flex-col gap-3", isUser ? "items-end" : "items-start")}
      >
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <span>{isUser ? "Researcher" : "JW MCP Agent"}</span>
          {timestamp && (
            <span className="text-[10px] font-medium text-slate-600">
              {timestamp.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        <div className={cardClasses}>
          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">
              {message}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border border-cyan-500/30 bg-slate-900/70 px-4 py-3 text-sm text-cyan-200">
                {isThinking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="font-medium">
                  {isThinking ? "Analyzing knowledge graph..." : "Insight synthesized"}
                </span>
              </div>
              {/* Live reasoning steps with collapsible container */}
              {(_reasoningSteps?.length ?? 0) > 0 && (
                <div className="my-2 rounded-xl border border-slate-800/60 bg-slate-900/60 p-3 text-sm text-slate-300">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-xs uppercase tracking-wide text-cyan-200/80">실행된 추론 단계</span>
                      <span className="ml-2 text-[11px] text-slate-400">{_reasoningSteps.length} steps</span>
                    </div>
                    {!isThinking && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full border border-slate-700/60 bg-slate-900/30 px-3 text-[11px] font-semibold text-slate-200"
                        onClick={() => setReasoningOpen((prev) => !prev)}
                      >
                        {reasoningOpen ? "추론 축소" : "추론 펼치기"}
                        <ChevronDown
                          className={cn(
                            "ml-2 h-3 w-3 transition-transform",
                            reasoningOpen ? "rotate-180" : "rotate-0",
                          )}
                        />
                      </Button>
                    )}
                  </div>
                  {reasoningOpen || isThinking ? (
                    <ul className="space-y-2">
                      {_reasoningSteps.map((step) => (
                        <li
                          key={step.id}
                          className={cn(
                            "rounded-md px-3 py-2 text-sm",
                            step.isStageSummary
                              ? "border border-cyan-500/40 bg-slate-900/70"
                              : "bg-slate-900/40"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-cyan-200/80">
                            <span>{step.stage}</span>
                            {step.iteration != null && (
                              <span className="text-[10px] text-slate-400">#{step.iteration}</span>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-slate-200/90 whitespace-pre-wrap">{step.message}</div>
                          {step.toolLogs && step.toolLogs.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {step.toolLogs.map((log) => (
                                <Button
                                  key={log.id}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openToolLogModal(log)}
                                  className="h-auto rounded-full border-cyan-400/50 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                                >
                                  <Wrench className="mr-1.5 h-3.5 w-3.5" />
                                  <div className="flex flex-col text-left leading-tight">
                                    <span>{log.name}</span>
                                    {(log.serverName || log.stageTitle) && (
                                      <span className="text-[9px] font-normal text-cyan-200/70">
                                        {[log.serverName, log.stageTitle].filter(Boolean).join(" · ")}
                                      </span>
                                    )}
                                  </div>
                                </Button>
                              ))}
                            </div>
                          )}
                          {step.toolLog && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openToolLogModal(step.toolLog!)}
                                className="h-8 rounded-full border-cyan-400/50 bg-cyan-500/10 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                              >
                                <Wrench className="mr-1.5 h-3.5 w-3.5" />
                                {step.toolLog.name}
                              </Button>
                              {formatToolTimestamp(step.toolLog.timestamp) && (
                                <span className="text-[11px] text-slate-400">
                                  {formatToolTimestamp(step.toolLog.timestamp)} 실행
                                </span>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">
                      총 {_reasoningSteps.length}개의 추론 단계를 축약했습니다. "추론 펼치기"를 눌러 전체 흐름을 확인하세요.
                    </p>
                  )}
                </div>
              )}

              <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                <MarkdownRenderer content={message} />
              </div>
            </div>
          )}

          {!isUser && (
            <div className="mt-5 space-y-4 text-sm">
              {references.length > 0 && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 text-sm">
                  <div className="flex items-center gap-2 border-b border-emerald-500/20 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-200">
                    References
                  </div>
                  <div className="divide-y divide-emerald-500/10">
                    {references.map((ref, idx) => {
                      const pageInfo = ref.page != null && ref.page !== "" ? ref.page : null;
                      const positionInfo = ref.position != null && ref.position !== "" ? ref.position : null;
                      const hasSnippet = Boolean(ref.contentSnippet);
                      const isExpanded = referenceOpenState[idx] ?? false;
                      return (
                        <div key={`${ref.fileName}-${idx}`} className="px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex-1 overflow-hidden space-y-1">
                              <p className="truncate font-medium text-slate-100">{ref.fileName || `문서 ${idx + 1}`}</p>
                              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                                <span className="rounded-full border border-emerald-500/30 px-2 py-0.5">
                                  Page {pageInfo ?? "N/A"}
                                </span>
                                <span className="rounded-full border border-emerald-500/30 px-2 py-0.5">
                                  Position {positionInfo ?? "N/A"}
                                </span>
                              </div>
                            </div>
                            {hasSnippet && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-100"
                                onClick={() => toggleReference(idx)}
                              >
                                {isExpanded ? "Close" : "Details"}
                                <ChevronDown
                                  className={cn(
                                    "ml-1 h-3 w-3 transition-transform",
                                    isExpanded ? "rotate-180" : "rotate-0",
                                  )}
                                />
                              </Button>
                            )}
                          </div>
                          {isExpanded && hasSnippet && (
                            <p className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100/90 whitespace-pre-wrap">
                              {ref.contentSnippet}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isUser && (
        <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-200 shadow-inner">
          <User className="h-5 w-5" />
        </div>
      )}
      <Dialog open={isToolModalOpen} onOpenChange={handleToolModalChange}>
        <DialogContent className="max-w-2xl border border-slate-800/80 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">MCP Tool Execution Detail</DialogTitle>
            <DialogDescription className="text-slate-400">
              스트리밍 중 호출된 MCP 도구 사용 내역을 확인하세요.
            </DialogDescription>
          </DialogHeader>
          {activeToolLog ? (
            <div className="space-y-4 text-sm text-slate-200">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Tool</p>
                <p className="mt-1 text-lg font-semibold text-slate-50">{activeToolLog.name}</p>
                {activeToolLog.description && (
                  <p className="mt-1 text-slate-300">{activeToolLog.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                  {activeToolLog.stageTitle && <span>Stage: {activeToolLog.stageTitle}</span>}
                  {activeToolLog.serverName && <span>Server: {activeToolLog.serverName}</span>}
                </div>
                {formatToolTimestamp(activeToolLog.timestamp) && (
                  <p className="mt-2 text-xs text-slate-400">실행 시각: {formatToolTimestamp(activeToolLog.timestamp)} </p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Input Arguments</p>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-slate-200">
                  {JSON.stringify(activeToolLog.inputArgs ?? "<empty>", null, 2)}
                </pre>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Output Result</p>
                {activeToolLog.outputPreview && (
                  <p className="mt-2 rounded-lg border border-slate-800/60 bg-slate-950/40 p-3 text-xs text-emerald-200/80">
                    {activeToolLog.outputPreview}
                  </p>
                )}
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-emerald-200">
                  {JSON.stringify(activeToolLog.outputResult ?? "<empty>", null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">선택된 도구 정보가 없습니다.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatMessage;
