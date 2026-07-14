export * from '@mindloom/ai';
import { type AiProvider } from '@mindloom/ai';
/**
 * Factory that returns the active AI provider based on the runtime
 * environment. Tests and local development use the deterministic
 * MockAiProvider. Real providers (OpenAI, Ollama, Gemini) can be
 * implemented behind the same AiProvider interface in the future.
 *
 * Per project constraint, all automated tests MUST use the mock
 * provider - do not call real LLMs from tests.
 */
export declare function createAiProvider(): AiProvider;
