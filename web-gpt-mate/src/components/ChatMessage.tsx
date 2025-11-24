import { useState } from "react";
import { cn } from "@/lib/utils";
import { Bot, ChevronDown, Loader2, Sparkles, User } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { Button } from "@/components/ui/button";
import type { ReasoningStep, DocumentReference } from "@/types/chat";

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
    </div>
  );
};

export default ChatMessage;
