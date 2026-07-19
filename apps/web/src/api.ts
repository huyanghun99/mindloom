import type { StreamRagEvent, AiProfile } from '@mindloom/shared';
import type { WikiSuggestion } from './types';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options
  });
  if (!res.ok) {
    let message = res.statusText;
    let data: unknown = null;
    try {
      data = await res.json();
      message = (data as { error?: string; message?: string })?.error
        ?? (data as { error?: string; message?: string })?.message
        ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status, data);
  }
  return res.json() as Promise<T>;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
  return api<T>(path, { method: 'DELETE' });
}

/* ----------------------------------------------- streaming RAG (SSE) ----- */

/**
 * POST /api/rag/ask/stream and consume the Server-Sent-Events stream.
 * Events are delivered in this order: sources -> token* -> citation* -> done | error.
 * The caller renders provenance first, then the progressively streamed answer.
 * Returns the persisted session id (from the final `done` event).
 */
export async function streamRag(
  body: { workspaceId: string; spaceId?: string; query: string; limit?: number; extendedThinking?: boolean; pageId?: string },
  onEvent: (e: StreamRagEvent) => void,
  signal?: AbortSignal
): Promise<{ sessionId?: string }> {
  const res = await fetch('/api/rag/ask/stream', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 5, extendedThinking: false, ...body }),
    signal
  });
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      const d = (await res.json()) as { error?: string };
      message = d.error ?? message;
    } catch {
      /* non-JSON error body */
    }
    onEvent({ type: 'error', message });
    return {};
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sessionId: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const ev = JSON.parse(payload) as StreamRagEvent;
        if (ev.type === 'done') sessionId = ev.sessionId;
        onEvent(ev);
      } catch {
        /* ignore malformed keep-alive chunks */
      }
    }
  }
  return { sessionId };
}

/* ------------------------------------------------- AI panel helpers ----- */

export function getAiProfile(pageId: string): Promise<{ profile: AiProfile | null }> {
  return api(`/api/pages/${pageId}/ai-profile`);
}

export function getPageSuggestions(pageId: string): Promise<{ suggestions: WikiSuggestion[] }> {
  return api(`/api/pages/${pageId}/suggestions`);
}

export function undoSuggestion(id: string): Promise<{ suggestion: unknown }> {
  return post(`/api/llm-wiki/suggestions/${id}/undo`, {});
}

export function undoTopic(id: string): Promise<{ topic: unknown }> {
  return post(`/api/llm-wiki/topics/${id}/undo`, {});
}
