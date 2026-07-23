import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { llmSuggestions, topicCandidates, wikiTopics, topicSources, documentChunks, topicOperations, topicSynonyms } from '@mindloom/db';
import { createAiProviderForContext, vectorToSqlLiteral, isAiDisabledError } from './ai.service';
import { recordActivity } from './activity.service';
import { env } from '../env';
import { tokenizeChineseFriendly } from '../utils/text';
import { topicSynthesisSchema, topicRefreshDiffSchema, type TopicSynthesis, type CitationRef, type TopicRefreshDiff, type TopicRefreshDiffItem } from '@mindloom/shared';
import type { AiProvider } from '@mindloom/ai';

/**
 * M5 — LLM Wiki artifact generation.
 *
 * After a page is indexed (chunked + embedded), we derive candidate Topics and
 * Suggestions from its content. Everything here is *best-effort*: a failure must
 * never break the page indexing pipeline, so callers wrap `generateWikiArtifacts`
 * in try/catch.
 *
 * Generation strategy:
 *   1. Try the LLM for high-quality topic proposals.
 *   2. Fall back to a deterministic heuristic (headings / frequent terms) when
 *      the LLM is unavailable or returns unparseable output — so the feature
 *      still produces useful artifacts in offline / mock environments.
 */

interface CandidateTopic {
  title: string;
  summary: string;
}

/* ----------------------------------------------- term / topic helpers ----- */

function termSet(text: string): Set<string> {
  const s = new Set<string>();
  // Chinese: emit character bigrams + trigrams so partial phrase overlap is
  // detectable. A greedy [一-鿿]{2,} token could never match a chunk fragment
  // (e.g. title "机器学习核心范式" vs chunk "...机器学习..."), which made every
  // candidate fall back to chunks[0] and collapse into one thin Topic.
  for (const seg of text.match(/[一-鿿]+/g) ?? []) {
    const chars = [...seg];
    for (let i = 0; i < chars.length; i++) {
      if (i + 1 < chars.length) s.add(chars[i] + chars[i + 1]);
      if (i + 2 < chars.length) s.add(chars[i] + chars[i + 1] + chars[i + 2]);
    }
  }
  for (const w of text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []) s.add(w);
  return s;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Raw intersection count — used by pickSupportingChunk where the candidate's
// term set is tiny and a Jaccard score against a large chunk set is always
// near-zero, making every chunk look equally (un)related.
function hitCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// Deterministic fallback: pull markdown H1/H2 headings, else the most frequent
// terms. Guarantees the Topic Center is never empty even without an LLM.
function heuristicTopics(text: string): CandidateTopic[] {
  const headings: CandidateTopic[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (m) {
      const title = m[1].trim().replace(/[*_`#]/g, '').slice(0, 80);
      if (title.length >= 2) headings.push({ title, summary: '' });
    }
  }
  if (headings.length) {
    const seen = new Set<string>();
    const out: CandidateTopic[] = [];
    for (const h of headings) {
      const key = h.title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(h);
      }
    }
    return out.slice(0, 5);
  }
  const counts = new Map<string, number>();
  for (const t of termSet(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => ({ title: t, summary: '' }));
}

function extractJson(s: string): unknown {
  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    return JSON.parse(s.slice(objStart, objEnd + 1));
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    return JSON.parse(s.slice(arrStart, arrEnd + 1));
  }
  throw new Error('no JSON object found in LLM output');
}

async function aiTopics(text: string, ai: AiProvider): Promise<CandidateTopic[] | null> {
  try {
    const out = await ai.generateText([
      {
        role: 'system',
        content:
          '你是知识库整理助手。阅读用户笔记，提炼出 1-4 个可作为独立主题(Topic)的候选标题，' +
          '每个主题用一句话概括。只输出 JSON，格式：{"topics":[{"title":"...","summary":"..."}]}。'
      },
      { role: 'user', content: text.slice(0, 4000) }
    ]);
    const parsed = extractJson(out) as { topics?: unknown };
    if (!parsed || !Array.isArray(parsed.topics)) return null;
    return (parsed.topics as unknown[])
      .map((t) => {
        const o = t as { title?: unknown; summary?: unknown };
        const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : '';
        const summary = typeof o.summary === 'string' ? o.summary.slice(0, 500) : '';
        return title.length >= 2 ? { title, summary } : null;
      })
      .filter((x): x is CandidateTopic => x !== null)
      .slice(0, 5);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- topic helpers --- */

// M6: materialise a knowledge edge (idempotent — the partial unique index on
// active edges dedupes reprocessing runs). AI-authored, status 'suggested'.
async function upsertEdge(edge: {
  workspaceId: string; spaceId: string;
  sourceType: string; sourceId: string; targetType: string; targetId: string;
  relationType: string; confidence: number; evidence: Record<string, unknown>;
}) {
  await db.execute(sql`
    INSERT INTO knowledge_edges(
      workspace_id, space_id, source_type, source_id, target_type, target_id,
      relation_type, confidence, evidence, status, created_by
    )
    VALUES (
      ${edge.workspaceId}, ${edge.spaceId}, ${edge.sourceType}, ${edge.sourceId},
      ${edge.targetType}, ${edge.targetId}, ${edge.relationType}, ${edge.confidence},
      ${JSON.stringify(edge.evidence)}::jsonb, 'suggested', 'ai'
    )
    ON CONFLICT (workspace_id, space_id, source_type, source_id, target_type, target_id, relation_type)
      WHERE status <> 'deleted'
    DO UPDATE SET updated_at = now(), confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence
  `);
}

async function hasPendingSuggestion(
  spaceId: string,
  type: string,
  extra: { topicId?: string; targetPageId?: string; candidateId?: string }
): Promise<boolean> {
  const conditions = [
    eq(llmSuggestions.spaceId, spaceId),
    eq(llmSuggestions.type, type),
    eq(llmSuggestions.status, 'pending')
  ];
  if (extra.topicId) conditions.push(eq(llmSuggestions.topicId, extra.topicId));
  if (extra.targetPageId) conditions.push(eq(llmSuggestions.pageId, extra.targetPageId));
  if (extra.candidateId) {
    conditions.push(sql`${llmSuggestions.payload} ->> 'candidateId' = ${extra.candidateId}::text`);
  }
  const rows = await db
    .select({ one: sql`1` })
    .from(llmSuggestions)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

/* ----------------------------------------- structured Page Profile ----- */

/**
 * Phase 2 (D3): derive a *structured* Page Profile from the page text without
 * an extra AI round-trip (deterministic, cheap, testable). The profile backs
 * both `page_ai_profiles` and each generated candidate's `profile` snapshot.
 */
export function buildPageProfile(text: string, title: string): {
  summary: string;
  tags: string[];
  keywords: string[];
  entities: string[];
} {
  const clean = (text || '').trim();
  const summary = clean ? clean.slice(0, 240) : title;
  const terms = [...termSet(clean)];
  const freq = new Map<string, number>();
  for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  // Headings / quoted / Title-Cased fragments are treated as entities.
  const entities = new Set<string>();
  for (const line of clean.split(/\r?\n/)) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (m) entities.add(m[1].trim().replace(/[*_`#]/g, '').slice(0, 80));
  }
  for (const q of clean.match(/[“"『「]([^”"』」]{2,40})[”"』」]/g) ?? []) {
    entities.add(q.slice(1, -1).trim());
  }
  return {
    summary,
    tags: top,
    keywords: terms.slice(0, 12),
    entities: [...entities].slice(0, 10)
  };
}

// Pick the chunk whose content best overlaps the candidate title/summary.
// Falls back to the first chunk (or null when the page has no chunks yet).
// Pick the chunk whose content best matches the candidate. Uses semantic
// (embedding) similarity when available so a leading "overview" chunk that
// mentions every topic does NOT hijack every candidate — embeddings capture
// *which section* a candidate belongs to. Falls back to keyword hit count,
// then to the first chunk.
async function pickSupportingChunk(
  chunks: { id: string; content: string; embedding?: number[] | null }[],
  cand: { title: string; summary: string },
  candEmb?: number[] | null
): Promise<string | null> {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0].id;
  if (candEmb && candEmb.length > 0) {
    let bestId = chunks[0].id;
    let bestSim = -Infinity;
    for (const c of chunks) {
      if (!c.embedding || c.embedding.length === 0) continue;
      const sim = cosineSimilarity(candEmb, c.embedding);
      if (sim > bestSim) { bestSim = sim; bestId = c.id; }
    }
    if (bestSim > -Infinity) return bestId;
  }
  const needle = termSet(`${cand.title} ${cand.summary}`);
  if (needle.size === 0) return chunks[0].id;
  let bestId = chunks[0].id;
  let bestScore = -1;
  for (const c of chunks) {
    const score = hitCount(needle, termSet(c.content || ''));
    if (score > bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
}

/* ----------------------------------------- Phase 3: clustering ------------- */

/**
 * Normalize a topic title for alias / synonym matching (spec E2 step 1).
 * Lowercases, strips punctuation (keeps letters/digits/spaces), collapses
 * whitespace. "机器学习！" and "Machine Learning" → different strings here, but
 * "机器学习" and " 机器学习 " collapse to the same key (synonyms aggregate).
 */
export function normalizeTitle(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phase B (B1.1): synonym-aware normalization. Maps an alias to its canonical
 * term (e.g. "ML" / "机器学习" -> "machinelearning") so semantically-equivalent
 * titles cluster together. The map is cached per workspace (global synonyms
 * have a NULL workspace_id and apply everywhere).
 */
const synonymCache = new Map<string, Map<string, string>>();
export async function getSynonymMap(workspaceId: string): Promise<Map<string, string>> {
  const cached = synonymCache.get(workspaceId);
  if (cached) return cached;
  const rows = await db
    .select()
    .from(topicSynonyms)
    .where(sql`workspace_id = ${workspaceId}::uuid OR workspace_id IS NULL`);
  const m = new Map<string, string>();
  for (const r of rows) m.set(normalizeTitle(r.normalizedTerm), r.canonicalTerm);
  synonymCache.set(workspaceId, m);
  return m;
}
export function applySynonyms(term: string, syn: Map<string, string>): string {
  const n = normalizeTitle(term);
  return syn.get(n) ?? n;
}
/** Test/utility hook to clear the per-workspace synonym cache. */
export function clearSynonymCache(): void {
  synonymCache.clear();
}

export type TopicCreationDecision = 'single_source' | 'normal' | 'none';

/**
 * Phase 3 (E3) — `TopicCreationPolicy`. Decides whether a cluster of candidates
 * may become a formal Topic:
 *   - 2+ related pages OR enough valid chunks  -> a normal Draft
 *   - a single high-quality long page (>=2 chunks) -> a single_source Draft
 *   - insufficient evidence                    -> none (keep as Candidate)
 * This is a *domain policy*, never delegated to the LLM.
 */
export function decideTopicCreation(opts: {
  candidateCount: number;
  distinctPageCount: number;
  validChunkCount: number;
}): TopicCreationDecision {
  if (opts.distinctPageCount >= 2 || opts.validChunkCount >= 3) return 'normal';
  if (opts.distinctPageCount === 1 && opts.validChunkCount >= 2) return 'single_source';
  return 'none';
}

function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Parse a stored pgvector value (number[] or JSON-string) into number[] | null. */
function parseVector(v: unknown): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

interface SupportChunk {
  chunkId: string;
  pageId: string;
  content: string;
  contentVersion: number;
}

// Pairwise term-overlap over the supporting chunks of a candidate group. Used
// as the deterministic "same meaning?" signal so we never merge same-name /
// different-meaning clusters (spec gate: 同名异义不误合并).
function groupSemanticOverlap(chunks: SupportChunk[]): number {
  if (chunks.length < 2) return 1;
  let best = 0;
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      best = Math.max(best, overlap(termSet(chunks[i].content), termSet(chunks[j].content)));
    }
  }
  return best;
}

/**
 * Deterministic, AI-free TopicSynthesis used as the fallback when the LLM
 * output is unparseable / fails Zod validation. Every keyPoint cites the real
 * chunk it was derived from (spec E4: citations only reference received chunks).
 * Always valid, so it is safe to write to the DB.
 */
export function buildDeterministicSynthesis(chunks: SupportChunk[]): TopicSynthesis {
  const keyPoints = chunks.map((c, i) => {
    const headingMatch = c.content.match(/^#{1,3}\s+(.+?)\s*$/m);
    const title = headingMatch ? headingMatch[1].replace(/[*_`#]/g, '').slice(0, 80) : `要点 ${i + 1}`;
    const content = c.content.replace(/^#{1,3}\s+.+$/m, '').replace(/\s+/g, ' ').trim().slice(0, 400) || c.content.slice(0, 400);
    const citation: CitationRef = { chunkId: c.chunkId, pageId: c.pageId, excerpt: c.content.slice(0, 200) };
    return { id: `kp-${i + 1}`, title, content, citations: [citation] };
  });
  const overview = chunks
    .map((c) => c.content.replace(/^#{1,3}\s+.+$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120))
    .join(' ')
    .slice(0, 600);
  return {
    schemaVersion: 'topic-synthesis-v1',
    definition: overview.slice(0, 160),
    overview,
    keyPoints,
    subtopics: [],
    conflicts: [],
    decisions: [],
    openQuestions: [],
    relatedTopicIds: [],
    generatedFromContentVersions: chunks.map((c) => ({ pageId: c.pageId, contentVersion: c.contentVersion }))
  };
}

// Strip citations whose chunkId is not in the allowed set, and guarantee every
// keyPoint keeps at least one citation (spec E4 + gate). Returns null when the
// synthesis itself is structurally invalid (so the caller writes NOTHING).
function sanitizeSynthesis(raw: unknown, validChunkIds: Set<string>): TopicSynthesis | null {
  const parsed = topicSynthesisSchema.safeParse(raw);
  if (!parsed.success) return null;
  const synth = parsed.data;
  const fixCitations = (cs: CitationRef[]): CitationRef[] => {
    const kept = cs.filter((c) => validChunkIds.has(c.chunkId));
    if (kept.length > 0) return kept;
    const fallback = validChunkIds.values().next().value as string | undefined;
    return fallback ? [{ chunkId: fallback, excerpt: '' }] : [];
  };
  const fixed: TopicSynthesis = {
    ...synth,
    keyPoints: synth.keyPoints.map((kp) => ({ ...kp, citations: fixCitations(kp.citations) }))
  };
  // Re-validate: every keyPoint must still have >=1 citation after sanitizing.
  const re = topicSynthesisSchema.safeParse(fixed);
  return re.success ? fixed : null;
}

/**
 * Phase 3 (E4) — TopicSynthesis generation.
 *   1. Build a context where every chunk is tagged with its real id.
 *   2. Ask the LLM for a synthesis whose citations reference those ids.
 *   3. Zod-validate; drop any citation that points at an unseen chunk; require
 *      each keyPoint to keep >=1 citation. On ANY failure (illegal JSON, schema
 *      violation, missing citations) we return the deterministic fallback
 *      rather than writing garbage — the gate "非法 JSON 不写库" means we must
 *      never persist an invalid payload.
 */
export async function generateTopicSynthesis(chunks: SupportChunk[], ai: AiProvider): Promise<TopicSynthesis | null> {
  if (chunks.length === 0) return null;
  const validIds = new Set(chunks.map((c) => c.chunkId));
  const ctx = chunks.map((c) => `[CID:${c.chunkId}] (page ${c.pageId})\n${c.content}`).join('\n\n');

  try {
    const out = await ai.generateText([
      {
        role: 'system',
        content:
          '你是知识综合助手。根据提供的资料块（每块以 [CID:<chunkId>] 标记）撰写一个主题综合。' +
          '只输出 JSON，严格符合结构：{schemaVersion:"topic-synthesis-v1", definition, overview, ' +
          'keyPoints:[{id,title,content,citations:[{chunkId,excerpt}]}], subtopics:[], conflicts:[], ' +
          'decisions:[], openQuestions:[], relatedTopicIds:[], generatedFromContentVersions:[]}。' +
          '每个 keyPoint 的 citations 只能引用资料中真实出现的 [CID:...] chunkId，不可编造。'
      },
      { role: 'user', content: ctx.slice(0, 6000) }
    ]);
    const parsed = extractJson(out);
    const sanitized = sanitizeSynthesis(parsed, validIds);
    if (sanitized) return sanitized;
  } catch {
    /* fall through to deterministic synthesis */
  }
  return buildDeterministicSynthesis(chunks);
}

function extractTextFromSynthesis(synth: TopicSynthesis): string {
  return [synth.definition, synth.overview, ...synth.keyPoints.map((k) => `${k.title}\n${k.content}`)].join('\n\n');
}

async function getSupportChunks(chunkIds: (string | null)[]): Promise<SupportChunk[]> {
  const ids = chunkIds.filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const rows = await db.execute<any>(sql`
    SELECT dc.id, dc.content, dc.page_id AS page_id, p.content_version AS content_version
    FROM document_chunks dc
    JOIN pages p ON p.id = dc.page_id
    WHERE dc.id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])
  `);
  return rows.rows.map((r: { id: string; content: string; page_id: string; content_version: number }) => ({
    chunkId: r.id,
    pageId: r.page_id,
    content: r.content,
    contentVersion: r.content_version
  }));
}

async function getChunkEmbedding(chunkId: string | null): Promise<number[] | null> {
  if (!chunkId) return null;
  const rows = await db.execute<any>(sql`SELECT embedding FROM document_chunks WHERE id = ${chunkId}::uuid LIMIT 1`);
  const emb = rows.rows[0]?.embedding;
  return Array.isArray(emb) ? (emb as number[]) : null;
}

/**
 * Phase 3 (E4 "保存成功后将 Topic 写入全文和向量索引") — materialise the Topic as
 * `document_chunks` (topic_id set, page_id null) so `hybridSearch` / RAG can
 * retrieve it. Idempotent: old topic chunks are cleared first.
 */
export async function indexTopicForSearch(
  topic: { id: string; workspaceId: string; spaceId: string; title: string },
  synth: TopicSynthesis,
  ai: AiProvider
): Promise<void> {
  const embModel = env.AI_EMBEDDING_MODEL;
  const dim = env.EMBEDDING_DIMENSION;
  const items: any[] = [];
  // Compute embeddings FIRST. If embedding fails we bail out and keep the
  // existing index untouched, so the Topic never vanishes from search / RAG
  // (gate: 索引更新失败不丢旧数据 — 老 chunk 仍可搜到).
  for (let i = 0; i < synth.keyPoints.length; i++) {
    const kp = synth.keyPoints[i];
    const text = `${kp.title}\n${kp.content}`;
    const emb = await ai.embed(text);
    items.push({
      workspaceId: topic.workspaceId,
      spaceId: topic.spaceId,
      pageId: null,
      topicId: topic.id,
      chunkIndex: i,
      title: topic.title,
      content: text.slice(0, 2000),
      ftsTokens: tokenizeChineseFriendly(text),
      embedding: emb ? sql`${vectorToSqlLiteral(emb)}::vector` : null,
      embeddingModel: embModel,
      embeddingDimension: dim
    });
  }
  // Atomically swap old chunks for new ones inside a transaction: on insert
  // failure the whole thing rolls back and the old chunks remain retrievable.
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM document_chunks WHERE topic_id = ${topic.id}::uuid`);
    if (items.length > 0) await tx.insert(documentChunks).values(items);
  });
}

// LLM fuzzy judgment for the "ambiguous band" of embedding similarity. Returns
// 'separate' by default — including when the (mock) provider yields no parseable
// JSON — so we err on the side of NOT merging (gate: 同名异义不误合并).
async function fuzzyMergeDecision(a: { title: string; summary: string }, b: { title: string; summary: string }, ai: AiProvider): Promise<'merge' | 'separate'> {
  try {
    const out = await ai.generateText([
      {
        role: 'system',
        content: '判断两个主题是否指同一概念。只输出 JSON：{"decision":"merge"|"separate"}。'
      },
      {
        role: 'user',
        content: `A 标题：${a.title}\nA 摘要：${a.summary}\n\nB 标题：${b.title}\nB 摘要：${b.summary}`
      }
    ]);
    const parsed = extractJson(out) as { decision?: unknown };
    if (parsed && (parsed.decision === 'merge' || parsed.decision === 'separate')) return parsed.decision;
  } catch {
    /* default to separate */
  }
  return 'separate';
}

async function createMergeSuggestion(spaceId: string, a: { id: string; title: string }, b: { id: string; title: string }) {
  if (await hasPendingSuggestion(spaceId, 'topic_merge', { candidateId: a.id })) return;
  await db.execute(sql`
    INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
    VALUES (
      (SELECT workspace_id FROM spaces WHERE id = ${spaceId}::uuid),
      ${spaceId}, NULL, NULL, 'topic_merge', 'medium', 'pending',
      ${JSON.stringify({
        candidateId: a.id, otherCandidateId: b.id,
        titleA: a.title, titleB: b.title,
        changes: `建议合并「${a.title}」与「${b.title}」`,
        reason: '两候选语义高度相似，建议合并为同一主题。',
        evidence: { titleA: a.title, titleB: b.title }
      })}::jsonb,
      ${JSON.stringify({ titleA: a.title, titleB: b.title })}::jsonb
    )
  `);
}

/**
 * Phase 3 (E2) — the Space clustering job. Aggregates `topic_candidates` into
 * formal Topics without ever asking the LLM to compare every pair:
 *   1. normalize titles (alias / synonym grouping)  -> 同义可聚合
 *   2. within a group, same-name / different-meaning (low overlap) is NOT merged
 *   3. cross-title embedding similarity -> merge suggestion (LLM only in band)
 *   4. TopicCreationPolicy decides if a cluster may become a Draft
 *   5. synthesis is generated + validated, then the Topic is indexed
 * Candidates that lack sufficient evidence stay as candidates (no Topic).
 */
export async function consolidateCandidates(
  spaceId: string,
  ai: AiProvider,
  onProgress?: (p: { done: number; total: number; stage: string }) => void | Promise<void>
): Promise<{ createdTopics: number; mergeSuggestions: number }> {
  const candidates = await db
    .select()
    .from(topicCandidates)
    .where(and(eq(topicCandidates.spaceId, spaceId), eq(topicCandidates.status, 'candidate')));
  if (candidates.length === 0) return { createdTopics: 0, mergeSuggestions: 0 };

  // Phase B (B1.2): bound the O(n^2) clustering cost so a large Space cannot
  // hang the worker. Extra candidates stay as candidates for the next run.
  const MAX_CANDIDATES = 500;
  if (candidates.length > MAX_CANDIDATES) {
    console.warn(`[consolidate] space ${spaceId}: ${candidates.length} candidates > ${MAX_CANDIDATES}; clustering first ${MAX_CANDIDATES} only.`);
    candidates.length = MAX_CANDIDATES;
  }

  // Phase B (B1.1): load synonym map so "ML" / "机器学习" group together.
  const synMap = await getSynonymMap(spaceId);
  const norm = (t: string) => applySynonyms(t, synMap);

  // Existing accepted topics keyed by normalized title -> link candidates to them.
  const existing = await db.select().from(wikiTopics).where(eq(wikiTopics.spaceId, spaceId));
  const existingByNorm = new Map<string, (typeof existing)[number]>();
  for (const t of existing) {
    const key = norm(t.title);
    if (!existingByNorm.has(key)) existingByNorm.set(key, t);
    for (const al of t.aliases ?? []) {
      const ak = norm(al);
      if (!existingByNorm.has(ak)) existingByNorm.set(ak, t);
    }
  }

  // Group candidates by normalized title (alias / synonym aggregation).
  const titleGroups = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const key = norm(c.title);
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key)!.push(c);
  }

  // Phase B (B1.2): embedding-dominated clustering.
  //  - Hard group by normalized (synonym-aware) title: identical / synonym
  //    titles are always one cluster (cheap, deterministic).
  //  - Merge ACROSS title groups using the candidates' title embeddings:
  //    cosine >= EMBED_MERGE (0.78) merges directly; the ambiguous band
  //    [EMBED_LLM_BAND, 0.78) is resolved by the LLM fuzzy judge; below the
  //    band they stay separate. This lets "机器学习" and "机器智能" (no synonym
  //    entry) consolidate into ONE Topic — the core fix for "一篇出很多 topic".
  //  - "Same source page" remains the strongest deterministic merge signal.
  const EMBED_MERGE = 0.78;
  const EMBED_LLM_BAND = 0.6;

  const groupList = [...titleGroups.values()];
  const parent = groupList.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x: number, y: number) => { const rx = find(x); const ry = find(y); if (rx !== ry) parent[ry] = rx; };

  // Representative embedding for a group: first member with a stored title
  // embedding, else best-effort fallback to a member's chunk embedding.
  const groupRepEmbedding = async (g: typeof candidates): Promise<number[] | null> => {
    for (const c of g) {
      const e = parseVector(c.titleEmbedding);
      if (e) return e;
    }
    for (const c of g) {
      const e = await getChunkEmbedding(c.chunkId);
      if (e) return e;
    }
    return null;
  };

  for (let i = 0; i < groupList.length; i++) {
    for (let j = i + 1; j < groupList.length; j++) {
      const a = groupList[i];
      const b = groupList[j];
      // Same source page -> almost certainly facets of one topic.
      const samePage = a.some((c) => b.some((d) => d.pageId === c.pageId));
      if (samePage) { union(i, j); continue; }
      const ea = await groupRepEmbedding(a);
      const eb = await groupRepEmbedding(b);
      if (!ea || !eb) continue; // no embedding signal -> keep title groups only
      const sim = cosineSimilarity(ea, eb);
      if (sim >= EMBED_MERGE) { union(i, j); continue; }
      if (sim >= EMBED_LLM_BAND) {
        const d = await fuzzyMergeDecision(
          { title: a[0].title, summary: a[0].summary },
          { title: b[0].title, summary: b[0].summary },
          ai
        );
        if (d === 'merge') union(i, j);
      }
    }
  }
  const merged = new Map<number, typeof candidates>();
  groupList.forEach((g, i) => {
    const r = find(i);
    if (!merged.has(r)) merged.set(r, []);
    merged.get(r)!.push(...g);
  });
  // Key the consolidated groups by the normalized (synonym-aware) title of their first member.
  const groups = new Map<string, typeof candidates>();
  for (const g of merged.values()) {
    const key = norm(g[0].title);
    if (!groups.has(key)) groups.set(key, g);
    else groups.get(key)!.push(...g);
  }

  // Phase B (B1.3): report clustering progress so an async worker can surface
  // it on the job (the UI polls /api/jobs/:id). Total = number of clusters.
  const totalGroups = groups.size;
  await onProgress?.({ done: 0, total: totalGroups, stage: 'clustering' });

  let createdTopics = 0;
  let mergeSuggestions = 0;

  const groupEntries = [...groups.entries()];
  for (let gi = 0; gi < groupEntries.length; gi++) {
    const [norm, group] = groupEntries[gi];
    await onProgress?.({ done: gi, total: totalGroups, stage: 'creating' });
    // Already have a Topic for this concept -> link candidates to it.
    const existingTopic = existingByNorm.get(norm);
    if (existingTopic) {
      for (const c of group) {
        await db
          .insert(topicSources)
          .values({ topicId: existingTopic.id, pageId: c.pageId, chunkId: c.chunkId, addedBy: 'ai', contributionType: 'key_point', sourceContentVersion: null })
          .onConflictDoNothing();
        await db.update(topicCandidates).set({ status: 'promoted', promotedTopicId: existingTopic.id, updatedAt: sql`now()` }).where(eq(topicCandidates.id, c.id));
      }
      continue;
    }

    const distinctPages = new Set(group.map((c) => c.pageId));
    // Count *distinct* supporting chunks, not candidate count. A cluster whose
    // candidates all cite the same chunk is single-chunk evidence and must not
    // be promoted to a Topic (that produced the "one article -> many thin
    // Topics" symptom).
    const validChunks = new Set(group.map((c) => c.chunkId).filter(Boolean)).size;
    const decision = decideTopicCreation({ candidateCount: group.length, distinctPageCount: distinctPages.size, validChunkCount: validChunks });
    if (decision === 'none') continue; // insufficient evidence -> keep candidate

    // Gate: same-name / different-meaning must NOT be merged into one Topic.
    // Only enforce this for a *single shared title* spanning multiple distinct
    // pages (the homonym risk). A group merged from one page's facets, or one
    // with several distinct titles, is a legitimate multi-facet synthesis, not
    // a homonym collision — so we don't reject it for low overlap.
    const support = await getSupportChunks(group.map((c) => c.chunkId));
    const distinctTitles = new Set(group.map((c) => normalizeTitle(c.title)));
    if (distinctTitles.size === 1 && distinctPages.size > 1 && support.length >= 2) {
      const ov = groupSemanticOverlap(support);
      if (ov < 0.15) continue; // same name, different meaning -> keep separate
    }
    if (support.length === 0) continue;

    const synth = await generateTopicSynthesis(support, ai);
    if (!synth) continue; // illegal / empty synthesis -> DO NOT WRITE a Topic

    const [topic] = await db
      .insert(wikiTopics)
      .values({
        workspaceId: group[0].workspaceId,
        spaceId: group[0].spaceId,
        title: group[0].title,
        contentJson: synth as unknown,
        textContent: extractTextFromSynthesis(synth),
        status: 'suggested',
        source: 'ai_generated',
        aiSummary: synth.definition || synth.overview.slice(0, 200),
        aliases: [norm],
        normalizedTitle: norm,
        synthesisVersion: 'topic-synthesis-v1',
        // Phase 1 (D4): a clustered draft Topic is fresh + active, awaiting review.
        publicationStatus: 'draft',
        freshnessStatus: 'fresh',
        lifecycleStatus: 'active'
      })
      .returning();

    for (const c of group) {
      await db
        .insert(topicSources)
        .values({
          topicId: topic.id,
          pageId: c.pageId,
          chunkId: c.chunkId,
          addedBy: 'ai',
          contributionType: 'key_point',
          evidenceExcerpt: (c.summary || '').slice(0, 200),
          sourceContentVersion: null
        })
        .onConflictDoNothing();
      await db.update(topicCandidates).set({ status: 'promoted', promotedTopicId: topic.id, updatedAt: sql`now()` }).where(eq(topicCandidates.id, c.id));
    }

    await indexTopicForSearch(topic, synth, ai);

    // Surface a draft suggestion (medium risk) so the user reviews / accepts it.
    if (!(await hasPendingSuggestion(spaceId, 'topic_draft', { candidateId: group[0].id }))) {
      await db.execute(sql`
        INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
        VALUES (
          ${topic.workspaceId}, ${topic.spaceId}, NULL, ${topic.id}, 'topic_draft', 'medium', 'pending',
          ${JSON.stringify({
            topicId: topic.id, topicTitle: topic.title,
            changes: `综合候选生成主题「${topic.title}」`,
            reason: '多个候选聚合为该主题，请审阅综合内容。',
            evidence: { candidateCount: group.length }
          })}::jsonb,
          ${JSON.stringify({ candidateCount: group.length })}::jsonb
        )
      `);
    }
    createdTopics++;
  }

  // Cross-title embedding similarity -> merge suggestions (LLM only in band).
  const distinct = [...groups.values()].map((g) => g[0]);
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      const a = distinct[i];
      const b = distinct[j];
      const ea = await getChunkEmbedding(a.chunkId);
      const eb = await getChunkEmbedding(b.chunkId);
      const sim = cosineSimilarity(ea, eb);
      if (sim >= 0.8) {
        await createMergeSuggestion(spaceId, { id: a.id, title: a.title }, { id: b.id, title: b.title });
        mergeSuggestions++;
      } else if (sim >= 0.5) {
        const d = await fuzzyMergeDecision(
          { title: a.title, summary: a.summary },
          { title: b.title, summary: b.summary },
          ai
        );
        if (d === 'merge') {
          await createMergeSuggestion(spaceId, { id: a.id, title: a.title }, { id: b.id, title: b.title });
          mergeSuggestions++;
        }
      }
    }
  }

  return { createdTopics, mergeSuggestions };
}

/* ----------------------------------------------------- main entry point ---- */

export async function generateWikiArtifacts(
  page: { id: string; workspace_id: string; space_id: string; title: string; text_content: string; updated_by_id: string },
  ai: AiProvider
): Promise<void> {
  const text = page.text_content || '';
  if (text.trim().length < 10) return; // nothing meaningful to derive

  const candidates = (await aiTopics(text, ai)) ?? heuristicTopics(text);
  if (candidates.length === 0) return;

  // Phase 2 (D3): structured Page Profile (deterministic, no extra AI call).
  const profile = buildPageProfile(text, page.title);

  // Supporting chunks for this page — each candidate references its best-match
  // chunk so the Candidate UI can show provenance (gate: "Candidate 有 Chunk 引用").
  const chunkRows = await db.execute<any>(sql`
    SELECT id, content, embedding FROM document_chunks WHERE page_id = ${page.id} ORDER BY chunk_index
  `);
  const chunks = chunkRows.rows.map((r: { id: string; content: string; embedding?: unknown }) => ({
    id: r.id,
    content: r.content,
    embedding:
      typeof r.embedding === 'string'
        ? (() => { try { return JSON.parse(r.embedding); } catch { return null; } })()
        : (r.embedding as number[] | null) ?? null
  }));

  // Embed candidate titles once (batched) so we can match each to its real
  // section chunk semantically, instead of all collapsing onto the overview.
  let candEmbs: (number[] | null)[] | null = null;
  try {
    candEmbs = await ai.embedBatch(candidates.map((c) => `${c.title} ${c.summary}`));
  } catch {
    candEmbs = null;
  }

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    // Phase 2 (D2): a page only produces *candidates*, never formal Topics.
    // Formal Topics are created later by promotion / Phase 3 clustering, so a
    // single short page never spawns multiple published Topics.
    const chunkId = await pickSupportingChunk(chunks, cand, candEmbs?.[i] ?? null);
    const emb = candEmbs?.[i] ?? null;
    const [candidate] = await db.insert(topicCandidates).values({
      workspaceId: page.workspace_id,
      spaceId: page.space_id,
      pageId: page.id,
      chunkId,
      title: cand.title,
      summary: cand.summary,
      profile: { ...profile, summary: cand.summary || profile.summary },
      status: 'candidate',
      // Phase B (B1.2): persist the title embedding so clustering can be
      // embedding-dominated without recomputing it here.
      titleEmbedding: emb ? sql`${vectorToSqlLiteral(emb)}::vector` : null
    }).returning();

    // Surface a candidate suggestion (medium risk) so the user can review /
    // promote it in the UI. candidateId lives in the payload (no schema change).
    if (!(await hasPendingSuggestion(page.space_id, 'topic_candidate', { candidateId: candidate.id }))) {
      await db.execute(sql`
        INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
        VALUES (
          ${page.workspace_id}, ${page.space_id}, ${page.id}, NULL, 'topic_candidate', 'medium', 'pending',
          ${JSON.stringify({
            candidateId: candidate.id, candidateTitle: cand.title, candidateSummary: cand.summary,
            sourcePageId: page.id, chunkId,
            changes: `候选主题「${cand.title}」`,
            reason: cand.summary || 'AI 从笔记中提炼出的候选主题，审阅后可晋升为正式知识主题。',
            evidence: { sourcePageId: page.id, chunkId }
          })}::jsonb,
          ${JSON.stringify({ sourcePageId: page.id })}::jsonb
        )
      `);
    }
  }

  // Cross-link suggestions: propose linking this page to other pages in the
  // same space that share a meaningful term overlap.
  const others = await db.execute<any>(sql`
    SELECT id, title, text_content FROM pages
    WHERE space_id = ${page.space_id} AND id <> ${page.id} AND status = 'normal'
    ORDER BY updated_at DESC LIMIT 30
  `);
  const baseTerms = termSet(text);
  if (baseTerms.size === 0) return;

  let linksCreated = 0;
  for (const other of others.rows) {
    if (linksCreated >= 3) break;
    const ov = overlap(baseTerms, termSet(other.text_content || ''));
    if (ov < 0.12) continue;
    if (await hasPendingSuggestion(page.space_id, 'cross_link', { targetPageId: other.id })) continue;
    await db.execute(sql`
      INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
      VALUES (
        ${page.workspace_id}, ${page.space_id}, ${page.id}, NULL, 'cross_link', 'low', 'pending',
        ${JSON.stringify({
          sourcePageId: page.id, targetPageId: other.id, targetPageTitle: other.title,
          reason: '内容主题高度相关', sharedTerms: [],
          changes: `在本页与「${other.title}」之间建立双向链接`,
          evidence: { overlap: Number(ov.toFixed(2)) }
        })}::jsonb,
        ${JSON.stringify({ overlap: Number(ov.toFixed(2)) })}::jsonb
      )
    `);
    // M6: page <-> page related edge, weighted by term overlap.
    await upsertEdge({
      workspaceId: page.workspace_id, spaceId: page.space_id,
      sourceType: 'page', sourceId: page.id, targetType: 'page', targetId: other.id,
      relationType: 'related', confidence: Math.round(ov * 100), evidence: { overlap: Number(ov.toFixed(2)), reason: '内容主题高度相关' }
    });
    linksCreated++;
  }
}

/* ------------------------------------------- candidate promotion ----- */

/**
 * Phase 2 (D2): promote a reviewed Candidate into a formal Topic. This is the
 * only path that creates a `wiki_topics` row from a page — and it is an explicit
 * user action, never an automatic side-effect of page processing. The candidate
 * keeps a `promotedTopicId` back-reference for audit/traceability, and its
 * supporting chunk is recorded in `topic_sources`.
 */
export async function promoteCandidate(candidateId: string, userId: string): Promise<{ topicId: string }> {
  const [cand] = await db.select().from(topicCandidates).where(eq(topicCandidates.id, candidateId)).limit(1);
  if (!cand) throw new Error('candidate not found');
  if (cand.status === 'promoted' && cand.promotedTopicId) return { topicId: cand.promotedTopicId };

  // Phase 3 consolidation for promotion: a page often produces multiple facet
  // candidates. Promoting one should synthesize ONE rich Topic from the whole
  // page's evidence, not a single-chunk thin Topic.
  // Phase B (B1.4): only promote the selected candidate + its *synonym-cluster*
  // mates (candidates that resolve to the same normalized concept), NOT every
  // candidate on the page. The remaining candidates stay as candidates for
  // later clustering instead of being force-merged into one Topic.
  const synMap = await getSynonymMap(cand.workspaceId);
  const selectedNorm = applySynonyms(cand.title, synMap);
  const pageCands = await db
    .select()
    .from(topicCandidates)
    .where(and(eq(topicCandidates.pageId, cand.pageId), eq(topicCandidates.status, 'candidate')));
  const siblings = pageCands.filter((c) => applySynonyms(c.title, synMap) === selectedNorm);

  const siblingIds = siblings.map((c) => c.id);
  const chunkIds = siblings.map((c) => c.chunkId).filter((x): x is string => !!x);
  const support = chunkIds.length > 0 ? await getSupportChunks(chunkIds) : [];

  // Phase 3 (D3): a promoted Topic carries a valid TopicSynthesis (overview /
  // keyPoints / citations) rather than an empty doc. Built deterministically
  // from all supporting chunks so it is always valid + citable.
  const synth = support.length > 0
    ? buildDeterministicSynthesis(support)
    : buildDeterministicSynthesis([{ chunkId: cand.chunkId ?? 'missing', pageId: cand.pageId, content: cand.summary || cand.title, contentVersion: 1 }]);

  const [topic] = await db.insert(wikiTopics).values({
    workspaceId: cand.workspaceId,
    spaceId: cand.spaceId,
    title: cand.title,
    contentJson: synth as unknown,
    textContent: extractTextFromSynthesis(synth),
    status: 'accepted',
    source: 'ai_generated',
    aiSummary: synth.definition || cand.summary,
    aliases: [normalizeTitle(cand.title)],
    normalizedTitle: normalizeTitle(cand.title),
    synthesisVersion: 'topic-synthesis-v1',
    createdById: userId,
    // Phase 1 (D4): a user-promoted topic is published, fresh and active.
    publicationStatus: 'accepted',
    freshnessStatus: 'fresh',
    lifecycleStatus: 'active'
  }).returning();

  // Record every sibling chunk as a source of the consolidated Topic.
  for (const c of siblings) {
    if (c.chunkId) {
      await db.insert(topicSources).values({
        topicId: topic.id, pageId: c.pageId, chunkId: c.chunkId, addedBy: 'ai', contributionType: 'key_point'
      }).onConflictDoNothing();
    }
  }

  // M6: the topic "covers" the page it was derived from -> a graph edge.
  await upsertEdge({
    workspaceId: cand.workspaceId, spaceId: cand.spaceId,
    sourceType: 'topic', sourceId: topic.id, targetType: 'page', targetId: cand.pageId,
    relationType: 'covers', confidence: 70, evidence: { generatedFrom: cand.title, fromCandidate: cand.id }
  });

  // Mark all sibling candidates as promoted into this single Topic.
  if (siblingIds.length > 0) {
    await db.execute(sql`
      UPDATE topic_candidates
      SET status = 'promoted', promoted_topic_id = ${topic.id}, updated_at = now()
      WHERE id = ANY(ARRAY[${sql.join(siblingIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    `);
  }

  // Resolve pending candidate suggestions for all siblings.
  if (siblingIds.length > 0) {
    await db.execute(sql`
      UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
      WHERE type = 'topic_candidate' AND status = 'pending'
        AND payload ->> 'candidateId' = ANY(ARRAY[${sql.join(siblingIds.map((id) => sql`${id}::text`), sql`, `)}])
    `);
  }

  // Index the consolidated Topic for RAG / full-text retrieval.
  try {
    const ai = await createAiProviderForContext({ workspaceId: cand.workspaceId, spaceId: cand.spaceId });
    await indexTopicForSearch(topic, synth, ai);
  } catch {
    /* indexing is best-effort; the Topic already exists */
  }

  return { topicId: topic.id };
}

/** Dismiss a candidate (user rejects it) and resolve its pending suggestion. */
export async function dismissCandidate(candidateId: string): Promise<void> {
  await db.update(topicCandidates)
    .set({ status: 'dismissed', updatedAt: sql`now()` })
    .where(eq(topicCandidates.id, candidateId));
  await db.execute(sql`
    UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
    WHERE payload ->> 'candidateId' = ${candidateId}::text AND type = 'topic_candidate' AND status = 'pending'
  `);
}

/* ------------------------------------------- stale / refresh / undo ----- */

/**
 * M5 — when a source page is re-processed, any AI-derived *accepted* topic
 * that depends on it becomes potentially outdated. Per the "trustworthy AI"
 * rule we must NOT silently overwrite the topic: instead we flag it `stale`
 * and surface a `stale_topic` suggestion so the user can refresh on purpose.
 *
 * Topics with `update_policy = 'auto_update'` are excluded — those are
 * regenerated by the refresh job rather than flagged.
 */
export async function markTopicsStaleForPage(pageId: string): Promise<void> {
  const rows = await db.execute<any>(sql`
    SELECT t.id, t.title, t.space_id, t.workspace_id
    FROM wiki_topics t
    JOIN topic_sources ts ON ts.topic_id = t.id
    WHERE ts.page_id = ${pageId}
      AND t.source = 'ai_generated'
      AND t.status IN ('accepted', 'user_edited')
      AND t.update_policy <> 'auto_update'
  `);
  for (const t of rows.rows) {
    // Phase 1 (D4): stale is a *freshness* axis, orthogonal to lifecycle.
    await db.execute(sql`UPDATE wiki_topics SET status = 'stale', freshness_status = 'stale', updated_at = now() WHERE id = ${t.id}`);

    const existing = await db.execute<any>(sql`
      SELECT 1 FROM llm_suggestions
      WHERE space_id = ${t.space_id} AND type = 'stale_topic' AND status = 'pending'
        AND payload ->> 'topicId' = ${t.id}::text
      LIMIT 1
    `);
    if (existing.rows.length > 0) continue;

    const pageRes = await db.execute<any>(sql`SELECT title FROM pages WHERE id = ${pageId} LIMIT 1`);
    const page = pageRes.rows[0];
    await db.execute(sql`
      INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
      VALUES (
        ${t.workspace_id}, ${t.space_id}, ${pageId}, ${t.id}, 'stale_topic', 'low', 'pending',
        ${JSON.stringify({
          topicId: t.id, topicTitle: t.title, sourcePageId: pageId, sourcePageTitle: page?.title ?? '',
          changes: `主题「${t.title}」的源笔记已更新，内容可能过时`,
          reason: `源笔记「${page?.title ?? ''}」已重新整理，建议重新生成该主题`,
          evidence: { sourcePageId: pageId, sourcePageTitle: page?.title ?? '' }
        })}::jsonb,
        ${JSON.stringify({ sourcePageId: pageId, sourcePageTitle: page?.title ?? '' })}::jsonb
      )
    `);
  }
}

/**
 * Revert an accepted suggestion. Restores the suggestion to `pending` and
 * undoes the side-effect it caused when accepted:
 *   - topic_proposal -> topic back to `suggested` (unless another accepted
 *     proposal still references it)
 *   - cross_link      -> the confirmed related edge back to `suggested`
 * This is what powers the per-suggestion "撤销" (undo) action so that every
 * AI-driven modification stays reversible.
 */
export async function undoSuggestion(id: string): Promise<void> {
  const [s] = await db.select().from(llmSuggestions).where(eq(llmSuggestions.id, id)).limit(1);
  if (!s || s.status !== 'accepted') return;
  await db.execute(sql`UPDATE llm_suggestions SET status = 'pending', updated_at = now() WHERE id = ${id}`);

  const p = (s.payload ?? {}) as { topicId?: string; sourcePageId?: string; targetPageId?: string };
  if (s.type === 'topic_proposal' && p.topicId) {
    const others = await db.execute<any>(sql`
      SELECT 1 FROM llm_suggestions
      WHERE topic_id = ${p.topicId} AND type = 'topic_proposal' AND status = 'accepted' AND id <> ${id}
      LIMIT 1
    `);
    if (others.rows.length === 0) {
      await db.execute(sql`UPDATE wiki_topics SET status = 'suggested', updated_at = now() WHERE id = ${p.topicId}`);
    }
  } else if (s.type === 'cross_link' && p.sourcePageId && p.targetPageId) {
    await db.execute(sql`
      UPDATE knowledge_edges SET status = 'suggested', updated_at = now()
      WHERE source_type = 'page' AND source_id = ${p.sourcePageId}
        AND target_type = 'page' AND target_id = ${p.targetPageId}
        AND relation_type = 'related' AND status = 'confirmed'
    `);
  }
}

/* ------------------------------------------- Phase 4: refresh diff ---------- */

// Load the current source pages that back a topic (used to (re)generate a
// synthesis / diff from the *live* corpus rather than stale snapshot text).
async function getTopicSourcePages(topicId: string): Promise<{ id: string; title: string; textContent: string; contentVersion: number }[]> {
  const rows = await db.execute<any>(sql`
    SELECT p.id, p.title, p.text_content AS text_content, p.content_version AS content_version
    FROM topic_sources ts
    JOIN pages p ON p.id = ts.page_id
    WHERE ts.topic_id = ${topicId}
    ORDER BY p.updated_at DESC
  `);
  return rows.rows.map((r: { id: string; title: string; text_content: string; content_version: number }) => ({
    id: r.id, title: r.title, textContent: r.text_content, contentVersion: r.content_version
  }));
}

// Build the supporting chunks for a topic from its *current* source pages, so a
// refresh diff is grounded in the real, up-to-date corpus (spec E5).
async function getTopicSupportChunks(topicId: string): Promise<{ support: SupportChunk[]; pages: { id: string; title: string }[] }> {
  const pages = await getTopicSourcePages(topicId);
  if (pages.length === 0) return { support: [], pages };
  const ids = pages.map((p) => p.id);
  const rows = await db.execute<any>(sql`
    SELECT dc.id, dc.content, dc.page_id AS page_id, p.content_version AS content_version
    FROM document_chunks dc
    JOIN pages p ON p.id = dc.page_id
    WHERE dc.page_id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])
  `);
  const support: SupportChunk[] = rows.rows.map((r: { id: string; content: string; page_id: string; content_version: number }) => ({
    chunkId: r.id, pageId: r.page_id, content: r.content, contentVersion: r.content_version
  }));
  return { support, pages };
}

/**
 * Generate a structured, itemised refresh diff for a stale Topic (spec E5
 * "生成 refresh diff → 用户逐项应用"). Compares the Topic's *existing* synthesis
 * against a freshly-generated one from its current source pages.
 *
 * Deterministic (no LLM-in-the-loop for the diff itself — the LLM only produces
 * the fresh synthesis, which is Zod-validated). Every `add`/`modify` item carries
 * REAL chunk citations (from the validated fresh synthesis), so applying the diff
 * never invents citations. Returns `null` when a fresh synthesis cannot be built
 * (AI failure / no sources) so the caller keeps the topic stale.
 */
export async function generateRefreshDiff(topicId: string, ai: AiProvider): Promise<TopicRefreshDiff | null> {
  const topicRes = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`);
  const topic = topicRes.rows[0];
  if (!topic) return null;
  const existing = (topic.content_json ?? {}) as TopicSynthesis;
  if (existing?.schemaVersion !== 'topic-synthesis-v1') return null; // legacy doc -> no diff path

  const { support, pages } = await getTopicSupportChunks(topicId);
  if (support.length === 0) return null; // nothing to refresh from -> keep stale

  const fresh = await generateTopicSynthesis(support, ai);
  if (!fresh) return null; // AI / validation failure -> keep stale, do NOT write

  const norm = (s: string) => normalizeTitle(s);
  const existingByTitle = new Map(existing.keyPoints.map((k) => [norm(k.title), k]));
  const freshByTitle = new Map(fresh.keyPoints.map((k) => [norm(k.title), k]));
  const items: TopicRefreshDiffItem[] = [];

  // Added key points: present in fresh, absent in existing.
  for (const fkp of fresh.keyPoints) {
    if (!existingByTitle.has(norm(fkp.title))) {
      items.push({ kind: 'add_key_point', keyPoint: { id: fkp.id, title: fkp.title, content: fkp.content, citations: fkp.citations } });
    }
  }
  // Removed key points: present in existing, absent in fresh.
  for (const ekp of existing.keyPoints) {
    if (!freshByTitle.has(norm(ekp.title))) {
      items.push({ kind: 'remove_key_point', keyPointId: ekp.id, title: ekp.title });
    }
  }
  // Modified key points: same title, different content.
  for (const ekp of existing.keyPoints) {
    const fkp = freshByTitle.get(norm(ekp.title));
    if (fkp && fkp.content !== ekp.content) {
      items.push({
        kind: 'modify_key_point',
        keyPointId: ekp.id,
        title: ekp.title,
        oldContent: ekp.content,
        newContent: fkp.content,
        newCitations: fkp.citations
      });
    }
  }

  // Source-level changes: compare current source pages vs recorded topic_sources.
  const existingSourcePages = new Set((await db.execute<any>(sql`SELECT page_id FROM topic_sources WHERE topic_id = ${topicId}`)).rows.map((r: { page_id: string }) => r.page_id));
  const currentPages = new Map(pages.map((p) => [p.id, p.title]));
  for (const [pid, ptitle] of currentPages) {
    if (!existingSourcePages.has(pid)) items.push({ kind: 'add_source', pageId: pid, pageTitle: ptitle });
  }
  for (const pid of existingSourcePages) {
    if (!currentPages.has(pid)) items.push({ kind: 'stale_source', pageId: pid, reason: '源页面已不再作为该主题来源' });
  }

  // New conflicts surfaced by the fresh synthesis.
  const existingConflictKeys = new Set((existing.conflicts ?? []).map((c) => norm(c.description)));
  for (const c of fresh.conflicts ?? []) {
    if (!existingConflictKeys.has(norm(c.description))) {
      items.push({ kind: 'conflict', description: c.description, sides: c.sides });
    }
  }

  const diff: TopicRefreshDiff = {
    schemaVersion: 'topic-refresh-diff-v1',
    topicId,
    generatedFromContentVersions: fresh.generatedFromContentVersions ?? [],
    items
  };
  // Validate the diff structure before handing it to callers / persisting it.
  const parsed = topicRefreshDiffSchema.safeParse(diff);
  return parsed.success ? parsed.data : null;
}

// Persist (or replace) a pending refresh-diff suggestion so the UI can render and
// apply it item-by-item. Deduplicated per topic so re-running refresh updates the
// same suggestion rather than stacking duplicates.
async function storeRefreshDiffSuggestion(topic: { id: string; workspaceId: string; spaceId: string }, diff: TopicRefreshDiff): Promise<void> {
  const existing = await db.execute<any>(sql`
    SELECT id FROM llm_suggestions
    WHERE space_id = ${topic.spaceId} AND type = 'topic_refresh_diff' AND status = 'pending'
      AND payload ->> 'topicId' = ${topic.id}::text
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    await db.execute(sql`
      UPDATE llm_suggestions SET payload = ${JSON.stringify({ topicId: topic.id, diff })}::jsonb, updated_at = now()
      WHERE id = ${existing.rows[0].id}
    `);
    return;
  }
  await db.execute(sql`
    INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
    VALUES (
      ${topic.workspaceId}, ${topic.spaceId}, NULL, ${topic.id}, 'topic_refresh_diff', 'low', 'pending',
      ${JSON.stringify({ topicId: topic.id, diff })}::jsonb,
      ${JSON.stringify({ topicId: topic.id })}::jsonb
    )
  `);
}

// Clear the stale flag on a topic whose sources now agree with its synthesis.
async function clearStaleFlag(topicId: string): Promise<void> {
  await db.execute(sql`
    UPDATE wiki_topics
    SET freshness_status = 'fresh', status = CASE WHEN status = 'stale' THEN 'accepted' ELSE status END,
        publication_status = CASE WHEN publication_status = 'stale' OR publication_status = 'suggested' THEN 'accepted' ELSE publication_status END,
        last_ai_refresh_at = now(), updated_at = now()
    WHERE id = ${topicId}
  `);
  await db.execute(sql`
    UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
    WHERE topic_id = ${topicId} AND type = 'stale_topic' AND status = 'pending'
  `);
}

/**
 * Phase 4 refresh entry point. Replaces the Phase 0 behaviour for *structured*
 * Topics (topic-synthesis-v1): instead of silently overwriting the body, it
 * generates an itemised diff and stores it for the user to apply. The topic
 * stays `stale` until the user applies the diff (Gate: 用户正文不被覆盖).
 *
 * Legacy (doc-only) Topics keep the original overwrite behaviour so the Phase 0
 * contract (`refreshTopicSuggestions` returns `refreshed:true` and clears stale
 * on AI success) is preserved.
 *
 * `user_edited` Topics are NEVER overwritten — the diff is generated and stored
 * for review, but the user's body is left untouched (Gate: 用户正文不被覆盖).
 */
export async function refreshTopicSuggestions(topicId: string): Promise<{ refreshed: boolean; error?: string; diff?: TopicRefreshDiff }> {
  const topicRes = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`);
  const topic = topicRes.rows[0];
  if (!topic) return { refreshed: false, error: 'topic not found' };

  const contentJson = (topic.content_json ?? {}) as TopicSynthesis;
  const isStructured = contentJson?.schemaVersion === 'topic-synthesis-v1';

  if (isStructured) {
    let ai: AiProvider;
    try {
      ai = await createAiProviderForContext({ workspaceId: topic.workspace_id, spaceId: topic.space_id });
    } catch (err) {
      if (isAiDisabledError(err)) {
        // Disabled space: nothing to refresh; keep stale, report (no false success).
        return { refreshed: false, error: 'ai disabled for this space' };
      }
      throw err;
    }
    const diff = await generateRefreshDiff(topicId, ai);
    // AI / validation failure -> keep stale, do NOT write (Gate: AI 失败时保持 stale).
    if (!diff) return { refreshed: false, error: 'refresh diff generation failed' };

    if (diff.items.length === 0) {
      // Sources now agree with the synthesis — nothing to overwrite; clear stale.
      await clearStaleFlag(topicId);
      return { refreshed: true };
    }

    // Store the diff for item-by-item application. Never overwrite the body.
    await storeRefreshDiffSuggestion({ id: topic.id, workspaceId: topic.workspace_id, spaceId: topic.space_id }, diff);
    // user_edited bodies are protected: keep stale, leave content intact.
    return { refreshed: true, diff };
  }

  // ---- Legacy (doc-only) Topic: original Phase 0 overwrite behaviour ----
  const src = await db.execute<any>(sql`
    SELECT p.text_content FROM topic_sources ts
    JOIN pages p ON p.id = ts.page_id
    WHERE ts.topic_id = ${topicId}
    ORDER BY p.updated_at DESC LIMIT 20
  `);
  const text = src.rows.map((r: { text_content: string }) => r.text_content).join('\n\n').trim();
  if (!text) return { refreshed: false, error: 'no source content' };

  try {
    const ai = await createAiProviderForContext({ workspaceId: topic.workspace_id, spaceId: topic.space_id });
    const out = await ai.generateText([
      { role: 'system', content: '用一句话概括以下资料的主题要点。只输出文本，不要使用 JSON。' },
      { role: 'user', content: text.slice(0, 2000) }
    ]);
    if (!out || !out.trim()) return { refreshed: false, error: 'ai returned empty summary' };
    await db.execute(sql`
      UPDATE wiki_topics
      SET ai_summary = ${out.trim().slice(0, 500)}, status = 'accepted', last_ai_refresh_at = now(),
          ai_version = 'refreshed', updated_at = now(),
          freshness_status = 'fresh', publication_status = 'accepted'
      WHERE id = ${topicId}
    `);
    await db.execute(sql`
      UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
      WHERE topic_id = ${topicId} AND type = 'stale_topic' AND status = 'pending'
    `);
    return { refreshed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { refreshed: false, error: message };
  }
}

/**
 * Apply selected items of a stored refresh diff to a Topic (spec E5 "逐项应用").
 * Every change is validated against `topicSynthesisSchema` before persisting, so
 * the result is always a legal synthesis (Gate: 非法 JSON / 无效结构不写库).
 * Applying is an explicit user action, so a `user_edited` body is preserved as
 * `user_edited` (the user chose to incorporate the diff), and the topic is
 * re-indexed for RAG. The stale flag is cleared once the diff is applied.
 */
export async function applyRefreshDiff(topicId: string, itemIndexes: number[], _userId: string): Promise<{ applied: number }> {
  const sugg = await db.execute<any>(sql`
    SELECT * FROM llm_suggestions
    WHERE topic_id = ${topicId} AND type = 'topic_refresh_diff' AND status = 'pending'
    LIMIT 1
  `);
  if (sugg.rows.length === 0) throw new Error('no pending refresh diff for this topic');
  const diff = (sugg.rows[0].payload as { diff?: TopicRefreshDiff }).diff;
  if (!diff) throw new Error('refresh diff payload missing');

  const topicRes = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`);
  const topic = topicRes.rows[0];
  if (!topic) throw new Error('topic not found');
  const synth = (topic.content_json ?? {}) as TopicSynthesis;
  if (synth?.schemaVersion !== 'topic-synthesis-v1') throw new Error('topic is not a structured synthesis');

  const selected = new Set(itemIndexes);
  const next: TopicSynthesis = JSON.parse(JSON.stringify(synth));
  let applied = 0;

  diff.items.forEach((item, idx) => {
    if (!selected.has(idx)) return;
    switch (item.kind) {
      case 'add_key_point':
        next.keyPoints.push(item.keyPoint);
        applied++;
        break;
      case 'modify_key_point': {
        const kp = next.keyPoints.find((k) => k.id === item.keyPointId);
        if (kp) {
          kp.content = item.newContent;
          kp.citations = item.newCitations;
          if (item.title) kp.title = item.title;
          applied++;
        }
        break;
      }
      case 'remove_key_point':
        next.keyPoints = next.keyPoints.filter((k) => k.id !== item.keyPointId);
        applied++;
        break;
      case 'conflict':
        next.conflicts = next.conflicts ?? [];
        next.conflicts.push({ description: item.description, sides: item.sides });
        applied++;
        break;
      case 'add_source':
        // captured below (needs an insert); counted here for the return value.
        applied++;
        break;
      case 'stale_source':
        // captured below (needs a delete); counted here for the return value.
        applied++;
        break;
    }
  });

  // Source-level items require DB writes (outside the synthesis JSON).
  for (const idx of selected) {
    const item = diff.items[idx];
    if (item.kind === 'add_source') {
      await db.insert(topicSources).values({ topicId, pageId: item.pageId, addedBy: 'user', contributionType: 'key_point', sourceType: 'page' }).onConflictDoNothing();
      // A user applied a diff that added a new source page to the Topic.
      await recordActivity({ workspaceId: topic.workspace_id, spaceId: topic.space_id, entityType: 'topic', entityId: topicId, eventType: 'added_to_source', userId: _userId, metadata: { pageId: item.pageId } });
    } else if (item.kind === 'stale_source') {
      await db.execute(sql`DELETE FROM topic_sources WHERE topic_id = ${topicId} AND page_id = ${item.pageId}::uuid`);
    }
  }

  // Gate: resulting synthesis must still be valid (e.g. removing the last
  // keyPoint is rejected rather than persisting an illegal structure).
  const validated = topicSynthesisSchema.safeParse(next);
  if (!validated.success) throw new Error('applying the diff would produce an invalid synthesis');

  const textContent = extractTextFromSynthesis(next);
  const wasUserEdited = topic.publication_status === 'user_edited';
  await db.execute(sql`
    UPDATE wiki_topics
    SET content_json = ${JSON.stringify(next)}::jsonb, text_content = ${textContent},
        ai_summary = ${(next.definition || next.overview).slice(0, 500)},
        freshness_status = 'fresh',
        status = CASE WHEN status = 'stale' THEN 'accepted' ELSE status END,
        publication_status = ${wasUserEdited ? 'user_edited' : 'accepted'},
        last_ai_refresh_at = now(), updated_at = now()
    WHERE id = ${topicId}
  `);
  // Resolve the diff + stale suggestions now that the user has applied changes.
  await db.execute(sql`
    UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
    WHERE topic_id = ${topicId} AND type IN ('topic_refresh_diff', 'stale_topic') AND status = 'pending'
  `);

  // Re-index the (now updated) Topic so RAG reflects the applied diff.
  try {
    const ai = await createAiProviderForContext({ workspaceId: topic.workspace_id, spaceId: topic.space_id });
    await indexTopicForSearch(topic, next, ai);
  } catch {
    /* indexing is best-effort */
  }

  return { applied };
}

/* ------------------------------------------- Phase 4: merge / split --------- */

/**
 * Merge `mergedId` INTO `survivorId`. The merged Topic becomes a redirect stub
 * (lifecycle 'archived', pointing at the survivor) so old links keep working.
 * Provenance (topic_sources) and RAG chunks (document_chunks.topic_id) are moved
 * to the survivor. The operation is recorded in `topic_operations` with enough
 * reversal data to fully undo it (Gate: 合并后可追溯和恢复).
 */
export async function mergeTopics(survivorId: string, mergedId: string, userId: string): Promise<{ operationId: string }> {
  if (survivorId === mergedId) throw new Error('cannot merge a topic into itself');
  const [survivor, merged] = await Promise.all([
    db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${survivorId} LIMIT 1`),
    db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${mergedId} LIMIT 1`)
  ]);
  const s = survivor.rows[0];
  const m = merged.rows[0];
  if (!s || !m) throw new Error('topic not found');
  if (s.space_id !== m.space_id) throw new Error('cannot merge topics across spaces');

  // Capture the merged topic's sources so we can move provenance correctly and
  // reverse it. We move only the rows whose pageId the survivor does NOT already
  // have (duplicate provenance is dropped); the rest are re-inserted on undo.
  const mergedSources = await db.execute<any>(sql`SELECT * FROM topic_sources WHERE topic_id = ${mergedId}`);
  const survivorSourcePages = new Set(
    (await db.execute<any>(sql`SELECT page_id FROM topic_sources WHERE topic_id = ${survivorId}`)).rows.map((r: { page_id: string }) => r.page_id)
  );
  const movedKeys: string[] = [];
  const droppedRows: Record<string, unknown>[] = [];
  for (const row of mergedSources.rows) {
    if (survivorSourcePages.has(row.page_id)) {
      droppedRows.push(row);
    } else {
      movedKeys.push(row.page_id);
    }
  }

  // Alias the merged title into the survivor for future clustering.
  const mergedNorm = normalizeTitle(m.title);
  const survivorAliases: string[] = Array.isArray(s.aliases) ? [...s.aliases] : [];
  if (!survivorAliases.includes(mergedNorm)) survivorAliases.push(mergedNorm);
  // Build a Postgres text[] literal (raw SQL needs explicit array syntax).
  const aliasLiteral = `{${survivorAliases.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(',')}}`;

  // All data mutations run inside ONE transaction so a mid-merge failure leaves
  // no "half-merged" orphan state (Gate: 合并可完整回滚). The (network) reindex
  // is deliberately performed AFTER commit, best-effort.
  const [op] = await db.transaction(async (tx) => {
    // Move provenance: delete duplicate sources, re-point the rest to survivor.
    for (const row of droppedRows) {
      await tx.execute(sql`DELETE FROM topic_sources WHERE topic_id = ${mergedId} AND page_id = ${row.page_id}::uuid`);
    }
    for (const pageId of movedKeys) {
      await tx.execute(sql`UPDATE topic_sources SET topic_id = ${survivorId}::uuid WHERE topic_id = ${mergedId} AND page_id = ${pageId}::uuid`);
    }

    // Move the merged Topic's RAG chunks to the survivor (so search keeps it).
    const chunkRows = await tx.execute<any>(sql`SELECT id FROM document_chunks WHERE topic_id = ${mergedId}`);
    const chunkIds = chunkRows.rows.map((r: { id: string }) => r.id);
    if (chunkIds.length > 0) {
      await tx.execute(sql`UPDATE document_chunks SET topic_id = ${survivorId}::uuid WHERE topic_id = ${mergedId} AND id = ANY(ARRAY[${sql.join(chunkIds.map((id) => sql`${id}::uuid`), sql`, `)}])`);
    }

    // Update survivor aliases.
    await tx.execute(sql`UPDATE wiki_topics SET aliases = ${aliasLiteral}::text[] WHERE id = ${survivorId}`);

    // Turn the merged topic into a redirect stub.
    await tx.execute(sql`
      UPDATE wiki_topics
      SET merged_into_topic_id = ${survivorId}::uuid, merged_at = now(), merged_by_id = ${userId}::uuid,
          lifecycle_status = 'archived', status = 'archived', freshness_status = 'fresh', updated_at = now()
      WHERE id = ${mergedId}
    `);

    // Audit record (reversible: re-point chunks + sources back, restore stub).
    const [operation] = await tx
      .insert(topicOperations)
      .values({
        workspaceId: s.workspace_id,
        spaceId: s.space_id,
        operationType: 'merge',
        topicId: mergedId,
        targetTopicId: survivorId,
        createdById: userId,
        payload: {
          movedKeys,
          droppedRows,
          chunkIds,
          previousMerged: { lifecycleStatus: m.lifecycle_status, status: m.status, publicationStatus: m.publication_status, title: m.title }
        }
      })
      .returning();
    return [operation];
  });

  // Re-index the survivor (now carries the merged chunks). Network call kept
  // OUTSIDE the transaction: a reindex failure must not roll back the merge.
  try {
    const ai = await createAiProviderForContext({ workspaceId: s.workspace_id, spaceId: s.space_id });
    const sSynth = (s.content_json ?? {}) as TopicSynthesis;
    if (sSynth?.schemaVersion === 'topic-synthesis-v1') {
      await indexTopicForSearch({ id: s.id, workspaceId: s.workspace_id, spaceId: s.space_id, title: s.title }, sSynth, ai);
    }
  } catch {
    /* best-effort */
  }

  // The survivor gained the merged Topic's provenance — a real user-driven change.
  await recordActivity({ workspaceId: s.workspace_id, spaceId: s.space_id, entityType: 'topic', entityId: survivorId, eventType: 'added_to_source', userId, metadata: { fromMerge: mergedId } });

  return { operationId: op.id };
}

/**
 * Split selected keyPoints OUT of `topicId` into a NEW Topic. The new Topic keeps
 * the extracted keyPoints (with their real citations) and inherits the parent's
 * source provenance. `promotedFromTopicId` ties it back to the parent for
 * traceability. The operation is recorded with a pre-split synthesis snapshot so
 * it can be fully undone (Gate: 合并后可追溯和恢复 — also covers split).
 */
export async function splitTopic(topicId: string, newTitle: string, keyPointIds: string[], userId: string): Promise<{ topicId: string; operationId: string }> {
  if (!keyPointIds.length) throw new Error('no keyPoints selected to split');
  const topicRes = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`);
  const topic = topicRes.rows[0];
  if (!topic) throw new Error('topic not found');
  const synth = (topic.content_json ?? {}) as TopicSynthesis;
  if (synth?.schemaVersion !== 'topic-synthesis-v1') throw new Error('topic is not a structured synthesis');

  const extracted = synth.keyPoints.filter((k) => keyPointIds.includes(k.id));
  if (extracted.length === 0) throw new Error('none of the selected keyPoints exist on this topic');
  if (extracted.length === synth.keyPoints.length) throw new Error('cannot split all keyPoints out of a topic');

  const newSynth: TopicSynthesis = {
    ...synth,
    definition: extracted.map((k) => k.title).join('、').slice(0, 160),
    overview: extracted.map((k) => k.content).join(' ').slice(0, 600),
    keyPoints: extracted,
    subtopics: [],
    conflicts: [],
    decisions: [],
    openQuestions: []
  };
  const parentSynth: TopicSynthesis = { ...synth, keyPoints: synth.keyPoints.filter((k) => !keyPointIds.includes(k.id)) };

  // All data mutations run inside ONE transaction so a mid-split failure leaves
  // no orphan Topic / half-updated parent (Gate: 拆分可完整回滚). Reindex is
  // performed AFTER commit, best-effort.
  const [newTopic, op] = await db.transaction(async (tx) => {
    const [nt] = await tx
      .insert(wikiTopics)
      .values({
        workspaceId: topic.workspace_id,
        spaceId: topic.space_id,
        title: newTitle,
        contentJson: newSynth as unknown,
        textContent: extractTextFromSynthesis(newSynth),
        status: 'accepted',
        source: 'ai_generated',
        aiSummary: newSynth.definition || newSynth.overview.slice(0, 200),
        aliases: [normalizeTitle(newTitle)],
        normalizedTitle: normalizeTitle(newTitle),
        synthesisVersion: 'topic-synthesis-v1',
        createdById: userId,
        promotedFromTopicId: topicId,
        originSpaceId: topic.space_id,
        publicationStatus: 'accepted',
        freshnessStatus: 'fresh',
        lifecycleStatus: 'active'
      })
      .returning();

    // Inherit the parent's source provenance for the new Topic.
    const sources = await tx.execute<any>(sql`SELECT page_id, chunk_id, source_content_version, source_type, relevance_score, evidence_excerpt, added_by, contribution_type FROM topic_sources WHERE topic_id = ${topicId}`);
    if (sources.rows.length > 0) {
      await tx.insert(topicSources).values(
        sources.rows.map((r: Record<string, unknown>) => ({
          topicId: nt.id,
          pageId: r.page_id as string,
          chunkId: (r.chunk_id as string) ?? null,
          sourceContentVersion: (r.source_content_version as number) ?? null,
          sourceType: (r.source_type as string) ?? 'page',
          relevanceScore: (r.relevance_score as number) ?? null,
          evidenceExcerpt: (r.evidence_excerpt as string) ?? null,
          addedBy: (r.added_by as string) ?? 'ai',
          contributionType: (r.contribution_type as string) ?? 'key_point'
        }))
      );
    }

    // Parent loses the extracted keyPoints.
    await tx.execute(sql`
      UPDATE wiki_topics
      SET content_json = ${JSON.stringify(parentSynth)}::jsonb, text_content = ${extractTextFromSynthesis(parentSynth)},
          ai_summary = ${(parentSynth.definition || parentSynth.overview).slice(0, 500)}, updated_at = now()
      WHERE id = ${topicId}
    `);

    const [operation] = await tx
      .insert(topicOperations)
      .values({
        workspaceId: topic.workspace_id,
        spaceId: topic.space_id,
        operationType: 'split',
        topicId,
        targetTopicId: nt.id,
        createdById: userId,
        payload: { extractedKeyPointIds: keyPointIds, newTitle, parentSynthesisBefore: synth }
      })
      .returning();

    return [nt, operation];
  });

  // The split spawned a Topic carrying inherited sources — a real user action.
  await recordActivity({ workspaceId: topic.workspace_id, spaceId: topic.space_id, entityType: 'topic', entityId: newTopic.id, eventType: 'added_to_source', userId, metadata: { fromSplit: topicId } });

  // Re-index both topics for RAG (network call outside the transaction).
  try {
    const ai = await createAiProviderForContext({ workspaceId: topic.workspace_id, spaceId: topic.space_id });
    await indexTopicForSearch(newTopic, newSynth, ai);
    await indexTopicForSearch(topic, parentSynth, ai);
  } catch {
    /* best-effort */
  }

  return { topicId: newTopic.id, operationId: op.id };
}

/**
 * Undo a recorded merge / split operation. Restores the prior state exactly:
 *   - merge: re-point chunks + sources back to the merged (stub) Topic, restore
 *     its lifecycle/status, and re-index both Topics.
 *   - split: delete the spawned Topic (+ its chunks/sources) and restore the
 *     parent's pre-split synthesis snapshot, then re-index the parent.
 * Idempotent: a previously-undone operation is a no-op.
 */
export async function undoTopicOperation(operationId: string, userId: string): Promise<void> {
  const [op] = await db.select().from(topicOperations).where(eq(topicOperations.id, operationId)).limit(1);
  if (!op) throw new Error('operation not found');
  if (op.undoneAt) return; // already undone

  // IDs needed for the post-commit re-index (network calls stay outside the tx).
  let mergedId: string | undefined;
  let survivorId: string | undefined;
  let parentId: string | undefined;
  const p = (op.payload ?? {}) as {
    movedKeys?: string[];
    droppedRows?: Record<string, unknown>[];
    chunkIds?: string[];
    previousMerged?: { lifecycleStatus: string; status: string; publicationStatus: string; title: string };
    parentSynthesisBefore?: TopicSynthesis;
  };

  // Every restoration write runs inside ONE transaction so an interrupted undo
  // cannot leave a half-restored Topic (Gate: 撤销可完整回滚). Reindex happens
  // after commit, best-effort.
  await db.transaction(async (tx) => {
    if (op.operationType === 'merge') {
      mergedId = op.topicId!;
      survivorId = op.targetTopicId!;
      // Move chunks back to the merged topic.
      if (p.chunkIds?.length) {
        await tx.execute(sql`UPDATE document_chunks SET topic_id = ${mergedId}::uuid WHERE topic_id = ${survivorId} AND id = ANY(ARRAY[${sql.join(p.chunkIds.map((id) => sql`${id}::uuid`), sql`, `)}])`);
      }
      // Move the (previously moved) sources back.
      if (p.movedKeys?.length) {
        await tx.execute(sql`UPDATE topic_sources SET topic_id = ${mergedId}::uuid WHERE topic_id = ${survivorId} AND page_id = ANY(ARRAY[${sql.join(p.movedKeys.map((id) => sql`${id}::uuid`), sql`, `)}])`);
      }
      // Re-insert the dropped (duplicate) sources under the merged topic.
      for (const row of p.droppedRows ?? []) {
        await tx.insert(topicSources).values({
          topicId: mergedId,
          pageId: row.page_id as string,
          chunkId: (row.chunk_id as string) ?? null,
          sourceContentVersion: (row.source_content_version as number) ?? null,
          sourceType: (row.source_type as string) ?? 'page',
          relevanceScore: (row.relevance_score as number) ?? null,
          evidenceExcerpt: (row.evidence_excerpt as string) ?? null,
          addedBy: (row.added_by as string) ?? 'ai',
          contributionType: (row.contribution_type as string) ?? 'key_point'
        }).onConflictDoNothing();
      }
      // Restore the merged topic from its redirect-stub state.
      const prev = p.previousMerged;
      await tx.execute(sql`
        UPDATE wiki_topics
        SET merged_into_topic_id = NULL, merged_at = NULL, merged_by_id = NULL,
            lifecycle_status = ${prev?.lifecycleStatus ?? 'active'},
            status = ${prev?.status ?? 'accepted'},
            publication_status = ${prev?.publicationStatus ?? 'accepted'},
            updated_at = now()
        WHERE id = ${mergedId}
      `);
    } else if (op.operationType === 'split') {
      parentId = op.topicId!;
      const newTopicId = op.targetTopicId!;
      // Delete the spawned topic and its chunks / sources.
      await tx.execute(sql`DELETE FROM document_chunks WHERE topic_id = ${newTopicId}::uuid`);
      await tx.execute(sql`DELETE FROM topic_sources WHERE topic_id = ${newTopicId}::uuid`);
      await tx.execute(sql`DELETE FROM wiki_topics WHERE id = ${newTopicId}::uuid`);
      // Restore the parent's pre-split synthesis.
      if (p.parentSynthesisBefore) {
        await tx.execute(sql`
          UPDATE wiki_topics
          SET content_json = ${JSON.stringify(p.parentSynthesisBefore)}::jsonb,
              text_content = ${extractTextFromSynthesis(p.parentSynthesisBefore)},
              ai_summary = ${(p.parentSynthesisBefore.definition || p.parentSynthesisBefore.overview).slice(0, 500)},
              updated_at = now()
          WHERE id = ${parentId}
        `);
      }
    } else if (op.operationType === 'derive') {
      // Derive copies the original (which is left untouched), so undo simply
      // removes the derived Topic and its chunks / sources. Nothing to restore on
      // the original — its history stays fully intact (gate: 原项目历史完整).
      const derivedId = op.targetTopicId!;
      await tx.execute(sql`DELETE FROM document_chunks WHERE topic_id = ${derivedId}::uuid`);
      await tx.execute(sql`DELETE FROM topic_sources WHERE topic_id = ${derivedId}::uuid`);
      await tx.execute(sql`DELETE FROM wiki_topics WHERE id = ${derivedId}::uuid`);
    }

    await tx.execute(sql`UPDATE topic_operations SET undone_at = now(), undone_by_id = ${userId}::uuid WHERE id = ${operationId}`);
  });

  // Re-index AFTER commit (network calls outside the transaction).
  try {
    const ai = await createAiProviderForContext({ workspaceId: op.workspaceId, spaceId: op.spaceId });
    if (op.operationType === 'merge') {
      const mergedRow = (await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${mergedId} LIMIT 1`)).rows[0];
      const survivorRow = (await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${survivorId} LIMIT 1`)).rows[0];
      if (mergedRow && (mergedRow.content_json ?? {}).schemaVersion === 'topic-synthesis-v1') {
        await indexTopicForSearch({ id: mergedRow.id, workspaceId: mergedRow.workspace_id, spaceId: mergedRow.space_id, title: mergedRow.title }, mergedRow.content_json as TopicSynthesis, ai);
      }
      if (survivorRow && (survivorRow.content_json ?? {}).schemaVersion === 'topic-synthesis-v1') {
        await indexTopicForSearch({ id: survivorRow.id, workspaceId: survivorRow.workspace_id, spaceId: survivorRow.space_id, title: survivorRow.title }, survivorRow.content_json as TopicSynthesis, ai);
      }
    } else if (op.operationType === 'split' && p.parentSynthesisBefore) {
      const parentRow = (await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${parentId} LIMIT 1`)).rows[0];
      await indexTopicForSearch({ id: parentRow.id, workspaceId: parentRow.workspace_id, spaceId: parentRow.space_id, title: parentRow.title }, p.parentSynthesisBefore, ai);
    }
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------- Phase 5: archive center -------- */

/**
 * Archive a Topic (deliberate user action — the "归档中心" recovery path). Sets
 * lifecycle_status='archived' and records who/when/why. Archiving is NOT deletion
 * (spec rule 10): the Topic stays searchable and citable, just down-weighted.
 */
export async function archiveTopic(topicId: string, userId: string, reason = 'manual'): Promise<void> {
  await db.execute(sql`
    UPDATE wiki_topics
    SET lifecycle_status = 'archived', status = 'archived',
        archived_at = now(), archived_by_id = ${userId}::uuid, archive_reason = ${reason},
        updated_at = now()
    WHERE id = ${topicId}::uuid
  `);
}

/**
 * Reactivate an archived Topic (the recovery half of the archive center). Restores
 * it to 'active' and stamps last_meaningful_activity_at so lifecycle evaluation
 * no longer flags it. A real user action, so activity is recorded.
 */
export async function reactivateTopic(topicId: string, userId: string): Promise<void> {
  const [topic] = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`).then((r) => [r.rows[0]]);
  if (!topic) throw new Error('topic not found');
  await db.execute(sql`
    UPDATE wiki_topics
    SET lifecycle_status = 'active',
        status = CASE WHEN status = 'archived' THEN 'accepted' ELSE status END,
        archived_at = NULL, archived_by_id = NULL, archive_reason = NULL,
        last_meaningful_activity_at = now(), updated_at = now()
    WHERE id = ${topicId}::uuid
  `);
  await recordActivity({ workspaceId: topic.workspace_id, spaceId: topic.space_id, entityType: 'topic', entityId: topicId, eventType: 'view', userId, metadata: { reactivated: true } });
}

/**
 * Phase B (B2.3): soft-delete a Topic. We NEVER hard-delete — deletion is an
 * archive with reason 'deleted' (plus deleted_at/deleted_by_id) so the Topic
 * stays auditable and recoverable via `reactivateTopic`. It is therefore hidden
 * from the default list (which excludes lifecycle='archived') but still
 * reachable through `?lifecycle=archived`.
 */
export async function deleteTopic(topicId: string, userId: string): Promise<void> {
  const [topic] = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`).then((r) => [r.rows[0]]);
  if (!topic) throw new Error('topic not found');
  await db.execute(sql`
    UPDATE wiki_topics
    SET lifecycle_status = 'archived', status = 'archived',
        archived_at = now(), archived_by_id = ${userId}::uuid, archive_reason = 'deleted',
        deleted_at = now(), deleted_by_id = ${userId}::uuid,
        updated_at = now()
    WHERE id = ${topicId}::uuid
  `);
  await recordActivity({ workspaceId: topic.workspace_id, spaceId: topic.space_id, entityType: 'topic', entityId: topicId, eventType: 'view', userId, metadata: { deleted: true } });
}
