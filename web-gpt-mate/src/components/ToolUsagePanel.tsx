import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ToolLog } from "@/types/chat";
import { cn } from "@/lib/utils";

export interface StageToolGroup {
  stageKey: string;
  code: string;
  title: string;
  logs: ToolLog[];
}

interface ToolUsagePanelProps {
  groups: StageToolGroup[];
  isActive: boolean;
}

const formatTimestamp = (timestamp?: Date) => {
  if (!timestamp) return null;
  try {
    return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
};

const ToolUsagePanel = ({ groups, isActive }: ToolUsagePanelProps) => {
  const [activeLog, setActiveLog] = useState<ToolLog | null>(null);
  const hasLogs = useMemo(() => groups.some((group) => group.logs.length > 0), [groups]);

  return (
    <section className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">사용한 도구 출력</span>
        <span className="text-xs text-slate-400">
          {groups.reduce((acc, group) => acc + group.logs.length, 0)} tools
        </span>
      </div>
      {hasLogs ? (
        <div className="mt-4 space-y-4">
          {groups.map((group, index) => {
            const stepNumber = index + 1;
            return (
            <div
              key={group.stageKey}
              className="rounded-2xl border border-cyan-500/20 bg-slate-950/40 p-4 shadow-inner"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-200/70">
                    단계 {stepNumber} · {group.code}
                  </p>
                  <p className="text-sm font-semibold text-cyan-100">{group.title}</p>
                  <p className="text-xs text-slate-400">{group.logs.length} tool{group.logs.length > 1 ? "s" : ""} executed</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {group.logs.map((log) => {
                  const label = log.name || log.rawToolName || "Unnamed Tool";
                  const subLabel = [log.serverName, formatTimestamp(log.timestamp)].filter(Boolean).join(" · ");
                  return (
                    <Button
                      key={log.id}
                      variant="outline"
                      size="sm"
                      className="h-auto rounded-xl border-cyan-400/50 bg-cyan-500/10 px-3 py-1 text-left text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                      onClick={() => setActiveLog(log)}
                    >
                      <div className="flex flex-col leading-tight">
                        <span className="truncate">{label}</span>
                        {subLabel && (
                          <span className="text-[9px] font-normal text-cyan-200/70">{subLabel}</span>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>
          );
          })}
        </div>
      ) : (
        <div
          className={cn(
            "mt-4 rounded-2xl border border-dashed border-slate-800/70 bg-slate-900/40 p-4 text-xs text-slate-500",
            !isActive && "text-slate-500/80"
          )}
        >
          {isActive
            ? "현재 스트림에서 실행된 MCP 도구가 없습니다."
            : "추론이 완료되면 이곳에서 MCP 도구 실행 내역을 확인할 수 있습니다."}
        </div>
      )}

      <Dialog open={Boolean(activeLog)} onOpenChange={(open) => !open && setActiveLog(null)}>
        <DialogContent className="max-w-2xl border border-slate-800/80 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">도구 실행 세부 정보</DialogTitle>
            <DialogDescription className="text-slate-400">
              MCP 서버에서 실행된 함수의 입력과 출력을 확인하세요.
            </DialogDescription>
          </DialogHeader>
          {activeLog ? (
            <div className="space-y-4 text-sm text-slate-200">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Tool</p>
                <p className="mt-1 text-lg font-semibold text-slate-50">
                  {activeLog.name || activeLog.rawToolName || "Unnamed Tool"}
                </p>
                {activeLog.description && (
                  <p className="mt-1 text-slate-300">{activeLog.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                  {activeLog.stageTitle && <span>Stage: {activeLog.stageTitle}</span>}
                  {activeLog.serverName && <span>Server: {activeLog.serverName}</span>}
                  {formatTimestamp(activeLog.timestamp) && (
                    <span>Time: {formatTimestamp(activeLog.timestamp)}</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Input Arguments</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-slate-200">
                  {JSON.stringify(activeLog.inputArgs ?? "<empty>", null, 2)}
                </pre>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Output Result</p>
                {activeLog.outputPreview && (
                  <p className="mt-2 rounded-lg border border-slate-800/60 bg-slate-950/40 p-3 text-xs text-emerald-200/80">
                    {activeLog.outputPreview}
                  </p>
                )}
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs text-emerald-200">
                  {JSON.stringify(activeLog.outputResult ?? "<empty>", null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">선택된 도구 정보가 없습니다.</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default ToolUsagePanel;
