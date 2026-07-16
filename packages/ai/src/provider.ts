export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  generateText(messages: AiMessage[]): Promise<string>;
  streamText(messages: AiMessage[]): AsyncGenerator<string>;
  embed(text: string): Promise<number[]>;
}

export const DEFAULT_EMBEDDING_DIMENSION = 1536;

/**
 * Deterministic embedding vector derived from text content.
 * Used by the MockAiProvider so tests and local development
 * do not depend on a real embedding service.
 */
export function deterministicVector(text: string, dimension: number = DEFAULT_EMBEDDING_DIMENSION): number[] {
  const out = new Array<number>(dimension).fill(0);
  for (let i = 0; i < text.length; i++) {
    const idx = i % dimension;
    out[idx] += ((text.charCodeAt(i) % 97) / 97) - 0.5;
  }
  const norm = Math.sqrt(out.reduce((acc, n) => acc + n * n, 0)) || 1;
  return out.map((n) => Number((n / norm).toFixed(6)));
}

/**
 * Mock provider used by tests and local development.
 * All AI-related automated tests MUST use this provider
 * (per project constraint: no real LLM calls in CI).
 */
export class MockAiProvider implements AiProvider {
  constructor(private readonly dimension: number = DEFAULT_EMBEDDING_DIMENSION) {}

  async generateText(messages: AiMessage[]): Promise<string> {
    const last = messages[messages.length - 1]?.content ?? '';
    return `Mock answer based on local context. Query: ${last.slice(0, 240)}`;
  }

  async *streamText(messages: AiMessage[]): AsyncGenerator<string> {
    const text = await this.generateText(messages);
    for (const part of text.match(/.{1,32}/g) ?? []) {
      yield part;
    }
  }

  async embed(text: string): Promise<number[]> {
    return deterministicVector(text, this.dimension);
  }
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  completionModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingDimension: number;
}

/**
 * Provider that talks to any OpenAI-compatible Chat Completions + Embeddings
 * HTTP API (e.g. OpenAI, LongCat, Qwen embeddings via ModelScope, Ollama, etc.).
 * The embedding endpoint may differ from the completion endpoint, which is why
 * `embeddingBaseUrl` / `embeddingApiKey` are separate from the chat settings.
 */
export class OpenAICompatibleProvider implements AiProvider {
  constructor(private readonly opts: OpenAICompatibleOptions) {}

  private headers(apiKey: string): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  async generateText(messages: AiMessage[]): Promise<string> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: this.headers(this.opts.apiKey),
      body: JSON.stringify({ model: this.opts.completionModel, messages, temperature: 0.3 })
    });
    if (!res.ok) {
      throw new Error(`LLM 请求失败 (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }

  async *streamText(messages: AiMessage[]): AsyncGenerator<string> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: this.headers(this.opts.apiKey),
      body: JSON.stringify({ model: this.opts.completionModel, messages, temperature: 0.3, stream: true })
    });
    if (!res.ok) {
      throw new Error(`LLM 流式请求失败 (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          /* ignore keep-alive / partial chunks */
        }
      }
    }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.opts.embeddingBaseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: this.headers(this.opts.embeddingApiKey),
      body: JSON.stringify({
        model: this.opts.embeddingModel,
        input: text,
        dimensions: this.opts.embeddingDimension,
        // Required by several OpenAI-compatible gateways (e.g. ModelScope
        // Qwen embeddings); harmless for providers that ignore it.
        encoding_format: 'float'
      })
    });
    if (!res.ok) {
      throw new Error(`向量化请求失败 (${res.status}): ${await res.text().catch(() => res.statusText)}`);
    }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding as number[] | undefined;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error('向量化响应缺少 embedding 向量');
    }
    return normalizeVector(vec, this.opts.embeddingDimension);
  }
}

/** Ensure the returned vector exactly matches the configured DB dimension. */
function normalizeVector(vec: number[], dimension: number): number[] {
  if (vec.length === dimension) return vec;
  if (vec.length > dimension) return vec.slice(0, dimension);
  const out = vec.slice();
  while (out.length < dimension) out.push(0);
  return out;
}

export function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
