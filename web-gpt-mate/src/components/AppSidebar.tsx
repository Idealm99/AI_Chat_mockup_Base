import { useMemo, type ComponentType } from "react";
import { MessageSquarePlus, MessageSquare, Trash2, LogOut, Home, Workflow, Bot, RefreshCw, Shield, Activity } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { McpServerStatus } from "@/lib/api";

export type WorkspaceView = "research" | "orchestration";

export interface Conversation {
  id: string;
  title: string;
  lastMessage?: string;
  timestamp: Date;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  isTemp?: boolean;
}

interface AppSidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onLogout?: () => void;
  onNavigateHome: () => void;
  activeWorkspace: WorkspaceView;
  onChangeWorkspace: (view: WorkspaceView) => void;
  mcpServers: McpServerStatus[];
  isLoadingMcp?: boolean;
  onRefreshMcp?: () => void;
  selectedMcpIds?: string[];
  onSelectMcp?: (serverName: string) => void;
}

export function AppSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onLogout,
  onNavigateHome,
  activeWorkspace,
  onChangeWorkspace,
  mcpServers,
  isLoadingMcp = false,
  onRefreshMcp,
  selectedMcpIds,
  onSelectMcp,
}: AppSidebarProps) {
  const { open } = useSidebar();
  const selectedSet = useMemo(() => new Set(selectedMcpIds ?? []), [selectedMcpIds]);

  const handleRefreshMcp = () => {
    if (isLoadingMcp) return;
    onRefreshMcp?.();
  };

  const handleSelectServer = (name: string) => {
    onSelectMcp?.(name);
  };

  const workspaceOptions: { key: WorkspaceView; label: string; description: string; icon: ComponentType<{ className?: string }> }[] = [
    {
      key: "research",
      label: "Research Agent",
      description: "대화형 분석 워크스페이스",
      icon: Bot,
    },
    {
      key: "orchestration",
      label: "Orchestration",
      description: "MCP 선택 및 제어",
      icon: Workflow,
    },
  ];

  const FRIENDLY_LABELS: Record<string, string> = {
    "OpenTargets-MCP-Server": "OpenTargets",
    OpenTargets: "OpenTargets",
    "AlphaFold-MCP-Server": "AlphaFold",
    AlphaFold: "AlphaFold",
    "ChEMBL-MCP-Server": "ChEMBL",
    ChEMBL: "ChEMBL",
    "Reactome-MCP-Server": "Reactome",
    Reactome: "Reactome",
  "UniProt-MCP-Server": "UniProt",
  UniProt: "UniProt",
  "Augmented-Nature-UniProt-MCP-Server": "UniProt",
  "Nature-UniProt-MCP-Server": "UniProt",
    "STRING-db-MCP-Server": "STRING",
    STRING: "STRING",
    "DrugBank-MCP-Server": "DrugBank",
    DrugBank: "DrugBank",
    "KEGG-MCP-Server": "KEGG",
    KEGG: "KEGG",
    "ClinicalTrials-MCP-Server": "Clinical Trials",
    ClinicalTrials: "Clinical Trials",
    "NCBI-Datasets-MCP-Server": "NCBI Datasets",
  };

  const formatServerName = (name: string) => FRIENDLY_LABELS[name] ?? name.replace(/-MCP-Server$/i, "").replace(/_/g, " ");
  const formatServerDetails = (server: McpServerStatus) => server.message ?? `${server.tool_count ?? 0} tools available`;

  return (
  <Sidebar collapsible="icon" className="max-w-[19.2rem] border-r border-slate-800/70 bg-slate-950/70 text-slate-200">
      <SidebarContent>
        <SidebarGroup>
          <div className="px-3 py-2">
            <Button
              onClick={onNewConversation}
              className="w-full justify-start gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20"
              variant="ghost"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {open && <span>새 대화</span>}
            </Button>
          </div>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
            사이트
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onNavigateHome}
                  className="w-full justify-start gap-3 rounded-xl border border-cyan-500/20 bg-slate-900/60 text-left text-slate-200 transition hover:-translate-y-0.5 hover:border-cyan-500/40 hover:bg-slate-900/80"
                >
                  <Home className="h-4 w-4 flex-shrink-0 text-cyan-300" />
                  {open && <span className="text-sm font-medium">Command Center</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaceOptions.map((option) => (
                <SidebarMenuItem key={option.key}>
                  <SidebarMenuButton
                    onClick={() => onChangeWorkspace(option.key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border border-transparent bg-slate-900/40 px-3 py-3 text-left text-sm text-slate-200 transition hover:border-cyan-500/40 hover:bg-slate-900/70",
                      activeWorkspace === option.key &&
                        "border-cyan-500/40 bg-cyan-500/10 text-cyan-100 shadow-[0_10px_35px_-20px_rgba(34,211,238,0.65)]",
                    )}
                  >
                    <option.icon className="h-4 w-4 text-cyan-300" />
                    {open && (
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{option.label}</div>
                        <p className="text-xs text-slate-500">{option.description}</p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
            {activeWorkspace === "research" ? "대화 목록" : "MCP 선택"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {activeWorkspace === "research" ? (
              <SidebarMenu>
                {conversations.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-slate-500/80">{open ? "대화를 시작해보세요" : ""}</div>
                ) : (
                  conversations.map((conversation) => (
                    <SidebarMenuItem key={conversation.id}>
                      <SidebarMenuButton
                        onClick={() => onSelectConversation(conversation.id)}
                        className={cn(
                          "group relative flex h-auto w-full flex-col items-start gap-1 rounded-xl border border-transparent bg-slate-900/60 p-4 text-left text-slate-200 transition-all hover:-translate-y-0.5 hover:border-cyan-500/30 hover:bg-slate-900/80",
                          currentConversationId === conversation.id &&
                            "border-cyan-500/40 bg-slate-900/90 text-cyan-100 shadow-[0_12px_30px_-18px_rgba(34,211,238,0.55)]",
                        )}
                      >
                        <div className="flex w-full items-center gap-3">
                          <MessageSquare className="h-4 w-4 flex-shrink-0 text-cyan-300" />
                          {open && (
                            <>
                              <div className="flex-1 overflow-hidden">
                                <div className="truncate text-sm font-medium">{conversation.title}</div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-lg bg-slate-900/80 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conversation.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                        {open && conversation.lastMessage && (
                          <div className="mt-1 line-clamp-2 w-full text-xs text-slate-400">{conversation.lastMessage}</div>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            ) : (
              <div className="space-y-3 px-2">
                <div className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <span>Orchestration Targets</span>
                  <button
                    onClick={handleRefreshMcp}
                    disabled={isLoadingMcp}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={cn("h-3 w-3", isLoadingMcp && "animate-spin")} />
                    Refresh
                  </button>
                </div>
                <div className={cn("flex gap-3", open ? "grid grid-cols-2" : "flex-col")}>
                  {isLoadingMcp && (
                    <div
                      className={cn(
                        "col-span-2 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-4 py-6 text-sm text-slate-400"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                        Loading MCP servers...
                      </div>
                    </div>
                  )}
                  {!isLoadingMcp && mcpServers.length === 0 && (
                    <div
                      className={cn(
                        "col-span-2 rounded-2xl border border-dashed border-slate-800/70 bg-slate-900/50 px-4 py-6 text-sm text-slate-500"
                      )}
                    >
                      등록된 MCP 서버가 없습니다.
                    </div>
                  )}
                  {!isLoadingMcp &&
                    mcpServers.map((server) => {
                      const label = formatServerName(server.name);
                      const isSelected = selectedSet.has(server.name);
                      const statusColor = server.is_active ? "bg-emerald-400" : "bg-amber-400";

                      if (!open) {
                        return (
                          <button
                            key={server.name}
                            onClick={() => handleSelectServer(server.name)}
                            className={cn(
                              "flex items-center justify-center rounded-2xl border border-slate-800/70 bg-slate-900/60 p-3 text-slate-100 transition hover:border-slate-600",
                              isSelected && "border-cyan-500/50 bg-slate-900"
                            )}
                            title={label}
                          >
                            <Bot className="h-4 w-4" />
                          </button>
                        );
                      }

                      return (
                        <button
                          key={server.name}
                          onClick={() => handleSelectServer(server.name)}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-2xl border border-slate-800/70 bg-slate-900/40 px-3 py-3 transition hover:border-cyan-500/40",
                            isSelected && "border-cyan-400/60 bg-slate-950/60 shadow-[0_10px_25px_-18px_rgba(34,211,238,0.7)]"
                          )}
                        >
                          <div className="truncate text-sm font-semibold text-slate-100">
                            {label}
                          </div>
                          <span className={cn("h-2.5 w-2.5 flex-shrink-0 rounded-full", statusColor)} />
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {onLogout && (
        <SidebarFooter>
          <div className="px-3 py-3">
            <Button
              onClick={onLogout}
              className="w-full justify-start gap-2 rounded-xl border border-slate-800/80 bg-slate-900/80 text-slate-400 transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-200"
              variant="ghost"
            >
              <LogOut className="h-4 w-4" />
              {open && <span>로그아웃</span>}
            </Button>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
