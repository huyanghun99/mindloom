export type Id = string;

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type SpaceRole = 'admin' | 'writer' | 'reader';
export type PageStatus = 'normal' | 'archived' | 'deleted';
export type LlmProcessStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'ignored';
export type TopicStatus = 'suggested' | 'accepted' | 'user_edited' | 'stale' | 'archived';
export type SpaceAiPrivacyPolicy = 'inherit_workspace' | 'cloud_allowed' | 'local_only' | 'disabled';
export type AiDriver = 'mock' | 'openai' | 'openai-compatible' | 'ollama' | 'gemini';

export interface Citation {
  pageId?: string;
  topicId?: string;
  chunkId?: string;
  title: string;
  excerpt: string;
  score?: number;
}

export interface RagAnswer {
  answer: string;
  citations: Citation[];
  usedExtendedThinking: boolean;
}

export interface HybridSearchResult {
  id: string;
  pageId: string;
  topicId?: string;
  title: string;
  content: string;
  source: 'bm25' | 'vector' | 'both';
  score: number;
  rank?: number;
}

export interface KnowledgeEdgeEvidence {
  sourcePageId?: string;
  sourceChunkId?: string;
  excerpt: string;
  generatedBy: 'ai' | 'user' | 'import';
  promptVersion?: string;
  confidence?: number;
}
