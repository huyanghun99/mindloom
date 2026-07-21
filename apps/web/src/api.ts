import type { StreamRagEvent, AiProfile } from '@mindloom/shared';
import type { WikiSuggestion, PageDetail, TopicCandidate } from './types';

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

/* ----------------------------------- candidates (Phase 2) ---------------- */

export function getCandidates(spaceId: string, pageId?: string): Promise<{ candidates: TopicCandidate[] }> {
  const q = pageId ? `?spaceId=${spaceId}&pageId=${pageId}` : `?spaceId=${spaceId}`;
  return api(`/api/llm-wiki/candidates${q}`);
}

export function promoteCandidate(id: string): Promise<{ topic: unknown }> {
  return post(`/api/llm-wiki/candidates/${id}/promote`, {});
}

export function dismissCandidate(id: string): Promise<{ ok: boolean }> {
  return post(`/api/llm-wiki/candidates/${id}/dismiss`, {});
}

/* ----------------------------------- consolidation (Phase 3) ------------- */

export function consolidateSpace(spaceId: string): Promise<{ ok: boolean; createdTopics: number; mergeSuggestions: number }> {
  return post(`/api/llm-wiki/spaces/${spaceId}/consolidate`, {});
}

/* ----------------------------------- Phase 4: refresh / merge / split ------- */

import type { TopicRefreshDiff, TopicOperation } from './types';

/** Generate an itemised refresh diff for a (stale) Topic without overwriting it. */
export function generateRefreshDiff(topicId: string): Promise<{ ok: boolean; diff: TopicRefreshDiff }> {
  return post(`/api/llm-wiki/topics/${topicId}/refresh-diff`, {});
}

/** Fetch the stored refresh diff (if any) for a Topic. */
export function getRefreshDiff(topicId: string): Promise<{ diff: TopicRefreshDiff | null }> {
  return api(`/api/llm-wiki/topics/${topicId}/refresh-diff`);
}

/** Apply selected items of a refresh diff to a Topic, item-by-item. */
export function applyRefreshDiff(topicId: string, itemIndexes: number[]): Promise<{ ok: boolean; applied: number; topic: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/apply-refresh`, { itemIndexes });
}

/** Merge a Topic INTO another (the merged topic becomes a redirect stub). */
export function mergeTopic(topicId: string, targetTopicId: string): Promise<{ ok: boolean; operationId: string; survivor: unknown; merged: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/merge`, { targetTopicId });
}

/** Split selected keyPoints of a Topic into a new Topic. */
export function splitTopic(topicId: string, title: string, keyPointIds: string[]): Promise<{ ok: boolean; operationId: string; topic: unknown; parent: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/split`, { title, keyPointIds });
}

/** List reversible operations (merge / split) for a Topic. */
export function getTopicOperations(topicId: string): Promise<{ operations: TopicOperation[] }> {
  return api(`/api/llm-wiki/topics/${topicId}/operations`);
}

/** Undo a recorded merge / split operation. */
export function undoTopicOperation(opId: string): Promise<{ ok: boolean }> {
  return post(`/api/llm-wiki/topics/operations/${opId}/undo`, {});
}

/* ----------------------------------- Phase 5: activity / lifecycle --------- */

import type { ActivityStats, LifecycleSuggestion } from './types';

/** Record a real user activity event (search click, citation open, ...). */
export function recordActivity(body: {
  spaceId: string;
  entityType: 'topic' | 'page';
  entityId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  return post(`/api/llm-wiki/activity`, body);
}

/** Fetch rolled-up activity stats + recent events for a Topic. */
export function getTopicActivity(topicId: string): Promise<{ stats: ActivityStats | null; events: unknown[] }> {
  return api(`/api/llm-wiki/topics/${topicId}/activity`);
}

/** Archive a Topic (deliberate user action — the archive center). */
export function archiveTopic(topicId: string, reason?: string): Promise<{ topic: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/archive`, { reason });
}

/** Reactivate an archived Topic (recovery path). */
export function reactivateTopic(topicId: string): Promise<{ topic: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/reactivate`, {});
}

/** Run the lifecycle evaluation job for a Space (or whole workspace). */
export function evaluateLifecycle(body: { workspaceId?: string; spaceId?: string }): Promise<{ ok: boolean; suggestions: LifecycleSuggestion[] }> {
  return post(`/api/llm-wiki/lifecycle/evaluate`, body);
}

/** List pending lifecycle Suggestions for a Space. */
export function getLifecycleSuggestions(spaceId: string): Promise<{ suggestions: LifecycleSuggestion[] }> {
  return api(`/api/llm-wiki/lifecycle/suggestions?spaceId=${spaceId}`);
}

/* ----------------------------------- Phase 6: closure / promotion --------- */

import type { ClosurePackage } from './types';

/** Generate + store a project closure package (archive wizard step). */
export function generateClosure(spaceId: string): Promise<{ ok: boolean; closure: ClosurePackage }> {
  return post(`/api/llm-wiki/projects/${spaceId}/closure`, {});
}

/** Fetch the stored closure package for a project. */
export function getClosure(spaceId: string): Promise<{ closure: ClosurePackage | null }> {
  return api(`/api/llm-wiki/projects/${spaceId}/closure`);
}

/** Confirm a recommended promotion — derive a Topic into the target Space. */
export function promoteClosureTopic(
  spaceId: string,
  topicId: string,
  targetSpaceId: string,
  newTitle?: string
): Promise<{ ok: boolean; topicId: string; operationId: string; topic: unknown }> {
  return post(`/api/llm-wiki/projects/${spaceId}/closure/promote`, { topicId, targetSpaceId, newTitle });
}

/** Archive the project Space (final step of the archive wizard). */
export function archiveProject(spaceId: string): Promise<{ space: unknown }> {
  return post(`/api/llm-wiki/projects/${spaceId}/archive`, {});
}

/** Derive (copy) a Topic into another Space; original history is preserved. */
export function deriveTopic(
  topicId: string,
  targetSpaceId: string,
  newTitle?: string
): Promise<{ ok: boolean; topicId: string; operationId: string; topic: unknown }> {
  return post(`/api/llm-wiki/topics/${topicId}/derive`, { targetSpaceId, newTitle });
}

/* ----------------------------------- tag / inbox helpers (Phase 4) -------- */

/** Persist the user-managed tag list on a page's AI profile. */
export function updatePageTags(pageId: string, tags: string[]): Promise<{ ok: boolean; tags: string[] }> {
  return api(`/api/pages/${pageId}/ai-profile`, { method: 'PATCH', body: JSON.stringify({ tags }) });
}

/** Dismiss a page from the LLM inbox (mark as not-to-be-processed). */
export function skipPageLlm(pageId: string): Promise<{ ok: boolean }> {
  return post(`/api/pages/${pageId}/skip-llm`, {});
}

/* ------------------------------- page ops (Phase 6) --------------------- */

/** Rename a page (lightweight — no content-version bump). */
export function renamePage(pageId: string, title: string): Promise<{ page: PageDetail }> {
  return put(`/api/pages/${pageId}`, { title });
}

/** Move / reorder a page within the tree (lightweight — see backend). */
export function movePage(
  pageId: string,
  body: { parentPageId?: string | null; position?: number }
): Promise<{ page: PageDetail }> {
  return put(`/api/pages/${pageId}`, body);
}

/** Duplicate a page into a new page with the same content. */
export function copyPage(input: {
  spaceId: string;
  title: string;
  contentJson: unknown;
  textContent: string;
}): Promise<{ page: PageDetail }> {
  return post(`/api/pages`, input);
}
