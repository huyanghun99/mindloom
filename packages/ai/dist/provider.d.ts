export interface AiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface AiProvider {
    generateText(messages: AiMessage[]): Promise<string>;
    streamText(messages: AiMessage[]): AsyncGenerator<string>;
    embed(text: string): Promise<number[]>;
}
export declare const DEFAULT_EMBEDDING_DIMENSION = 1536;
/**
 * Deterministic embedding vector derived from text content.
 * Used by the MockAiProvider so tests and local development
 * do not depend on a real embedding service.
 */
export declare function deterministicVector(text: string, dimension?: number): number[];
/**
 * Mock provider used by tests and local development.
 * All AI-related automated tests MUST use this provider
 * (per project constraint: no real LLM calls in CI).
 */
export declare class MockAiProvider implements AiProvider {
    private readonly dimension;
    constructor(dimension?: number);
    generateText(messages: AiMessage[]): Promise<string>;
    streamText(messages: AiMessage[]): AsyncGenerator<string>;
    embed(text: string): Promise<number[]>;
}
export declare function vectorToSqlLiteral(vector: number[]): string;
