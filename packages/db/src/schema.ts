import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from 'drizzle-orm/pg-core';

export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member']);
export const spaceRoleEnum = pgEnum('space_role', ['admin', 'writer', 'reader']);
export const pageStatusEnum = pgEnum('page_status', ['normal', 'archived', 'deleted']);
export const llmProcessStatusEnum = pgEnum('llm_process_status', ['pending', 'processing', 'processed', 'failed', 'ignored']);
export const topicStatusEnum = pgEnum('topic_status', ['suggested', 'accepted', 'user_edited', 'stale', 'archived']);
export const suggestionStatusEnum = pgEnum('suggestion_status', ['pending', 'accepted', 'ignored', 'failed']);
export const suggestionRiskEnum = pgEnum('suggestion_risk', ['low', 'medium', 'high']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export const aiPrivacyEnum = pgEnum('space_ai_privacy_policy', ['inherit_workspace', 'cloud_allowed', 'local_only', 'disabled']);
export const aiConfigScopeEnum = pgEnum('ai_config_scope', ['workspace', 'user']);

// Phase 1 — Space semantics (D1)
export const spaceKindEnum = pgEnum('space_kind', ['project', 'area', 'resource', 'inbox']);
export const spaceLifecycleStatusEnum = pgEnum('space_lifecycle_status', ['active', 'on_hold', 'completed', 'archived']);

// Phase 1 — Topic three-dimension status (D4). The legacy single `status`
// column is preserved for one release cycle; these three orthogonal axes
// replace its overloaded meaning (publication / freshness / lifecycle).
export const topicPublicationStatusEnum = pgEnum('topic_publication_status', ['suggested', 'draft', 'accepted', 'user_edited']);
export const topicFreshnessStatusEnum = pgEnum('topic_freshness_status', ['fresh', 'stale', 'refresh_failed']);
export const topicLifecycleStatusEnum = pgEnum('topic_lifecycle_status', ['active', 'cooling', 'dormant', 'archived']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isInstanceOwner: boolean('is_instance_owner').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  embeddingDimension: integer('embedding_dimension').notNull().default(1536),
  embeddingModel: text('embedding_model').notNull().default('mock-embedding'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
}, (t) => ({
  userIdx: index('idx_sessions_user').on(t.userId)
}));

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceRoleEnum('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }));

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const groupMembers = pgTable('group_members', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' })
}, (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }));

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  aiPrivacyPolicy: aiPrivacyEnum('ai_privacy_policy').notNull().default('inherit_workspace'),
  autoLlmProcessing: boolean('auto_llm_processing').notNull().default(true),
  updatePolicy: text('update_policy').notNull().default('balanced'),
  // Phase 1 (D1): Space kind + lifecycle semantics.
  spaceKind: spaceKindEnum('space_kind').notNull().default('area'),
  lifecycleStatus: spaceLifecycleStatusEnum('lifecycle_status').notNull().default('active'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  targetEndAt: timestamp('target_end_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivePolicy: jsonb('archive_policy').$type<{ mode: 'manual' | 'suggest' | 'auto'; inactiveDays: number; completedGraceDays: number }>().notNull().default({ mode: 'manual', inactiveDays: 180, completedGraceDays: 30 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  workspaceIdx: index('idx_spaces_workspace').on(t.workspaceId)
}));

export const spaceMembers = pgTable('space_members', {
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  role: spaceRoleEnum('role').notNull().default('reader'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  userIdx: index('idx_space_members_user').on(t.userId),
  groupIdx: index('idx_space_members_group').on(t.groupId)
}));

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  parentPageId: uuid('parent_page_id'),
  position: integer('position').notNull().default(0),
  title: text('title').notNull(),
  icon: text('icon'),
  contentJson: jsonb('content_json').$type<unknown>().notNull().default({ type: 'doc', content: [] }),
  textContent: text('text_content').notNull().default(''),
  ftsTokens: text('fts_tokens').notNull().default(''),
  contentVersion: integer('content_version').notNull().default(1),
  status: pageStatusEnum('status').notNull().default('normal'),
  llmProcessStatus: llmProcessStatusEnum('llm_process_status').notNull().default('pending'),
  llmDirtyReason: text('llm_dirty_reason'),
  llmProcessedAt: timestamp('llm_processed_at', { withTimezone: true }),
  wikiErrorMessage: text('wiki_error_message'),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  updatedById: uuid('updated_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  scopeIdx: index('idx_pages_scope').on(t.workspaceId, t.spaceId, t.status),
  llmInboxIdx: index('idx_pages_llm_inbox').on(t.workspaceId, t.spaceId, t.llmProcessStatus),
  parentIdx: index('idx_pages_parent').on(t.parentPageId)
}));

export const pageRevisions = pgTable('page_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  contentVersion: integer('content_version').notNull(),
  title: text('title').notNull(),
  contentJson: jsonb('content_json').$type<unknown>().notNull(),
  textContent: text('text_content').notNull(),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ pageVersionIdx: uniqueIndex('uidx_page_revisions_page_version').on(t.pageId, t.contentVersion) }));

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id'),
  chunkIndex: integer('chunk_index').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  ftsTokens: text('fts_tokens').notNull().default(''),
  embedding: vector('embedding', { dimensions: 1536 }),
  embeddingModel: text('embedding_model').notNull().default('mock-embedding'),
  embeddingDimension: integer('embedding_dimension').notNull().default(1536),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  scopeIdx: index('idx_chunks_scope').on(t.workspaceId, t.spaceId),
  pageIdx: index('idx_chunks_page').on(t.pageId),
  embeddingIdx: index('idx_chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops'))
}));

export const pageAiProfiles = pgTable('page_ai_profiles', {
  pageId: uuid('page_id').primaryKey().references(() => pages.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  summary: text('summary').notNull().default(''),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  entities: jsonb('entities').$type<string[]>().notNull().default([]),
  model: text('model').notNull().default('mock'),
  promptVersion: text('prompt_version').notNull().default('v1'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const wikiTopics = pgTable('wiki_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  contentJson: jsonb('content_json').$type<unknown>().notNull().default({ type: 'doc', content: [] }),
  textContent: text('text_content').notNull().default(''),
  status: topicStatusEnum('status').notNull().default('suggested'),
  source: text('source').notNull().default('ai_generated'),
  aiSummary: text('ai_summary').notNull().default(''),
  aiVersion: text('ai_version').notNull().default('v1'),
  userEditedAt: timestamp('user_edited_at', { withTimezone: true }),
  lastAiRefreshAt: timestamp('last_ai_refresh_at', { withTimezone: true }),
  updatePolicy: text('update_policy').notNull().default('suggest_only'),
  // Phase 1 (D4): three orthogonal status axes replacing the overloaded `status`.
  publicationStatus: topicPublicationStatusEnum('publication_status').notNull().default('suggested'),
  freshnessStatus: topicFreshnessStatusEnum('freshness_status').notNull().default('fresh'),
  lifecycleStatus: topicLifecycleStatusEnum('lifecycle_status').notNull().default('active'),
  lastMeaningfulActivityAt: timestamp('last_meaningful_activity_at', { withTimezone: true }),
  inactiveSince: timestamp('inactive_since', { withTimezone: true }),
  archiveCandidateAt: timestamp('archive_candidate_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: uuid('archived_by_id').references(() => users.id),
  archiveReason: text('archive_reason'),
  // Phase B (B2.3): soft-delete. We never hard-delete a Topic — a delete is an
  // archive with reason 'deleted' so it stays auditable and recoverable. These
  // columns disambiguate a *deleted* archive from a *regular* archive.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  pinned: boolean('pinned').notNull().default(false),
  keepActiveUntil: timestamp('keep_active_until', { withTimezone: true }),
  promotedFromTopicId: uuid('promoted_from_topic_id'),
  originSpaceId: uuid('origin_space_id').references(() => spaces.id, { onDelete: 'set null' }),
  // Phase 3 (D3): TopicSynthesis support. Aliases + normalized title power the
  // clustering job's alias / synonym matching; synthesisVersion pins the schema.
  aliases: text('aliases').array().notNull().default([]),
  normalizedTitle: text('normalized_title'),
  synthesisVersion: text('synthesis_version').notNull().default('topic-synthesis-v1'),
  // Phase 4: merge redirect. When a topic is merged into another, it becomes a
  // redirect stub (lifecycle 'archived') pointing at the surviving topic. This
  // keeps old links working and makes the merge traceable / reversible.
  // NOTE: the FK to wiki_topics(id) is created in migration 0011 via raw SQL to
  // avoid a self-reference cycle in the Drizzle type inference.
  mergedIntoTopicId: uuid('merged_into_topic_id'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  mergedById: uuid('merged_by_id').references(() => users.id),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ scopeIdx: index('idx_topics_scope_status').on(t.workspaceId, t.spaceId, t.status) }));

// Phase 2 (D2): Candidate ↔ Topic decoupling. A processed page produces
// *candidates* (each tied to a supporting chunk), NOT formal wiki_topics.
// Formal Topics are created later by promotion / Phase 3 clustering, so a
// single short page never spawns multiple published Topics.
export const topicCandidates = pgTable('topic_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  // Candidate references the chunk that supports it (gate: "Candidate 有 Chunk 引用").
  chunkId: uuid('chunk_id').references(() => documentChunks.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  // Structured Page Profile snapshot for this candidate (summary/tags/keywords/entities).
  profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('candidate').$type<'candidate' | 'promoted' | 'dismissed'>(),
  promotedTopicId: uuid('promoted_topic_id').references(() => wikiTopics.id, { onDelete: 'set null' }),
  // Phase B (B1.2): candidate title embedding, pre-computed during page indexing
  // so clustering is embedding-dominated. NULL for legacy candidates (degrades
  // gracefully to normalized-title + same-page grouping).
  titleEmbedding: vector('title_embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  scopeIdx: index('idx_candidates_scope').on(t.workspaceId, t.spaceId),
  pageIdx: index('idx_candidates_page').on(t.pageId),
  chunkIdx: index('idx_candidates_chunk').on(t.chunkId),
  statusIdx: index('idx_candidates_status').on(t.status)
}));

export const topicSources = pgTable('topic_sources', {
  // Phase H (S4): added surrogate id PK so chunk-level provenance rows can
  // coexist for the same (topicId, pageId). Previously the PK was
  // (topicId, pageId), which silently dropped a second chunk via
  // onConflictDoNothing — RAG traceability degraded to page-level.
  id: uuid('id').primaryKey().defaultRandom(),
  topicId: uuid('topic_id').notNull().references(() => wikiTopics.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  chunkId: uuid('chunk_id').references(() => documentChunks.id, { onDelete: 'set null' }),
  // Phase 3 (D5): Chunk-level provenance. All new columns are nullable / have
  // defaults so existing `{ topicId, pageId, chunkId }` inserts keep working.
  sourceContentVersion: integer('source_content_version'),
  sourceType: text('source_type').notNull().default('page'),
  relevanceScore: integer('relevance_score'),
  evidenceExcerpt: text('evidence_excerpt'),
  addedBy: text('added_by').notNull().default('ai'),
  contributionType: text('contribution_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  // Two partial unique indexes preserve the old dedupe semantics while
  // allowing multiple chunks per (topicId, pageId):
  //   - chunkId IS NULL  -> page-level source (legacy / user-added), one per page
  //   - chunkId IS NOT NULL -> chunk-level source, one per chunk
  // Postgres ON CONFLICT DO NOTHING without a target picks the matching
  // partial index automatically, so existing onConflictDoNothing() calls
  // keep working without specifying a target.
  pageLevelUnique: uniqueIndex('uidx_topic_sources_page').on(t.topicId, t.pageId).where(sql`chunk_id IS NULL`),
  chunkLevelUnique: uniqueIndex('uidx_topic_sources_chunk').on(t.topicId, t.pageId, t.chunkId).where(sql`chunk_id IS NOT NULL`)
}));

// Phase B (B1.1): synonym / alias normalisation table. Maps a normalized term
// (e.g. "ml", "机器学习", "机器智能") to a single canonical key (e.g.
// "machinelearning") so that semantically-equivalent topic titles cluster
// together instead of producing many near-duplicate Topics. A NULL workspace_id
// row is a *global* default applied to every workspace.
export const topicSynonyms = pgTable('topic_synonyms', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  normalizedTerm: text('normalized_term').notNull(),
  canonicalTerm: text('canonical_term').notNull(),
  addedById: uuid('added_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ uq: uniqueIndex('uidx_synonyms_ws_term').on(t.workspaceId, t.normalizedTerm) }));

export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull().default('concept'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ nameIdx: uniqueIndex('uidx_entities_scope_name').on(t.workspaceId, t.spaceId, t.name) }));

export const knowledgeEdges = pgTable('knowledge_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  relationType: text('relation_type').notNull(),
  confidence: integer('confidence').notNull().default(50),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('suggested'),
  createdBy: text('created_by').notNull().default('ai'),
  userConfirmedById: uuid('user_confirmed_by_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  scopeStatusIdx: index('idx_edges_scope_status').on(t.workspaceId, t.spaceId, t.status),
  sourceIdx: index('idx_edges_source').on(t.sourceType, t.sourceId),
  targetIdx: index('idx_edges_target').on(t.targetType, t.targetId),
  relationIdx: index('idx_edges_relation').on(t.workspaceId, t.spaceId, t.relationType),
  activeUnique: uniqueIndex('uidx_edges_active_unique').on(t.workspaceId, t.spaceId, t.sourceType, t.sourceId, t.targetType, t.targetId, t.relationType).where(sql`status <> 'deleted'`)
}));

export const llmSuggestions = pgTable('llm_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').references(() => wikiTopics.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  risk: suggestionRiskEnum('risk').notNull().default('low'),
  status: suggestionStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ scopeIdx: index('idx_suggestions_scope_status').on(t.workspaceId, t.spaceId, t.status, t.risk) }));

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
  uploaderId: uuid('uploader_id').notNull().references(() => users.id),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageDriver: text('storage_driver').notNull().default('local'),
  storageKey: text('storage_key').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const aiConfigs = pgTable('ai_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: aiConfigScopeEnum('scope').notNull(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  driver: text('driver').notNull(),
  baseUrl: text('base_url'),
  completionModel: text('completion_model').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDimension: integer('embedding_dimension').notNull().default(1536),
  encryptedApiKey: text('encrypted_api_key'),
  personalOverrideEnabled: boolean('personal_override_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ scopeUnique: uniqueIndex('uidx_ai_config_scope').on(t.scope, t.workspaceId, t.userId) }));

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id'),
  spaceId: uuid('space_id'),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  sourceVersion: integer('source_version'),
  dedupeKey: text('dedupe_key'),
  status: jobStatusEnum('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(100),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  // Phase B (B1.3): async job progress ({ done, total, stage }) written by the
  // worker so the UI can poll instead of blocking on a sync response.
  progress: jsonb('progress').$type<{ done?: number; total?: number; stage?: string }>().notNull().default({}),
  costEstimateTokens: integer('cost_estimate_tokens').default(0),
  actualPromptTokens: integer('actual_prompt_tokens').default(0),
  actualCompletionTokens: integer('actual_completion_tokens').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  runnerIdx: index('idx_jobs_runner').on(t.status, t.runAfter, t.priority),
  scopeIdx: index('idx_jobs_scope').on(t.workspaceId, t.spaceId),
  dedupeIdx: uniqueIndex('uidx_jobs_dedupe').on(t.dedupeKey).where(sql`dedupe_key IS NOT NULL AND status IN ('pending','running')`)
}));

export const apiRateLimitEvents = pgTable('api_rate_limit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id'),
  spaceId: uuid('space_id'),
  userId: uuid('user_id'),
  routeKey: text('route_key').notNull(),
  ipHash: text('ip_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  userWindowIdx: index('idx_rate_user_window').on(t.routeKey, t.userId, t.createdAt),
  spaceWindowIdx: index('idx_rate_space_window').on(t.routeKey, t.spaceId, t.createdAt),
  cleanupIdx: index('idx_rate_cleanup').on(t.createdAt)
}));

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const ragSessions = pgTable('rag_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id'),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  answer: text('answer').notNull().default(''),
  citations: jsonb('citations').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  userIdx: index('idx_rag_sessions_user').on(t.userId, t.createdAt),
  scopeIdx: index('idx_rag_sessions_scope').on(t.workspaceId, t.spaceId)
}));

export const shares = pgTable('shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  shareToken: text('share_token').notNull().unique(),
  shareMode: text('share_mode').notNull().default('live'),
  snapshotTitle: text('snapshot_title'),
  snapshotContentJson: jsonb('snapshot_content_json').$type<unknown>(),
  snapshotTextContent: text('snapshot_text_content'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true })
}, (t) => ({
  tokenIdx: uniqueIndex('uidx_shares_token').on(t.shareToken)
}));

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdById: uuid('created_by_id').references(() => users.id),
  backupType: text('backup_type').notNull().default('manual'),
  status: text('status').notNull().default('pending'),
  storageKey: text('storage_key'),
  sizeBytes: integer('size_bytes'),
  includeSecrets: boolean('include_secrets').notNull().default(false),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
});

// Phase 4: audit ledger for reversible high-risk Topic operations (merge / split).
// Every entry records enough state to undo the operation (the exact rows moved,
// the pre-operation status), so that merges / splits are always recoverable.
// `undone_at` is set (and `undone_by_id`) when the operation is reverted.
export const topicOperations = pgTable('topic_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  // Phase 6 (F2): 'derive' is a user-confirmed copy of a Topic into another
  // Space (preserving promotedFromTopicId / originSpaceId on the copy). The
  // original Topic is never moved or deleted, so its history stays intact.
  operationType: text('operation_type').notNull().$type<'merge' | 'split' | 'derive'>(),
  // For merge: the topic that was folded INTO the survivor. For split: the
  // original (parent) topic that was divided.
  topicId: uuid('topic_id').references(() => wikiTopics.id, { onDelete: 'cascade' }),
  // For merge: the surviving topic. For split: the newly created topic.
  targetTopicId: uuid('target_topic_id').references(() => wikiTopics.id, { onDelete: 'set null' }),
  // Operation-specific reversal data (moved chunk ids, moved source keys,
  // previous statuses, extracted keyPoint ids, ...). Deterministic, never LLM.
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  undoneById: uuid('undone_by_id').references(() => users.id)
}, (t) => ({
  scopeIdx: index('idx_topic_ops_scope').on(t.workspaceId, t.spaceId),
  topicIdx: index('idx_topic_ops_topic').on(t.topicId)
}));

// Phase 5 (F3): activity events — the immutable log of *real* user activity.
// Background jobs (indexing, AI summaries, scheduled lifecycle evaluation,
// polling) MUST NEVER write here (spec F3: "不计入活动"). Only genuine user
// actions (edit, open/view, search click, RAG final citation, citation open,
// added to topic source, referenced by active project) are recorded.
export const activityEntityTypeEnum = pgEnum('activity_entity_type', ['topic', 'page']);
export const activityEventTypeEnum = pgEnum('activity_event_type', [
  'edit',
  'view',
  'search_click',
  'rag_citation',
  'citation_open',
  'added_to_source',
  'project_reference'
]);

export const knowledgeActivityEvents = pgTable('knowledge_activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  entityType: activityEntityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  eventType: activityEventTypeEnum('event_type').notNull(),
  userId: uuid('user_id').references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  scopeIdx: index('idx_activity_scope').on(t.workspaceId, t.spaceId),
  entityIdx: index('idx_activity_entity').on(t.entityType, t.entityId),
  occurredIdx: index('idx_activity_occurred').on(t.occurredAt)
}));

// Phase 5 (F3): rolled-up activity statistics. Recomputed from the event log on
// every recorded event (so the 30-day windows are always exact), plus the
// latest "last*At" timestamps and a deterministic activityScore.
export const knowledgeActivityStats = pgTable('knowledge_activity_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  entityType: activityEntityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  lastRetrievedAt: timestamp('last_retrieved_at', { withTimezone: true }),
  lastLinkedAt: timestamp('last_linked_at', { withTimezone: true }),
  lastMeaningfulActivityAt: timestamp('last_meaningful_activity_at', { withTimezone: true }),
  views30d: integer('views_30d').notNull().default(0),
  citations30d: integer('citations_30d').notNull().default(0),
  ragCitations30d: integer('rag_citations_30d').notNull().default(0),
  activeUsers30d: integer('active_users_30d').notNull().default(0),
  activityScore: integer('activity_score').notNull().default(0),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  entityUnique: uniqueIndex('uidx_activity_stats_entity').on(t.entityType, t.entityId),
  scopeIdx: index('idx_activity_stats_scope').on(t.workspaceId, t.spaceId)
}));

// Phase 6 (F1/F2): project closure packages. Generated by the closure job / the
// "archive wizard" — AI *suggestions only*, never auto-applied. Stores the
// structured, citation-backed closure summary (goals/results, key decisions +
// rationale, lessons, tech debt, reusable-knowledge candidates, recommended
// promotions). The actual promotion (Topic derivation / move) is a separate,
// user-confirmed action recorded in `topic_operations`.
export const projectClosurePackages = pgTable('project_closure_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  generatedById: uuid('generated_by_id').references(() => users.id),
  // The structured closure package (project-closure-v1) with real citations.
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  spaceIdx: uniqueIndex('uidx_closure_space').on(t.spaceId)
}));

export const userRelations = relations(users, ({ many }) => ({
  workspaceMembers: many(workspaceMembers)
}));
