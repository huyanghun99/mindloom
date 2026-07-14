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

export function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
