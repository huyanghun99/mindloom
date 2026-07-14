import { env } from '../env';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  generateText(messages: AiMessage[]): Promise<string>;
  streamText(messages: AiMessage[]): AsyncGenerator<string>;
  embed(text: string): Promise<number[]>;
}

function deterministicVector(text: string, dimension = env.EMBEDDING_DIMENSION): number[] {
  const out = new Array<number>(dimension).fill(0);
  for (let i = 0; i < text.length; i++) {
    const idx = i % dimension;
    out[idx] += ((text.charCodeAt(i) % 97) / 97) - 0.5;
  }
  const norm = Math.sqrt(out.reduce((acc, n) => acc + n * n, 0)) || 1;
  return out.map((n) => Number((n / norm).toFixed(6)));
}

export class MockAiProvider implements AiProvider {
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
    return deterministicVector(text);
  }
}

export function createAiProvider(): AiProvider {
  // Production providers can be implemented behind this interface.
  // Tests and default local development use deterministic mock behavior.
  return new MockAiProvider();
}

export function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
