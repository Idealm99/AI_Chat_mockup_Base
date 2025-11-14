import { MessageSquarePlus, MessageSquare, Trash2, LogOut } from "lucide-react";
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
}

export function AppSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onLogout,
}: AppSidebarProps) {
  const { open } = useSidebar();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <div className="px-3 py-2">
            <Button
              onClick={onNewConversation}
              className="w-full justify-start gap-2"
              variant="outline"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {open && <span>새 대화</span>}
            </Button>
          </div>

          <SidebarGroupLabel>대화 목록</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {open ? "대화를 시작해보세요" : ""}
                </div>
              ) : (
                conversations.map((conversation) => (
                  <SidebarMenuItem key={conversation.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectConversation(conversation.id)}
                      className={cn(
                        "group relative w-full justify-start",
                        currentConversationId === conversation.id &&
                          "bg-muted text-primary font-medium"
                      )}
                    >
                      <MessageSquare className="h-4 w-4 flex-shrink-0" />
                      {open && (
                        <>
                          <div className="flex-1 overflow-hidden">
                            <div className="truncate text-sm">
                              {conversation.title}
                            </div>
                            {conversation.lastMessage && (
                              <div className="truncate text-xs text-muted-foreground">
                                {conversation.lastMessage}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
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
          <div className="px-3 py-2">
            <Button
              onClick={onLogout}
              className="w-full justify-start gap-2"
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
