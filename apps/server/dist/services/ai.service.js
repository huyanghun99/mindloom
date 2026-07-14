import { env } from '../env';
// Re-export everything from the shared AI package so existing imports
// (`MockAiProvider`, `AiProvider`, `AiMessage`, `vectorToSqlLiteral`,
// `deterministicVector`) keep working inside the server.
export * from '@mindloom/ai';
import { MockAiProvider } from '@mindloom/ai';
/**
 * Factory that returns the active AI provider based on the runtime
 * environment. Tests and local development use the deterministic
 * MockAiProvider. Real providers (OpenAI, Ollama, Gemini) can be
 * implemented behind the same AiProvider interface in the future.
 *
 * Per project constraint, all automated tests MUST use the mock
 * provider - do not call real LLMs from tests.
 */
export function createAiProvider() {
    // AI_DRIVER is currently validated in env.ts but only the mock
    // provider is implemented in this starter. Other drivers fall back
    // to the mock so the server can still boot without credentials.
    return new MockAiProvider(env.EMBEDDING_DIMENSION);
}
