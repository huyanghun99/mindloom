import { env } from '../env';

// Re-export everything from the shared AI package so existing imports
// (`MockAiProvider`, `AiProvider`, `AiMessage`, `vectorToSqlLiteral`,
// `deterministicVector`) keep working inside the server.
export * from '@mindloom/ai';
import { MockAiProvider, OpenAICompatibleProvider, type AiProvider } from '@mindloom/ai';

/**
 * Factory that returns the active AI provider based on the runtime
 * environment. Tests and local development use the deterministic
 * MockAiProvider. When `AI_DRIVER` is `openai` / `openai-compatible` and
 * credentials are present, it talks to the configured OpenAI-compatible
 * Chat + Embeddings endpoints (the embedding endpoint may be separate).
 *
 * Per project constraint, all automated tests MUST use the mock
 * provider - do not call real LLMs from tests. We also force the mock
 * whenever `NODE_ENV === 'test'` so the test suite never reaches the network.
 */
export function createAiProvider(): AiProvider {
  if (env.AI_DRIVER === 'mock' || process.env.NODE_ENV === 'test') {
    return new MockAiProvider(env.EMBEDDING_DIMENSION);
  }

  const embeddingBaseUrl = env.EMBEDDING_BASE_URL || env.OPENAI_API_URL;
  const embeddingApiKey = env.EMBEDDING_API_KEY || env.OPENAI_API_KEY;

  if (!env.OPENAI_API_KEY || !embeddingApiKey) {
    console.warn('[ai] 未配置 API Key，回退到 Mock provider（AI_DRIVER=%s）', env.AI_DRIVER);
    return new MockAiProvider(env.EMBEDDING_DIMENSION);
  }

  return new OpenAICompatibleProvider({
    baseUrl: env.OPENAI_API_URL,
    apiKey: env.OPENAI_API_KEY,
    completionModel: env.AI_COMPLETION_MODEL,
    embeddingBaseUrl,
    embeddingApiKey,
    embeddingModel: env.AI_EMBEDDING_MODEL,
    embeddingDimension: env.EMBEDDING_DIMENSION
  });
}
