import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Bot } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ChatContainer from "@/components/ChatContainer";
import ChatInput from "@/components/ChatInput";
import OrchestrationRunCard from "@/components/OrchestrationRunCard";
import OrchestrationChatMessage from "@/components/OrchestrationChatMessage";
import { AppSidebar, Conversation, type WorkspaceView } from "@/components/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { streamLangGraphChat, streamOrchestrationChat, getChatHistory, deleteChatHistory, getChatSessions, getMcpStatus } from "@/lib/api";
import {
  DocumentReference,
  Message,
  ReasoningStep,
  UiPayload,
  KnowledgeGraphData,
  StructurePanelData,
  ToolLog,
  UsageTotals,
} from "@/types/chat";
import type { McpServerStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import KnowledgeGraphPanel from "@/components/KnowledgeGraphPanel";
import ProteinStructurePanel from "@/components/ProteinStructurePanel";
import ToolUsagePanel from "@/components/ToolUsagePanel";

const TEMPLATE_PROMPTS = [
  "위암(고형암)에 대한 신약 후보를 찾아줘",
  "췌장암 치료 타겟으로 적합한 유전자 리스트를 뽑아줘.",
  "TP53 유전자가 망가졌을 때 생물학적으로 어떤 일이 발생해?",
  "알츠하이머 조기 진단을 위한 혈액 내 바이오마커 후보는?",
  "BRCA1 변이 단백질 구조에 딱 맞는 리간드를 설계해줘.",
];

const STAGE_FLOW = [
  { stageKey: "target_agent", code: "TV", title: "TargetAgent" },
  { stageKey: "chem_agent", code: "CD", title: "ChemAgent" },
  { stageKey: "structure_agent", code: "SA", title: "StructureAgent" },
  { stageKey: "pathway_agent", code: "PI", title: "PathwayAgent" },
  { stageKey: "clinical_agent", code: "CL", title: "ClinicalAgent" },
] as const;

type StagePriorityMeta = { stageKey: string; code: string; title: string; order: number };

const STAGE_PRIORITY_MAP: Map<string, StagePriorityMeta> = new Map(
  STAGE_FLOW.map((meta, index) => [meta.stageKey, { ...meta, order: index }]),
);

const ORCHESTRATION_CHAT_PREFIX = "orch-session";

type OrchestrationRun = {
  id: string;
  prompt: string;
  serverName: string;
  serverLabel: string;
  status: "running" | "completed" | "error";
  response: string;
  startedAt: Date;
  finishedAt?: Date;
  toolLogs?: ToolLog[];
};

type OrchestrationMessage = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  runId?: string; // reference to OrchestrationRun
  usage?: UsageTotals;
  cost?: number;
  toolLogs?: ToolLog[];
};


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toStringOrDefault = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const toNullablePrimitive = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;

const normalizeMcpLabel = (name?: string | null) => {
  if (!name) {
    return "";
  }
  return name.replace(/-MCP-Server$/i, "").replace(/_/g, " ");
};

type UsagePayload = {
  usage?: UsageTotals;
  cost?: number;
};

const isUsageTotals = (value: unknown): value is UsageTotals => {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["prompt_tokens", "completion_tokens", "total_tokens"].every((key) => {
    const item = candidate[key];
    return item === undefined || typeof item === "number";
  });
};

const isUsagePayload = (value: unknown): value is UsagePayload => {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value as { usage?: unknown; cost?: unknown };
  const usageValid = candidate.usage === undefined || isUsageTotals(candidate.usage);
  const costValid = candidate.cost === undefined || typeof candidate.cost === "number";
  return usageValid && costValid;
};

const toDateFromValue = (value: unknown): Date => {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
};

const buildToolLogFromMetadata = (entry: unknown, messageId: string, index: number): ToolLog | null => {
  if (!isRecord(entry)) {
    return null;
  }
  const payload = isRecord(entry.data) ? (entry.data as Record<string, unknown>) : (entry as Record<string, unknown>);
  if (!payload) {
    return null;
  }
  const baseToolName = toStringOrDefault(
    (payload.tool_label as string) ?? (payload.tool_name as string) ?? (payload.toolName as string),
    "알 수 없는 도구",
  );
  const description = toStringOrDefault((payload.description as string) ?? "");
  const timestampValue = entry.timestamp as string | undefined;
  const toolTimestamp = timestampValue ? toDateFromValue(timestampValue) : new Date();
  const inputArgs =
    payload.input_args ?? payload.inputArgs ?? payload.arguments ?? payload.tool_args ?? payload.toolArgs ?? null;
  const outputResult =
    payload.output_result ?? payload.outputResult ?? payload.result ?? payload.tool_result ?? payload.toolResult ?? null;
  const outputPreview = toStringOrDefault((payload.output_preview as string) ?? "");
  const stageKeyRaw = toStringOrDefault((payload.stage as string) ?? (payload.stage_key as string) ?? "");
  const stageTitle = toStringOrDefault(payload.stage_title as string);
  const serverName = toStringOrDefault(payload.server_name as string);

  return {
    id: `${messageId}-stored-tool-${index}`,
    name: baseToolName,
    rawToolName: toStringOrDefault(payload.tool_name as string),
    description,
    inputArgs,
    outputResult,
    outputPreview,
    timestamp: toolTimestamp,
    stageKey: stageKeyRaw || undefined,
    stageTitle: stageTitle || undefined,
    serverName: serverName || undefined,
  };
};

const toOptionalDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return undefined;
};

const isToolEventStatus = (value: unknown): value is ToolLog["status"] =>
  value === "started" || value === "completed" || value === "error";

const buildToolLogFromEvent = (payload: unknown): ToolLog | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id : undefined;
  const nameCandidate =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.rawToolName === "string"
        ? payload.rawToolName
        : undefined;
  if (!id || !nameCandidate) {
    return null;
  }
  const log: ToolLog = {
    id,
    name: nameCandidate,
    rawToolName: typeof payload.rawToolName === "string" ? payload.rawToolName : nameCandidate,
    description: typeof payload.description === "string" ? payload.description : undefined,
    inputArgs: (payload.arguments ?? payload.inputArgs) as unknown,
    outputResult: (payload.output ?? payload.outputResult) as unknown,
    outputPreview: typeof payload.outputPreview === "string" ? payload.outputPreview : undefined,
    outputText: typeof payload.outputText === "string" ? payload.outputText : undefined,
    serverName: typeof payload.server === "string" ? payload.server : undefined,
    status: isToolEventStatus(payload.status) ? payload.status : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    startedAt: toOptionalDate(payload.startedAt),
    finishedAt: toOptionalDate(payload.finishedAt),
    timestamp: toOptionalDate(payload.timestamp),
  };
  if (!log.timestamp) {
    log.timestamp = log.finishedAt ?? log.startedAt;
  }
  return log;
};

const mergeToolLogs = (existing: ToolLog | undefined, incoming: ToolLog): ToolLog => {
  if (!existing) {
    return incoming;
  }
  return {
    ...existing,
    ...incoming,
    inputArgs: incoming.inputArgs ?? existing.inputArgs,
    outputResult: incoming.outputResult ?? existing.outputResult,
    outputPreview: incoming.outputPreview ?? existing.outputPreview,
    outputText: incoming.outputText ?? existing.outputText,
    serverName: incoming.serverName ?? existing.serverName,
    description: incoming.description ?? existing.description,
    status: incoming.status ?? existing.status,
    error: incoming.error ?? existing.error,
    startedAt: incoming.startedAt ?? existing.startedAt,
    finishedAt: incoming.finishedAt ?? existing.finishedAt,
    timestamp: incoming.timestamp ?? existing.timestamp,
  };
};

const buildReasoningStepFromMetadata = (
  entry: unknown,
  messageId: string,
  index: number,
  toolLogsByStage: Record<string, ToolLog[]>,
): ReasoningStep | null => {
  const payload = isRecord(entry)
    ? (isRecord(entry.data) ? (entry.data as Record<string, unknown>) : (entry as Record<string, unknown>))
    : undefined;
  const timestamp = isRecord(entry) && entry.timestamp ? toDateFromValue(entry.timestamp) : new Date();
  const payloadRecord = payload ?? {};
  const stage = typeof payloadRecord.stage === "string" ? payloadRecord.stage : "info";
  let message = "";
  if (typeof entry === "string") {
    message = entry;
  } else if (typeof payloadRecord.message === "string") {
    message = payloadRecord.message;
  } else if (payloadRecord.results) {
    try {
      message = JSON.stringify(payloadRecord.results);
    } catch {
      message = String(payloadRecord.results);
    }
  }
  const iteration = typeof payloadRecord.iteration === "number" ? payloadRecord.iteration : undefined;
  const stageKey = typeof payloadRecord.stage === "string" ? payloadRecord.stage : undefined;
  const isStageSummary = Boolean(stageKey && Array.isArray((payloadRecord as { results?: unknown }).results));
  const attachedLogs = stageKey ? toolLogsByStage[stageKey] : undefined;

  return {
    id: `${messageId}-stored-reason-${index}`,
    stage,
    message,
    iteration,
    timestamp,
    stageKey,
    isStageSummary,
    toolLogs: attachedLogs && attachedLogs.length > 0 ? [...attachedLogs] : undefined,
  };
};

const buildReferencesFromMetadata = (entries: unknown[]): DocumentReference[] => {
  return entries
    .map((ref, idx) => {
      if (!isRecord(ref)) {
        return {
          fileName: `문서 ${idx + 1}`,
          page: null,
          position: null,
          contentSnippet: "",
        } satisfies DocumentReference;
      }
      return {
        fileName:
          toStringOrDefault(ref.file_name) || toStringOrDefault(ref.fileName) || `문서 ${idx + 1}`,
        page: toNullablePrimitive(ref.page),
        position: toNullablePrimitive(ref.position),
        contentSnippet:
          toStringOrDefault(ref.content_snippet) || toStringOrDefault(ref.contentSnippet),
      } satisfies DocumentReference;
    })
    .filter(Boolean);
};

const Index = () => {
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [uiPayload, setUiPayload] = useState<UiPayload | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasPrefillParamsRef = useRef(Boolean(searchParams.get("q") || searchParams.get("project")));
  const lastPrefillKeyRef = useRef<string | null>(null);
  const skipNextHistoryLoadRef = useRef(false);
  const stageToolLogsRef = useRef<Record<string, ToolLog[]>>({});
  const sessionsLoadedRef = useRef(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("research");
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [isLoadingMcp, setIsLoadingMcp] = useState(false);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRun[]>([]);
  const [orchestrationMessages, setOrchestrationMessages] = useState<OrchestrationMessage[]>([]);
  const [orchestrationTab, setOrchestrationTab] = useState<"chat" | "timeline">("chat");
  const [orchestrationChatId, setOrchestrationChatId] = useState<string | null>(null);
  const orchestrationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const orchestrationMessagesEndRef = useRef<HTMLDivElement>(null);
  const [isOrchestrationStreaming, setIsOrchestrationStreaming] = useState(false);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const refreshMcpStatuses = useCallback(async () => {
    try {
      setIsLoadingMcp(true);
      const response = await getMcpStatus();
      setMcpServers(response.servers ?? []);
    } catch (error) {
      console.error("Failed to load MCP status:", error);
      toast({
        title: "MCP 상태 로드 실패",
        description: error instanceof Error ? error.message : "MCP 서버 상태를 불러오지 못했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingMcp(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshMcpStatuses();
  }, [refreshMcpStatuses]);

  useEffect(() => {
    if (selectedMcpIds.length === 0) {
      return;
    }
    const validIds = selectedMcpIds.filter((id) => mcpServers.some((server) => server.name === id));
    if (validIds.length !== selectedMcpIds.length) {
      setSelectedMcpIds(validIds);
    }
  }, [mcpServers, selectedMcpIds]);

  // Auto-scroll to latest orchestration message
  useEffect(() => {
    if (orchestrationTab === "chat" && orchestrationMessagesEndRef.current) {
      setTimeout(() => {
        orchestrationMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 0);
    }
  }, [orchestrationMessages, orchestrationTab]);

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

  const refreshSessions = useCallback(
    async (options?: { preserveSelection?: boolean }) => {
      try {
        setIsLoadingSessions(true);
        const sessions = await getChatSessions(100);
        const researchSessions = sessions.filter((session) => !session.chat_id?.startsWith(`${ORCHESTRATION_CHAT_PREFIX}`));
        const mapped = researchSessions.map((session, idx) => ({
          id: session.chat_id,
          title: session.title || `대화 ${idx + 1}`,
          lastMessage: session.last_message || undefined,
          timestamp: session.updated_at ? new Date(session.updated_at) : new Date(),
          promptTokens: session.prompt_tokens ?? 0,
          completionTokens: session.completion_tokens ?? 0,
          totalTokens: session.total_tokens ?? 0,
          cost: session.cost ?? 0,
        }));
        const tempConversations = conversationsRef.current.filter(
          (conv) => conv.isTemp && !mapped.some((session) => session.id === conv.id),
        );
        const merged = [...tempConversations, ...mapped];
        setConversations(merged);
        setCurrentConversationId((prev) => {
          if (options?.preserveSelection === false) {
            return merged[0]?.id ?? prev;
          }
          if (prev && merged.some((conv) => conv.id === prev)) {
            return prev;
          }
          return merged[0]?.id ?? prev;
        });
      } catch (error) {
        console.error("Failed to load chat sessions:", error);
        toast({
          title: "대화 목록 불러오기 실패",
          description: error instanceof Error ? error.message : "대화 목록을 불러올 수 없습니다.",
          variant: "destructive",
        });
      } finally {
        sessionsLoadedRef.current = true;
        setIsLoadingSessions(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!sessionsLoadedRef.current) {
      return;
    }
    if (conversations.length === 0 && !currentConversationId && !hasPrefillParamsRef.current) {
      handleNewConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, currentConversationId]);

  const loadChatHistory = useCallback(
    async (chatId: string) => {
      try {
        setIsLoadingHistory(true);
        setUiPayload(null);
        stageToolLogsRef.current = {};
        const response = await getChatHistory(chatId, 200);

        if (!response.messages || !Array.isArray(response.messages) || response.messages.length === 0) {
          setMessages([]);
          setSelectedAssistantId(null);
          return;
        }

        const normalizedMessages: Message[] = response.messages.map((msg, idx) => {
          const messageId = `${chatId}-${idx}`;
          const baseMessage: Message = {
            id: messageId,
            text: msg?.content ?? "",
            isUser: msg?.role === "user",
            timestamp: msg?.created_at ? new Date(msg.created_at) : new Date(),
            reasoningSteps: [],
            isThinking: false,
            references: [],
          };

          const metadata = isRecord(msg?.metadata) ? (msg.metadata as Record<string, unknown>) : undefined;
          if (!metadata) {
            return baseMessage;
          }

          const rawToolLogs = Array.isArray(metadata.tool_logs ?? metadata.toolLogs)
            ? ((metadata.tool_logs ?? metadata.toolLogs) as unknown[])
            : [];
          const toolLogs = rawToolLogs
            .map((entry, logIdx) => buildToolLogFromMetadata(entry, messageId, logIdx))
            .filter((log): log is ToolLog => Boolean(log));
          const toolLogsByStage = toolLogs.reduce<Record<string, ToolLog[]>>((acc, log) => {
            if (log.stageKey) {
              acc[log.stageKey] = [...(acc[log.stageKey] ?? []), log];
            }
            return acc;
          }, {});

          const rawReasoning = Array.isArray(
            metadata.reasoning_events ?? metadata.reasoning ?? metadata.reasoningSteps,
          )
            ? ((metadata.reasoning_events ?? metadata.reasoning ?? metadata.reasoningSteps) as unknown[])
            : [];
          const reasoningSteps = rawReasoning
            .map((entry, reasonIdx) =>
              buildReasoningStepFromMetadata(entry, messageId, reasonIdx, toolLogsByStage),
            )
            .filter((step): step is ReasoningStep => Boolean(step));

          const rawReferences = Array.isArray(metadata.references ?? metadata.reference_documents)
            ? ((metadata.references ?? metadata.reference_documents) as unknown[])
            : [];
          const references = rawReferences.length > 0 ? buildReferencesFromMetadata(rawReferences) : [];

          const uiPayloadFromMetadata = isRecord(metadata.ui_payload ?? metadata.uiPayload)
            ? ((metadata.ui_payload ?? metadata.uiPayload) as UiPayload)
            : null;

          const usageFromMetadata = isUsageTotals(
            metadata.usage ?? metadata.usage_summary ?? metadata.usageTotals ?? metadata.usageTotal,
          )
            ? ((metadata.usage ?? metadata.usage_summary ?? metadata.usageTotals ?? metadata.usageTotal) as UsageTotals)
            : undefined;

          const costFromMetadata = typeof metadata.cost === "number" ? metadata.cost : undefined;

          return {
            ...baseMessage,
            reasoningSteps,
            references,
            uiPayload: uiPayloadFromMetadata,
            toolLogs,
            usage: usageFromMetadata,
            cost: costFromMetadata,
          };
        });

        setMessages(normalizedMessages);
        const latestAssistant = [...normalizedMessages].reverse().find((message) => !message.isUser);
        setSelectedAssistantId(latestAssistant?.id ?? null);
        if (latestAssistant?.uiPayload) {
          setUiPayload(latestAssistant.uiPayload);
        } else {
          setUiPayload(null);
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
        setMessages([]);
        setSelectedAssistantId(null);
        toast({
          title: "히스토리 로드 실패",
          description: error instanceof Error ? error.message : "대화 내용을 불러올 수 없습니다.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [toast],
  );

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
      isTemp: true,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
    };
    setConversations((prev) => [newConversation, ...prev]);
    skipNextHistoryLoadRef.current = true;
    setCurrentConversationId(newConversation.id);
    setMessages([]);
    setUiPayload(null);
    setSelectedAssistantId(null);
  };

  const handleSelectConversation = (id: string) => {
    cancelOngoingStream();
    setCurrentConversationId(id);
    setUiPayload(null);
    setSelectedAssistantId(null);
    // 히스토리는 useEffect에서 자동으로 로드됨
  };

  useEffect(() => {
    const assistantMessages = messages.filter((msg) => !msg.isUser);
    setSelectedAssistantId((prev) => {
      if (assistantMessages.length === 0) {
        return null;
      }
      if (prev && assistantMessages.some((msg) => msg.id === prev)) {
        return prev;
      }
      return assistantMessages[assistantMessages.length - 1]?.id ?? null;
    });
  }, [messages]);

  const handleSelectAssistantMessage = (messageId: string) => {
    setSelectedAssistantId(messageId);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      cancelOngoingStream();
      const target = conversations.find((conv) => conv.id === id);
      if (!target?.isTemp) {
        await deleteChatHistory(id);
      }
      setConversations((prev) => prev.filter((conv) => conv.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(undefined);
        setMessages([]);
        setUiPayload(null);
        setSelectedAssistantId(null);
      }
      void refreshSessions();
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
        isTemp: true,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
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
    stageToolLogsRef.current = {};
    setMessages((prev) => [...prev, aiMessage]);
    setSelectedAssistantId(aiMessageId);

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
        } else if (event.event === "result" || (event.event === "assistant" && event.data)) {
          if (isUsagePayload(event.data)) {
            const { usage, cost } = event.data;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId
                  ? {
                      ...msg,
                      usage: usage ?? msg.usage,
                      cost: typeof cost === "number" ? cost : msg.cost,
                    }
                  : msg,
              ),
            );
          }
          if (event.event === "result") {
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
            void refreshSessions();
            break;
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
          const stageKey = payloadRecord && typeof payloadRecord.stage === "string" ? payloadRecord.stage : undefined;
          const isStageSummary = Boolean(stageKey && Array.isArray((payloadRecord as { results?: unknown }).results));
          const attachedToolLogs = stageKey && isStageSummary
            ? (stageToolLogsRef.current[stageKey] ?? [])
            : undefined;
          const step: ReasoningStep = {
            id: `${aiMessageId}-reason-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            stage,
            message,
            iteration,
            timestamp: new Date(),
            stageKey,
            isStageSummary,
            toolLogs: attachedToolLogs && attachedToolLogs.length > 0 ? [...attachedToolLogs] : undefined,
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
        } else if (event.event === "tool_use") {
          const payload = isRecord(event.data) ? (event.data as Record<string, unknown>) : {};
          const baseToolName = toStringOrDefault(
            (payload.tool_label as string) ?? (payload.tool_name as string) ?? (payload.toolName as string),
            "알 수 없는 도구"
          );
          const description = toStringOrDefault((payload.description as string) ?? "");
          const timestampValue = payload.timestamp as string | undefined;
          const toolTimestamp = timestampValue ? new Date(timestampValue) : new Date();
          const inputArgs =
            payload.input_args ?? payload.inputArgs ?? payload.arguments ?? payload.tool_args ?? null;
          const outputResult =
            payload.output_result ?? payload.outputResult ?? payload.result ?? payload.tool_result ?? null;
          const outputPreview = toStringOrDefault((payload.output_preview as string) ?? "");
          const stageKeyRaw = toStringOrDefault((payload.stage as string) ?? (payload.stage_key as string) ?? "");
          const stageTitle = toStringOrDefault(payload.stage_title as string);
          const serverName = toStringOrDefault(payload.server_name as string);

          const log: ToolLog = {
            id: `${aiMessageId}-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: baseToolName,
            rawToolName: toStringOrDefault(payload.tool_name as string),
            description,
            inputArgs,
            outputResult,
            outputPreview,
            timestamp: toolTimestamp,
            stageKey: stageKeyRaw || undefined,
            stageTitle: stageTitle || undefined,
            serverName: serverName || undefined,
          };

          if (log.stageKey) {
            stageToolLogsRef.current[log.stageKey] = [
              ...(stageToolLogsRef.current[log.stageKey] ?? []),
              log,
            ];
          }

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== aiMessageId) {
                return msg;
              }
              const updatedSteps = (msg.reasoningSteps ?? []).map((step) => {
                if (!log.stageKey || step.stageKey !== log.stageKey) {
                  return step;
                }
                const existing = step.toolLogs ?? [];
                if (existing.some((item) => item.id === log.id)) {
                  return step;
                }
                return {
                  ...step,
                  toolLogs: [...existing, log],
                };
              });
              return {
                ...msg,
                reasoningSteps: updatedSteps,
              };
            })
          );
        } else if (event.event === "metadata") {
          console.debug("LangGraph metadata", event.data);
          const payload = event.data;
          if (isUsagePayload(payload)) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId
                  ? {
                      ...msg,
                      usage: payload.usage,
                      cost: payload.cost,
                    }
                  : msg,
              ),
            );
          }
        } else if (event.event === "document_references") {
          const payload = isRecord(event.data) ? event.data : {};
          const docs = Array.isArray((payload as { documents?: unknown }).documents)
            ? (payload as { documents: unknown[] }).documents
            : [];
          const normalized: DocumentReference[] = docs.length > 0 ? buildReferencesFromMetadata(docs) : [];
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
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? {
                    ...msg,
                    uiPayload: payload,
                  }
                : msg,
            ),
          );
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

  const startOrchestrationRun = async (text: string) => {
    if (selectedMcpIds.length === 0) {
      toast({
        title: "MCP 서버 선택 필요",
        description: "오케스트레이션을 실행하기 전에 대상으로 사용할 MCP 서버를 선택하세요.",
        variant: "destructive",
      });
      return;
    }

    const targets = mcpServers.filter((server) => selectedMcpIds.includes(server.name));
    if (targets.length === 0) {
      toast({
        title: "MCP 서버 상태 오류",
        description: "선택한 MCP 서버 정보를 찾을 수 없습니다. 다시 선택해주세요.",
        variant: "destructive",
      });
      setSelectedMcpIds([]);
      return;
    }

    const runId = `${ORCHESTRATION_CHAT_PREFIX}-all-${Date.now()}`;
    const serverLabel = selectedMcpSummary;
    const newRun: OrchestrationRun = {
      id: runId,
      prompt: text,
      serverName: selectedMcpIds.join(", "),
      serverLabel,
      status: "running",
      response: "",
      startedAt: new Date(),
    };
    setOrchestrationRuns((prev) => [newRun, ...prev].slice(0, 12));

    // Add user message to chat
    setOrchestrationMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: "user",
        content: text,
        timestamp: new Date(),
        runId,
      },
    ]);

    // Abort any existing orchestration runs
    Object.values(orchestrationAbortControllersRef.current).forEach((ctrl) => ctrl.abort());
    orchestrationAbortControllersRef.current = {};

    const controller = new AbortController();
    orchestrationAbortControllersRef.current["orchestration"] = controller;
    setIsOrchestrationStreaming(true);

    const chatId = orchestrationChatId || `${ORCHESTRATION_CHAT_PREFIX}-${Date.now()}`;
    if (!orchestrationChatId) {
      setOrchestrationChatId(chatId);
    }
    let accumulatedText = "";
    let pendingUsage: UsageTotals | undefined;
    let pendingCost: number | undefined;
    const toolLogMap = new Map<string, ToolLog>();

    const upsertToolLog = (log: ToolLog) => {
      toolLogMap.set(log.id, mergeToolLogs(toolLogMap.get(log.id), log));
      const logs = Array.from(toolLogMap.values());
      patchRun((run) => ({ ...run, toolLogs: logs }));
    };

    const patchRun = (updater: (run: OrchestrationRun) => OrchestrationRun) => {
      setOrchestrationRuns((prev) => prev.map((run) => (run.id === runId ? updater(run) : run)));
    };

    try {
      const stream = streamOrchestrationChat(
        {
          question: text,
          chatId,
          userInfo: { workspace: "orchestration" },
          targetServers: selectedMcpIds,  // 선택된 서버 목록 전송
          mode: "orchestration",
          metadata: { workspace: "orchestration" },
        },
        controller.signal,
      );

      for await (const event of stream) {
        console.log("Stream event:", event.event); // Debug log
        if (event.event === "token") {
          const chunk = typeof event.data === "string" ? event.data : "";
          if (!chunk) {
            continue;
          }
          accumulatedText += chunk;
          console.log("Accumulated text length:", accumulatedText.length); // Debug log
          patchRun((run) => ({ ...run, response: accumulatedText }));
        } else if (event.event === "tool") {
          const log = buildToolLogFromEvent(event.data);
          if (log) {
            upsertToolLog(log);
          }
        } else if (event.event === "assistant" && isUsagePayload(event.data)) {
          const { usage, cost } = event.data;
          if (usage) {
            pendingUsage = usage;
          }
          if (typeof cost === "number") {
            pendingCost = cost;
          }
        } else if (event.event === "metadata" && isUsagePayload(event.data)) {
          const { usage, cost } = event.data;
          if (usage) {
            pendingUsage = usage;
          }
          if (typeof cost === "number") {
            pendingCost = cost;
          }
        } else if (event.event === "result") {
          const completedAt = new Date();
          const finalToolLogs = Array.from(toolLogMap.values()).filter((log) => {
            if (log.status === "completed" || log.status === "error") {
              return true;
            }
            if (log.status === "started") {
              return Boolean(log.outputResult || log.outputPreview || log.outputText || log.error);
            }
            return Boolean(log.outputResult || log.outputPreview || log.outputText || log.error);
          });
          patchRun((run) => ({ ...run, status: "completed", finishedAt: completedAt, toolLogs: finalToolLogs }));
          // Add assistant message to chat
          setOrchestrationMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              type: "assistant",
              content: accumulatedText,
              timestamp: new Date(),
              runId,
              usage: pendingUsage,
              cost: pendingCost,
              toolLogs: finalToolLogs,
            },
          ]);
          break;
        } else if (event.event === "error") {
          const errorText = toStringOrDefault(event.data, "실행 중 오류가 발생했습니다.");
          patchRun((run) => ({ ...run, status: "error", response: errorText, finishedAt: new Date() }));
          // Add error message to chat
          setOrchestrationMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              type: "assistant",
              content: `오류: ${errorText}`,
              timestamp: new Date(),
              runId,
            },
          ]);
          toast({
            title: "오케스트레이션 실패",
            description: errorText,
            variant: "destructive",
          });
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "연결 오류가 발생했습니다.";
      patchRun((run) => ({ ...run, status: "error", response: errorMessage, finishedAt: new Date() }));
      toast({
        title: "오케스트레이션 오류",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      const controllers = orchestrationAbortControllersRef.current;
      delete controllers["orchestration"];
      setIsOrchestrationStreaming(false);
    }
  };

  const handleSendOrchestrationMessage = (text: string) => {
    void startOrchestrationRun(text);
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

  const handleSelectMcpServer = (serverName: string) => {
    setSelectedMcpIds((prev) => {
      if (prev.includes(serverName)) {
        return prev.filter((id) => id !== serverName);
      }
      if (prev.length >= 4) {
        toast({
          title: "선택 제한",
          description: "오케스트레이션은 최대 4개의 MCP 서버까지 동시에 선택할 수 있습니다.",
          variant: "destructive",
        });
        return prev;
      }
      return [...prev, serverName];
    });
  };

  const handleClearOrchestrationRuns = () => {
    setOrchestrationRuns([]);
    setOrchestrationMessages([]);
    setOrchestrationChatId(null);
  };

  const handleChangeWorkspace = (view: WorkspaceView) => {
    if (view === activeWorkspace) {
      return;
    }
    if (view === "orchestration") {
      cancelOngoingStream();
    } else if (view === "research") {
      Object.values(orchestrationAbortControllersRef.current).forEach((controller) => controller.abort());
      orchestrationAbortControllersRef.current = {};
      setIsOrchestrationStreaming(false);
    }
    setActiveWorkspace(view);
  };

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId),
    [conversations, currentConversationId],
  );

  const isOrchestrationView = activeWorkspace === "orchestration";
  const selectedMcpList = useMemo(
    () => mcpServers.filter((server) => selectedMcpIds.includes(server.name)),
    [mcpServers, selectedMcpIds],
  );
  const selectedMcpSummary = useMemo(() => {
    if (selectedMcpList.length === 0) {
      return "";
    }
    const labels = selectedMcpList.map((server) => normalizeMcpLabel(server.name));
    if (labels.length <= 2) {
      return labels.join(", ");
    }
    const remaining = labels.length - 2;
    return `${labels.slice(0, 2).join(", ")} 외 ${remaining}개`;
  }, [selectedMcpList]);

  const activeUsageTotals: UsageTotals = useMemo(
    () => ({
      prompt_tokens: activeConversation?.promptTokens ?? 0,
      completion_tokens: activeConversation?.completionTokens ?? 0,
      total_tokens: activeConversation?.totalTokens ?? 0,
    }),
    [activeConversation],
  );

  const activeUsageCost = activeConversation?.cost ?? 0;
  const selectedAssistantMessage = useMemo(() => {
    if (!selectedAssistantId) {
      return [...messages].reverse().find((message) => !message.isUser) ?? null;
    }
    return messages.find((message) => !message.isUser && message.id === selectedAssistantId) ?? null;
  }, [messages, selectedAssistantId]);

  useEffect(() => {
    setUiPayload((prev) => {
      const nextPayload = selectedAssistantMessage?.uiPayload ?? null;
      if (prev === nextPayload) {
        return prev;
      }
      return nextPayload;
    });
  }, [selectedAssistantMessage]);

  useEffect(() => {
    return () => {
      Object.values(orchestrationAbortControllersRef.current).forEach((controller) => controller.abort());
      orchestrationAbortControllersRef.current = {};
    };
  }, []);

  const hasCompletedAssistantResponse = Boolean(
    selectedAssistantMessage &&
      !selectedAssistantMessage.isThinking &&
      (selectedAssistantMessage.text?.trim()?.length ?? 0) > 0,
  );

  const latestReasoning = useMemo(
    () => selectedAssistantMessage?.reasoningSteps ?? [],
    [selectedAssistantMessage],
  );
  const latestReferences = selectedAssistantMessage?.references ?? [];
  const visibleReferences = isOrchestrationView ? [] : latestReferences;
  const panelActive = !isOrchestrationView && hasCompletedAssistantResponse;
  const knowledgeGraphData = useMemo<KnowledgeGraphData | null>(
    () => uiPayload?.knowledge_graph ?? uiPayload?.knowledgeGraph ?? null,
    [uiPayload],
  );
  const structurePanelData = useMemo<StructurePanelData | null>(() => {
    const direct = uiPayload?.structure_panel ?? uiPayload?.structurePanel ?? null;
    const visualization = uiPayload?.visualization;
    if (direct?.pdbUrl || !visualization) {
      return direct;
    }
    const vizUrl = visualization?.pdb_url ?? visualization?.pdbUrl;
    if (!vizUrl) {
      return direct;
    }
    return {
      ...direct,
      pdbUrl: vizUrl,
      pdbId: visualization?.pdb_id ?? visualization?.pdbId ?? direct?.pdbId,
      target: direct?.target ?? visualization?.target,
      compound: direct?.compound ?? visualization?.compound,
    };
  }, [uiPayload]);
  const toolUsageGroups = useMemo(() => {
    type LogWithPosition = ToolLog & { __position: number };
    const rawLogs = latestReasoning
      .flatMap((step) => step.toolLogs ?? [])
      .filter((log): log is ToolLog => Boolean(log));
    if (rawLogs.length === 0) {
      return [];
    }
    const dedupedLogs: LogWithPosition[] = [];
    const seenKeys = new Set<string>();
    rawLogs.forEach((log, index) => {
      const dedupeKey =
        log.id || `${log.stageKey ?? "_"}-${log.name ?? log.rawToolName ?? "tool"}-${log.timestamp?.toISOString() ?? index}`;
      if (seenKeys.has(dedupeKey)) {
        return;
      }
      seenKeys.add(dedupeKey);
      dedupedLogs.push({ ...log, __position: index });
    });
    if (dedupedLogs.length === 0) {
      return [];
    }
    let fallbackOrder = STAGE_FLOW.length;
    const grouped = new Map<
      string,
      {
        meta: { stageKey: string; code: string; title: string; order: number };
        logs: LogWithPosition[];
      }
    >();

    dedupedLogs.forEach((log) => {
      const stageKey = log.stageKey || "__unknown_stage__";
      const knownMeta = STAGE_PRIORITY_MAP.get(stageKey);
      const fallbackTitle = log.stageTitle || log.serverName || "기타 단계";
      const fallbackCode = (log.stageTitle || stageKey || "STEP").slice(0, 2).toUpperCase();
      const meta = knownMeta ?? {
        stageKey,
        code: fallbackCode,
        title: fallbackTitle,
        order: fallbackOrder++,
      };
      const existing = grouped.get(stageKey) ?? { meta, logs: [] };
      existing.logs.push(log);
      grouped.set(stageKey, existing);
    });

    return Array.from(grouped.values())
      .map((entry) => {
        const sortedLogs = [...entry.logs]
          .sort((a, b) => {
            const timeA = a.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const timeB = b.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
            if (timeA !== timeB) {
              return timeA - timeB;
            }
            return a.__position - b.__position;
          })
          .map(({ __position, ...rest }) => rest);
        const firstTimestamp = sortedLogs[0]?.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return {
          stageKey: entry.meta.stageKey,
          code: entry.meta.code,
          title: entry.meta.title,
          logs: sortedLogs,
          order: entry.meta.order,
          firstTimestamp,
        };
      })
      .sort((a, b) => {
        if (a.firstTimestamp !== b.firstTimestamp) {
          return a.firstTimestamp - b.firstTimestamp;
        }
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.stageKey.localeCompare(b.stageKey);
      })
      .map(({ order, firstTimestamp, ...rest }) => rest);
  }, [latestReasoning]);
  const streamingStatusLabel = isOrchestrationView
    ? isOrchestrationStreaming
      ? "Orchestrating"
      : "Idle"
    : isLoading
    ? "Streaming"
    : isLoadingHistory
    ? "Loading history"
    : "Idle";
  const showHeroLanding = !isOrchestrationView && messages.length === 0 && !isLoadingHistory && !isLoadingSessions;
  const hasSelectedTargets = selectedMcpList.length > 0;
  const isChatInputDisabled = isOrchestrationView
    ? isOrchestrationStreaming || !hasSelectedTargets
    : isLoading || isLoadingHistory;
  const chatInputPlaceholder = isOrchestrationView
    ? hasSelectedTargets
      ? `${selectedMcpSummary} 서버${selectedMcpList.length > 1 ? "들" : ""}에 전달할 명령을 입력하세요...`
      : "오케스트레이션을 실행할 MCP 서버를 먼저 선택하세요."
    : undefined;
  const headerTitle = isOrchestrationView ? "MCP Orchestration Console" : "Research Copilot Workspace";
  const headerKicker = isOrchestrationView ? "MCP Orchestration Mode" : "JW MCP Command Center";

  const orchestrationPanel = (
    <div className="flex h-full flex-col gap-4 pb-28">
      <div className="rounded-3xl border border-cyan-500/30 bg-slate-950/70 p-4 shadow-[0_25px_80px_-60px_rgba(14,165,233,0.8)]">
        {hasSelectedTargets ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/80">Selected Targets</p>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  {selectedMcpList.length === 1
                    ? normalizeMcpLabel(selectedMcpList[0].name)
                    : `${selectedMcpList.length} MCP Servers Chosen`}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">{selectedMcpSummary}</p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200">
                <span className="text-[10px] uppercase tracking-[0.25em] text-slate-500">MAX 4</span>
                <span className="rounded-lg bg-slate-950/30 px-2 py-0.5 text-sm font-semibold text-cyan-200">
                  {selectedMcpList.length}/4
                </span>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {selectedMcpList.map((server) => {
                const statusColor = server.is_active ? "bg-emerald-400" : "bg-amber-400";
                return (
                  <div
                    key={server.name}
                    className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2 font-medium text-xs truncate">
                        <Bot className="h-3 w-3 text-cyan-300" />
                        {normalizeMcpLabel(server.name)}
                      </div>
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusColor)} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{server.tool_count ?? 0} tools</span>
                      <span className="font-mono opacity-50 truncate ml-2">{server.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-slate-300">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">No Target Selected</p>
            <h2 className="text-xl font-semibold text-white">왼쪽 MCP 패널에서 오케스트레이션 타겟을 선택하세요.</h2>
            <p className="text-xs text-slate-400">
              서버를 선택하면 실시간으로 상태와 연결된 도구 정보를 확인하고, 아래 입력창을 통해 해당 서버에 명령을 전달할 수 있습니다.
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/60 flex flex-col">
        {/* Header with Tabs */}
        <div className="border-b border-slate-800/70 px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Execution Timeline</p>
              <p className="text-xs text-slate-400">선택한 MCP 서버에 전송한 명령 기록입니다.</p>
            </div>
            <button
              type="button"
              onClick={handleClearOrchestrationRuns}
              disabled={orchestrationRuns.length === 0 && orchestrationMessages.length === 0}
              className="rounded-lg border border-slate-800/70 px-2 py-1 text-[10px] text-slate-400 transition hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              기록 초기화
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2 border-t border-slate-800/50 pt-2">
            <button
              onClick={() => setOrchestrationTab("chat")}
              className={cn(
                "px-2 py-1 text-[10px] font-medium rounded-md transition border",
                orchestrationTab === "chat"
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-800/70 text-slate-400 hover:text-slate-200"
              )}
            >
              💬 대화 ({orchestrationMessages.length})
            </button>
            <button
              onClick={() => setOrchestrationTab("timeline")}
              className={cn(
                "px-2 py-1 text-[10px] font-medium rounded-md transition border",
                orchestrationTab === "timeline"
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-800/70 text-slate-400 hover:text-slate-200"
              )}
            >
              📋 타임라인 ({orchestrationRuns.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Chat Tab */}
          {orchestrationTab === "chat" && (
            <>
              {orchestrationMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full border border-slate-800/80 bg-slate-900/80 p-4 text-cyan-300">
                    <Bot className="h-6 w-6" />
                  </div>
                  <p className="text-base font-medium text-slate-100">대화가 없습니다.</p>
                  <p className="max-w-sm text-sm text-slate-400">
                    상단에서 MCP 서버를 선택하고 아래 입력창에 명령을 입력하면, 대화가 여기에 표시됩니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orchestrationMessages.map((msg) => (
                    <OrchestrationChatMessage key={msg.id} message={msg} />
                  ))}
                  <div ref={orchestrationMessagesEndRef} />
                </div>
              )}
            </>
          )}

          {/* Timeline Tab */}
          {orchestrationTab === "timeline" && (
            <>
              {orchestrationRuns.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full border border-slate-800/80 bg-slate-900/80 p-4 text-cyan-300">
                    <Bot className="h-6 w-6" />
                  </div>
                  <p className="text-base font-medium text-slate-100">실행한 명령이 없습니다.</p>
                  <p className="max-w-sm text-sm text-slate-400">
                    상단에서 MCP 서버를 선택하고 아래 입력창에 명령을 입력하면, 실시간으로 실행 로그와 결과가 여기에 표시됩니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orchestrationRuns.map((run) => (
                    <OrchestrationRunCard key={run.id} run={run} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <SidebarProvider className="command-center-theme bg-slate-950 text-slate-100">
      <div className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100">
        <AppSidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onLogout={handleLogout}
          onNavigateHome={handleNavigateHome}
          activeWorkspace={activeWorkspace}
          onChangeWorkspace={handleChangeWorkspace}
          mcpServers={mcpServers}
          isLoadingMcp={isLoadingMcp}
          onRefreshMcp={refreshMcpStatuses}
          selectedMcpIds={selectedMcpIds}
          onSelectMcp={handleSelectMcpServer}
        />

        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="flex flex-1 flex-col border-x border-slate-800/70 bg-slate-950/60 backdrop-blur-xl">
            <header className="border-b border-slate-800/60 bg-slate-900/60/80 backdrop-blur-lg">
              <div className="flex flex-wrap items-center gap-4 px-6 py-4">
                <SidebarTrigger className="text-slate-200 hover:text-white" />
                <div className="space-y-0.5">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/70">{headerKicker}</p>
                  <h1 className="text-xl font-semibold text-slate-50">{headerTitle}</h1>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  {!isOrchestrationView && activeConversation && (
                    <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
                      {activeConversation.title}
                    </Badge>
                  )}
                  {isOrchestrationView && hasSelectedTargets && (
                    <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
                      {selectedMcpSummary}
                    </Badge>
                  )}
                  <Badge variant="outline" className="ml-auto border-slate-700/70 bg-slate-800 text-slate-200">
                    {streamingStatusLabel}
                  </Badge>
                  {!isOrchestrationView && visibleReferences.length > 0 && (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                      {visibleReferences.length} Reference{visibleReferences.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
            </header>

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden px-2 py-4 sm:px-6 lg:px-10">
                {isOrchestrationView ? (
                  orchestrationPanel
                ) : showHeroLanding ? (
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
                  <ChatContainer
                    messages={messages}
                    isLoading={isLoadingHistory}
                    selectedMessageId={selectedAssistantId}
                    onSelectMessage={handleSelectAssistantMessage}
                  />
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 z-10 bg-transparent px-3 pb-8 pt-2 sm:px-6 lg:px-10">
                <ChatInput
                  onSendMessage={isOrchestrationView ? handleSendOrchestrationMessage : handleSendMessage}
                  disabled={isChatInputDisabled}
                  placeholder={chatInputPlaceholder}
                />
              </div>
            </div>
          </div>
          {!isOrchestrationView && (
            <aside className="hidden w-full max-w-sm flex-col gap-5 border-l border-slate-800/70 bg-slate-950/60 p-6 backdrop-blur-xl overflow-y-auto overflow-x-hidden scrollbar-hide xl:flex">
              <section className="mb-2 rounded-2xl border border-cyan-800/60 bg-slate-900/60 p-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-cyan-400">Usage & Cost</span>
                  <div className="mt-1 flex flex-col gap-1 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Total Token</span>
                      <span className="font-semibold text-white">{activeUsageTotals.total_tokens ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Cost</span>
                      <span className="font-semibold text-white">${activeUsageCost.toFixed(6)}</span>
                    </div>
                  </div>
                </div>
              </section>
              <section className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">References</span>
                  <span className="text-xs text-slate-400">{visibleReferences.length}</span>
                </div>
                <ul className="mt-3 space-y-3 text-sm text-slate-300/80">
                  {visibleReferences.slice(0, 4).map((ref, idx) => (
                    <li
                      key={`${ref.fileName}-${idx}`}
                      className="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-3"
                    >
                      <p className="truncate text-sm font-medium text-slate-100">{ref.fileName}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                        <span>Page {ref.page ?? "-"}</span>
                        <span>Position {ref.position ?? "-"}</span>
                      </div>
                    </li>
                  ))}
                  {visibleReferences.length === 0 && (
                    <li className="rounded-xl border border-dashed border-slate-800/70 bg-slate-900/50 px-3 py-4 text-center text-xs text-slate-500">
                      최신 응답에서 참조 문서가 발견되지 않았습니다.
                    </li>
                  )}
                </ul>
              </section>

              <ToolUsagePanel groups={toolUsageGroups} isActive={panelActive} />

              <KnowledgeGraphPanel isActive={panelActive} data={knowledgeGraphData ?? undefined} />

              <ProteinStructurePanel isActive={panelActive} data={structurePanelData ?? undefined} />
            </aside>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;
