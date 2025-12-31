import { useState, useRef, useEffect } from "react";
import { Bot, Send, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const OneAgent = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simulate agent response
    setTimeout(() => {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "This is a mock response from One Agent. The backend integration is pending.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-slate-950 text-slate-200">
        <AppSidebar 
          conversations={[]}
          onSelectConversation={() => {}}
          onNewConversation={() => {}}
          onDeleteConversation={() => {}}
          onNavigateHome={() => navigate("/")}
          activeWorkspace="research"
          onChangeWorkspace={() => {}}
          mcpServers={[]}
          hideWorkspace={true}
        />
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
          <header className="flex items-center justify-between p-4 border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-sm">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-slate-400 hover:text-cyan-400" />
              <h1 className="text-xl font-semibold flex items-center gap-2 text-cyan-100">
                <Bot className="w-6 h-6 text-cyan-400" />
                One Agent
              </h1>
            </div>
          </header>

          <div className="flex-1 overflow-hidden p-4">
            <Card className="h-full flex flex-col shadow-sm border-slate-800 bg-slate-900/40">
              <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 mt-20">
                      <Bot className="w-12 h-12 mb-4 opacity-50 text-cyan-500" />
                      <p>Start a conversation with One Agent</p>
                    </div>
                  )}
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`flex gap-3 max-w-[80%] ${
                          msg.role === "user"
                            ? "flex-row-reverse"
                            : "flex-row"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            msg.role === "user"
                              ? "bg-cyan-600 text-white"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {msg.role === "user" ? (
                            <User className="w-5 h-5" />
                          ) : (
                            <Bot className="w-5 h-5" />
                          )}
                        </div>
                        <div
                          className={`p-3 rounded-lg ${
                            msg.role === "user"
                              ? "bg-cyan-600/20 text-cyan-100 border border-cyan-500/30"
                              : "bg-slate-800/50 text-slate-200 border border-slate-700"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          <span className="text-xs opacity-50 mt-1 block text-slate-400">
                            {msg.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                          <Bot className="w-5 h-5 animate-pulse text-cyan-400" />
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-cyan-400/50 rounded-full animate-bounce" />
                            <span className="w-2 h-2 bg-cyan-400/50 rounded-full animate-bounce delay-75" />
                            <span className="w-2 h-2 bg-cyan-400/50 rounded-full animate-bounce delay-150" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-slate-800 bg-slate-900/60">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    disabled={isLoading}
                    className="flex-1 bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-500 focus-visible:ring-cyan-500/50"
                  />
                  <Button type="submit" disabled={isLoading || !input.trim()} className="bg-cyan-600 hover:bg-cyan-500 text-white">
                    <Send className="w-4 h-4" />
                    <span className="sr-only">Send</span>
                  </Button>
                </form>
              </div>
            </Card>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
};

export default OneAgent;
