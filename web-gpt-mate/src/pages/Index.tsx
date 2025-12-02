import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ChatContainer from "@/components/ChatContainer";
import ChatInput from "@/components/ChatInput";
import { AppSidebar, Conversation } from "@/components/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { streamLangGraphChat, getChatHistory, deleteChatHistory } from "@/lib/api";
import {
  DocumentReference,
  Message,
  ReasoningStep,
  UiPayload,
  KnowledgeGraphData,
  StructurePanelData,
} from "@/types/chat";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import KnowledgeGraphPanel from "@/components/KnowledgeGraphPanel";
import ProteinStructurePanel from "@/components/ProteinStructurePanel";

const TEMPLATE_PROMPTS = [
  "위암(고형암)에 대한 신약 후보를 찾아줘",
  "췌장암 치료 타겟으로 적합한 유전자 리스트를 뽑아줘.",
  "TP53 유전자가 망가졌을 때 생물학적으로 어떤 일이 발생해?",
  "알츠하이머 조기 진단을 위한 혈액 내 바이오마커 후보는?",
  "BRCA1 변이 단백질 구조에 딱 맞는 리간드를 설계해줘.",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toStringOrDefault = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const toNullablePrimitive = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;

const Index = () => {
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [uiPayload, setUiPayload] = useState<UiPayload | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasPrefillParamsRef = useRef(
    Boolean(searchParams.get("q") || searchParams.get("project"))
  );
  const lastPrefillKeyRef = useRef<string | null>(null);
  const skipNextHistoryLoadRef = useRef(false);

  const decodeParam = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const cancelOngoingStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (conversations.length === 0 && !currentConversationId && !hasPrefillParamsRef.current) {
      handleNewConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChatHistory = useCallback(async (chatId: string) => {
    try {
      setIsLoadingHistory(true);
      setUiPayload(null);
      const response = await getChatHistory(chatId);
      
      if (response.messages && Array.isArray(response.messages)) {
        // 백엔드 메시지 형식을 프론트엔드 형식으로 변환
        const loadedMessages: Message[] = response.messages.map((msg, idx) => ({
          id: `${chatId}-${idx}`,
          text: msg?.content ?? "",
          isUser: msg?.role === "user",
          timestamp: new Date(),
          reasoningSteps: [],
          isThinking: false,
          references: [],
        }));
        setMessages(loadedMessages);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      setMessages([]);
      toast({
        title: "히스토리 로드 실패",
        description: error instanceof Error ? error.message : "대화 내용을 불러올 수 없습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [toast]);

  useEffect(() => {
    if (currentConversationId) {
      if (skipNextHistoryLoadRef.current) {
        skipNextHistoryLoadRef.current = false;
        return;
      }
      void loadChatHistory(currentConversationId);
    }
  }, [currentConversationId, loadChatHistory]);

  const handleNewConversation = () => {
    cancelOngoingStream();
    const newConversation: Conversation = {
      id: Date.now().toString(),
      title: "새 대화",
      timestamp: new Date(),
    };
    setConversations((prev) => [newConversation, ...prev]);
    skipNextHistoryLoadRef.current = true;
    setCurrentConversationId(newConversation.id);
    setMessages([]);
    setUiPayload(null);
  };

  const handleSelectConversation = (id: string) => {
    cancelOngoingStream();
    setCurrentConversationId(id);
    setUiPayload(null);
    // 히스토리는 useEffect에서 자동으로 로드됨
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      cancelOngoingStream();
      await deleteChatHistory(id);
      setConversations((prev) => prev.filter((conv) => conv.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(undefined);
        setMessages([]);
        setUiPayload(null);
      }
      toast({
        title: "대화 삭제됨",
        description: "대화가 삭제되었습니다.",
      });
    } catch (error) {
      toast({
        title: "삭제 실패",
        description: error instanceof Error ? error.message : "대화를 삭제할 수 없습니다.",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async (text: string) => {
    // 이전 요청이 있으면 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 대화가 없으면 새로 생성
    let chatId = currentConversationId;
    if (!chatId) {
      chatId = Date.now().toString();
      const newConversation: Conversation = {
        id: chatId,
        title: text.slice(0, 30) + (text.length > 30 ? "..." : ""),
        lastMessage: text.slice(0, 50),
        timestamp: new Date(),
      };
      setConversations((prev) => [newConversation, ...prev]);
      skipNextHistoryLoadRef.current = true;
      setCurrentConversationId(chatId);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      isUser: true,
      timestamp: new Date(),
      references: [],
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // 대화 목록 업데이트
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === chatId
          ? { ...conv, lastMessage: text.slice(0, 50), timestamp: new Date() }
          : conv
      )
    );

    // AI 응답 메시지 초기화
    const aiMessageId = (Date.now() + 1).toString();
    const aiMessage: Message = {
      id: aiMessageId,
      text: "",
      isUser: false,
      timestamp: new Date(),
      reasoningSteps: [],
      isThinking: true,
      references: [],
    };
    setMessages((prev) => [...prev, aiMessage]);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = streamLangGraphChat(
        {
          question: text,
          chatId: chatId,
          userInfo: null,
        },
        controller.signal
      );

      let accumulatedText = "";

      for await (const event of stream) {
        if (event.event === "token") {
          const chunk = typeof event.data === "string" ? event.data : "";
          for (const char of chunk) {
            accumulatedText += char;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId
                  ? { ...msg, text: accumulatedText }
                  : msg
              )
            );
          }
        } else if (event.event === "reasoning") {
          const payload = event.data;
          const payloadRecord = isRecord(payload) ? payload : undefined;
          const stage = payloadRecord && typeof payloadRecord.stage === "string" ? payloadRecord.stage : "info";
          const message =
            typeof payload === "string"
              ? payload
              : payloadRecord && typeof payloadRecord.message === "string"
              ? payloadRecord.message
              : JSON.stringify(payload ?? {});
          const iteration = payloadRecord && typeof payloadRecord.iteration === "number"
            ? payloadRecord.iteration
            : undefined;
          const step: ReasoningStep = {
            id: `${aiMessageId}-reason-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            stage,
            message,
            iteration,
            timestamp: new Date(),
          };
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? {
                    ...msg,
                    reasoningSteps: [...(msg.reasoningSteps ?? []), step],
                  }
                : msg
            )
          );
        } else if (event.event === "metadata") {
          console.debug("LangGraph metadata", event.data);
        } else if (event.event === "document_references") {
          const payload = isRecord(event.data) ? event.data : {};
          const docs = Array.isArray((payload as { documents?: unknown }).documents)
            ? (payload as { documents: unknown[] }).documents
            : [];
          const normalized: DocumentReference[] = docs.map((doc, idx) => {
            if (!isRecord(doc)) {
              return {
                fileName: `문서 ${idx + 1}`,
                page: null,
                position: null,
                contentSnippet: "",
              };
            }
            return {
              fileName:
                toStringOrDefault(doc.file_name) ||
                toStringOrDefault(doc.fileName) ||
                `문서 ${idx + 1}`,
              page: toNullablePrimitive(doc.page ?? doc.page_number),
              position: toNullablePrimitive(doc.position),
              contentSnippet:
                toStringOrDefault(doc.content_snippet) || toStringOrDefault(doc.contentSnippet),
            };
          });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? {
                    ...msg,
                    references: normalized,
                  }
                : msg
            )
          );
        } else if (event.event === "ui_payload") {
          const payload: UiPayload | null = isRecord(event.data) ? (event.data as UiPayload) : null;
          setUiPayload(payload);
        } else if (event.event === "error") {
          // 에러 처리
          const errorText = toStringOrDefault(event.data, "알 수 없는 오류가 발생했습니다.");
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, text: `오류: ${errorText}` }
                : msg
            )
          );
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, isThinking: false }
                : msg
            )
          );
          toast({
            title: "오류 발생",
            description: errorText,
            variant: "destructive",
          });
          break;
        } else if (event.event === "result") {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === chatId
                ? { ...conv, lastMessage: accumulatedText.slice(0, 80), timestamp: new Date() }
                : conv
            )
          );
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, isThinking: false }
                : msg
            )
          );
          break;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId
              ? { ...msg, isThinking: false }
              : msg
          )
        );
        return;
      }
      console.error("Chat stream error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "연결 오류가 발생했습니다.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMessageId
            ? { ...msg, text: `오류: ${errorMessage}` }
            : msg
        )
      );
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMessageId
            ? { ...msg, isThinking: false }
            : msg
        )
      );
      toast({
        title: "연결 오류",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMessageId
            ? { ...msg, isThinking: false }
            : msg
        )
      );
    }
  };

  useEffect(() => {
    const rawQuery = searchParams.get("q");
    const rawProject = searchParams.get("project");
    const decodedQuery = rawQuery ? decodeParam(rawQuery) : null;
    const decodedProject = rawProject ? decodeParam(rawProject) : null;

    const prefillKey = decodedQuery
      ? `q:${decodedQuery}`
      : decodedProject
      ? `project:${decodedProject}`
      : null;

    if (!prefillKey || lastPrefillKeyRef.current === prefillKey) {
      return;
    }

    lastPrefillKeyRef.current = prefillKey;

    if (decodedQuery) {
      void handleSendMessage(decodedQuery);
    } else if (decodedProject) {
      const prompt = `Show me the latest findings for project ${decodedProject}.`;
      void handleSendMessage(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("username");
    navigate("/login");
  };

  const handleNavigateHome = () => {
    navigate("/");
  };

  const handleTemplateSelect = (prompt: string) => {
    void handleSendMessage(prompt);
  };

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId),
    [conversations, currentConversationId],
  );

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => !message.isUser),
    [messages],
  );

  const hasCompletedAssistantResponse = useMemo(
    () => messages.some((msg) => !msg.isUser && !msg.isThinking && (msg.text?.trim()?.length ?? 0) > 0),
    [messages],
  );

  const latestReasoning = latestAssistantMessage?.reasoningSteps ?? [];
  const latestReferences = latestAssistantMessage?.references ?? [];
  const knowledgeGraphData = useMemo<KnowledgeGraphData | null>(
    () => uiPayload?.knowledge_graph ?? uiPayload?.knowledgeGraph ?? null,
    [uiPayload],
  );
  const structurePanelData = useMemo<StructurePanelData | null>(
    () => uiPayload?.structure_panel ?? uiPayload?.structurePanel ?? null,
    [uiPayload],
  );
  const streamingStatusLabel = isLoading
    ? "Streaming"
    : isLoadingHistory
    ? "Loading history"
    : "Idle";
  const showHeroLanding = messages.length === 0 && !isLoadingHistory;

  return (
  <SidebarProvider className="command-center-theme bg-slate-950 text-slate-100">
      <div className="flex min-h-screen w-full bg-slate-950 text-slate-100">
        <AppSidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onLogout={handleLogout}
          onNavigateHome={handleNavigateHome}
        />

        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="flex flex-1 flex-col border-x border-slate-800/70 bg-slate-950/60 backdrop-blur-xl">
            <header className="border-b border-slate-800/60 bg-slate-900/60/80 backdrop-blur-lg">
              <div className="flex flex-wrap items-center gap-4 px-6 py-4">
                <SidebarTrigger className="text-slate-200 hover:text-white" />
                <div className="space-y-0.5">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/70">JW MCP Command Center</p>
                  <h1 className="text-xl font-semibold text-slate-50">Research Copilot Workspace</h1>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  {activeConversation && (
                    <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
                      {activeConversation.title}
                    </Badge>
                  )}
                  <Badge variant="outline" className="ml-auto border-slate-700/70 bg-slate-800 text-slate-200">
                    {streamingStatusLabel}
                  </Badge>
                  {latestReferences.length > 0 && (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                      {latestReferences.length} Reference{latestReferences.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden px-2 py-4 sm:px-6 lg:px-10">
                {showHeroLanding ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="w-full max-w-3xl rounded-3xl border border-slate-800/70 bg-gradient-to-b from-slate-900/60 to-slate-950/80 p-8 text-center shadow-[0_25px_120px_-60px_rgba(14,165,233,0.8)]">
                      <p className="text-xs uppercase tracking-[0.4em] text-cyan-300/80">JW Research AI Ready</p>
                      <h2 className="mt-4 text-3xl font-semibold text-slate-50">
                        왼쪽 패널에서 새 대화를 시작하거나 아래 템플릿으로 연구 여정을 빠르게 열어보세요.
                      </h2>
                      <p className="mt-4 text-base text-slate-300/90">
                        실제 MCP 워크플로우와 연결된 대표 질문들입니다. 클릭하면 바로 분석이 시작됩니다.
                      </p>
                      <div className="mt-8 grid gap-3 md:grid-cols-2">
                        {TEMPLATE_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => handleTemplateSelect(prompt)}
                            className="rounded-2xl border border-slate-800/70 bg-slate-900/70 px-5 py-4 text-left text-sm text-slate-100 transition hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-slate-900/90"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <ChatContainer messages={messages} isLoading={isLoadingHistory} />
                )}
              </div>
              <div className="bg-slate-900/50 px-3 pb-8 pt-4 sm:px-6 lg:px-10">
                <ChatInput onSendMessage={handleSendMessage} disabled={isLoading || isLoadingHistory} />
              </div>
            </div>
          </div>

          <aside className="hidden w-full max-w-sm flex-col gap-5 border-l border-slate-800/70 bg-slate-950/60 p-6 backdrop-blur-xl xl:flex">
            <section className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.28em] text-cyan-300/80">Reasoning Process</span>
                  <h3 className="mt-1 text-sm font-semibold text-slate-100">
                    {activeConversation?.title ?? "현재 대화"}
                  </h3>
                </div>
                <span className="text-xs text-slate-400">{latestReasoning.length} steps</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800/80">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    isLoading ? "w-3/5 animate-pulse bg-cyan-400/80" : "w-full bg-emerald-400/80",
                  )}
                />
              </div>
              <ul className="mt-4 space-y-3 text-sm text-slate-300/80 overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-900/40 p-2 transition-all duration-200 dark:bg-slate-900/50 max-h-[26rem]">
                {latestReasoning.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-slate-800/70 bg-slate-900/50 px-3 py-4 text-center text-xs text-slate-500">
                    아직 추론 정보가 수집되지 않았습니다.
                  </li>
                ) : (
                  latestReasoning.map((step) => (
                    <li key={step.id} className="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-cyan-200/80">
                        {step.stage}
                      </p>
                      <p className="mt-1 text-sm text-slate-200/90">{step.message}</p>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">References</span>
                <span className="text-xs text-slate-400">{latestReferences.length}</span>
              </div>
              <ul className="mt-3 space-y-3 text-sm text-slate-300/80">
                {latestReferences.slice(0, 4).map((ref, idx) => (
                  <li key={`${ref.fileName}-${idx}`} className="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-3">
                    <p className="truncate text-sm font-medium text-slate-100">{ref.fileName}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <span>Page {ref.page ?? "-"}</span>
                      <span>Position {ref.position ?? "-"}</span>
                    </div>
                  </li>
                ))}
                {latestReferences.length === 0 && (
                  <li className="rounded-xl border border-dashed border-slate-800/70 bg-slate-900/50 px-3 py-4 text-center text-xs text-slate-500">
                    최신 응답에서 참조 문서가 발견되지 않았습니다.
                  </li>
                )}
              </ul>
            </section>

            <KnowledgeGraphPanel isActive={hasCompletedAssistantResponse} data={knowledgeGraphData ?? undefined} />

            <ProteinStructurePanel
              isActive={hasCompletedAssistantResponse}
              data={structurePanelData ?? undefined}
            />
          </aside>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;
