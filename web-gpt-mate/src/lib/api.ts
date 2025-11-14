// Docker 환경에서는 nginx 프록시를 통해 /api 경로로 접근
// 개발 환경에서는 환경 변수 또는 기본값 사용
const API_BASE_URL = (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL || '/api';

export interface ChatStreamEvent {
  event: string;
  data: any;
}

export interface ChatRequest {
  question: string;
  chatId?: string | null;
  userInfo?: {
    id?: string;
    [key: string]: any;
  } | null;
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
              const event: ChatStreamEvent = JSON.parse(jsonStr);
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
              const event: ChatStreamEvent = JSON.parse(jsonStr);
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

/**
 * 채팅 히스토리 조회 API
 */
export async function getChatHistory(chatId: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/chat/history/${chatId}`);
  if (!response.ok) {
    throw new Error(`Failed to get chat history: ${response.status}`);
  }
  return response.json();
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

