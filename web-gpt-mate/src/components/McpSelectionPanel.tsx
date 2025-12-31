import { useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, AlertTriangle, Layers } from "lucide-react";
import type { McpServerStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface McpSelectionPanelProps {
  servers: McpServerStatus[];
  isLoading?: boolean;
  onRefresh?: () => void;
  onSelect?: (server: McpServerStatus) => void;
}

const statusLabel = (server: McpServerStatus) => {
  if (server.is_active) return "Active";
  if (server.status?.toLowerCase() === "idle") return "Idle";
  return server.status || "Offline";
};

export const McpSelectionPanel = ({ servers, isLoading = false, onRefresh, onSelect }: McpSelectionPanelProps) => {
  const [selected, setSelected] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!servers.length) {
      return { active: 0, total: 0 };
    }
    const active = servers.filter((server) => server.is_active).length;
    return { active, total: servers.length };
  }, [servers]);

  const handleSelect = (server: McpServerStatus) => {
    setSelected(server.name);
    onSelect?.(server);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/60 p-6 text-slate-100 shadow-[0_35px_120px_-60px_rgba(34,211,238,0.65)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">MCP Orchestration</p>
            <h2 className="mt-2 text-2xl font-semibold">{summary.active} / {summary.total} Active Pipelines</h2>
            <p className="text-sm text-slate-400">선택할 MCP 서버를 지정하여 오케스트레이션 플로우를 구성하세요.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-100"
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
              갱신
            </Button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto pb-32 md:grid-cols-2">
        {isLoading ? (
          <div className="col-span-full flex h-full items-center justify-center text-sm text-slate-400">
            상태를 불러오는 중입니다...
          </div>
        ) : servers.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-800/70 bg-slate-950/50 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <p className="text-base text-slate-200">표시할 MCP 서버가 없습니다.</p>
            <p className="text-sm text-slate-500">구성이 완료되었는지 확인한 뒤 다시 시도해주세요.</p>
          </div>
        ) : (
          servers.map((server) => {
            const isSelected = selected === server.name;
            return (
              <button
                key={server.name}
                onClick={() => handleSelect(server)}
                className={cn(
                  "flex flex-col gap-3 rounded-3xl border px-5 py-4 text-left transition",
                  server.is_active
                    ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-50"
                    : "border-slate-800/70 bg-slate-950/60 text-slate-200",
                  isSelected && "ring-2 ring-cyan-400",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-current/40 bg-current/10">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold">{server.name}</p>
                      <p className="text-xs text-slate-400">{server.tool_count} tools</p>
                    </div>
                  </div>
                  {server.is_active ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                      <ShieldCheck className="h-3 w-3" /> Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                      {statusLabel(server)}
                    </span>
                  )}
                </div>
                {server.message && (
                  <p className="text-sm text-slate-300">{server.message}</p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default McpSelectionPanel;
