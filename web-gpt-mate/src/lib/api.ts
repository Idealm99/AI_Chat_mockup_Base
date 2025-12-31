// Docker 환경에서는 nginx 프록시를 통해 /api 경로로 접근
// 개발 환경에서는 환경 변수 또는 기본값 사용
const API_BASE_URL = (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL || "/api";

type UnknownRecord = Record<string, unknown>;

export type UserInfo = UnknownRecord & {
  id?: string;
};

export interface ChatStreamEvent {
  event: string;
  data: unknown;
}

export interface ChatRequest {
  question: string;
  chatId?: string | null;
  userInfo?: UserInfo | null;
  mode?: "research" | "orchestration";
  targetServer?: string | null;
  targetServers?: string[] | null;  // 여러 MCP 서버 목록
  metadata?: Record<string, unknown> | null;
}

export interface ChatHistoryMessage extends UnknownRecord {
  role?: string;
  content?: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
}

export interface ChatHistoryResponse {
  messages?: ChatHistoryMessage[];
}

export interface ChatSessionSummary {
  chat_id: string;
  title?: string | null;
  last_message?: string | null;
  updated_at?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export interface McpServerStatus {
  name: string;
  status: string;
  is_active: boolean;
  tool_count: number;
  message?: string;
}

export interface McpStatusResponse {
  servers: McpServerStatus[];
}

async function* streamSSE(
  endpoint: string,
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('Response body is not readable');
  }

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6);
            if (jsonStr.trim()) {
              const event = JSON.parse(jsonStr) as ChatStreamEvent;
              yield event;
            }
          } catch (e) {
            console.error('Failed to parse SSE event:', e, line);
          }
        } else if (line.trim() === '' || line.startsWith(':')) {
          continue;
        }
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6);
            if (jsonStr.trim()) {
              const event = JSON.parse(jsonStr) as ChatStreamEvent;
              yield event;
            }
          } catch (e) {
            console.error('Failed to parse SSE event:', e, line);
          }
        }
      }
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') {
      return;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield* streamSSE(`${API_BASE_URL}/chat/stream`, request, signal);
}

export async function* streamChatMultiturn(
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield* streamSSE(`${API_BASE_URL}/chat/multiturn`, request, signal);
}

export async function* streamLangGraphChat(
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield* streamSSE(`${API_BASE_URL}/chat/langgraph`, request, signal);
}

export async function* streamOrchestrationChat(
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield* streamSSE(`${API_BASE_URL}/orchestration/stream`, request, signal);
}

/**
 * 채팅 히스토리 조회 API
 */
export async function getChatHistory(chatId: string, limit = 50): Promise<ChatHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/chat/history/${chatId}?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to get chat history: ${response.status}`);
  }
  return response.json();
}

export async function getChatSessions(limit = 50): Promise<ChatSessionSummary[]> {
  const response = await fetch(`${API_BASE_URL}/chat/sessions?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to get chat sessions: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data.sessions) ? data.sessions : [];
}

/**
 * 채팅 히스토리 삭제 API
 */
export async function deleteChatHistory(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat/history/${chatId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete chat history: ${response.status}`);
  }
}

/**
 * 헬스 체크 API
 */
export async function checkHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return response.json();
}

export async function getMcpStatus(): Promise<McpStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/mcp/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch MCP status: ${response.status}`);
  }
  return response.json();
}

