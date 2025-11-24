import { MessageSquarePlus, MessageSquare, Trash2, LogOut, Home } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Conversation {
  id: string;
  title: string;
  lastMessage?: string;
  timestamp: Date;
}

interface AppSidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onLogout?: () => void;
  onNavigateHome: () => void;
}

export function AppSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onLogout,
  onNavigateHome,
}: AppSidebarProps) {
  const { open } = useSidebar();

  return (
    <Sidebar className="border-r border-slate-800/70 bg-slate-950/70 text-slate-200">
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
            대화 목록
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-slate-500/80">
                  {open ? "대화를 시작해보세요" : ""}
                </div>
              ) : (
                conversations.map((conversation) => (
                  <SidebarMenuItem key={conversation.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectConversation(conversation.id)}
                      className={cn(
                        "group relative w-full justify-start rounded-xl border border-transparent bg-slate-900/60 text-left text-slate-200 transition-all hover:-translate-y-0.5 hover:border-cyan-500/30 hover:bg-slate-900/80",
                        currentConversationId === conversation.id &&
                          "border-cyan-500/40 bg-slate-900/90 text-cyan-100 shadow-[0_12px_30px_-18px_rgba(34,211,238,0.55)]",
                      )}
                    >
                      <MessageSquare className="h-4 w-4 flex-shrink-0 text-cyan-300" />
                      {open && (
                        <>
                          <div className="flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium">
                              {conversation.title}
                            </div>
                            {conversation.lastMessage && (
                              <div className="truncate text-xs text-slate-400">
                                {conversation.lastMessage}
                              </div>
                            )}
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
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
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
