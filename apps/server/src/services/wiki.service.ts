import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { llmSuggestions } from '@mindloom/db';
import { createAiProviderForContext } from './ai.service';
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
  for (const cn of text.match(/[一-鿿]{2,}/g) ?? []) s.add(cn);
  for (const w of text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []) s.add(w);
  return s;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
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

async function findOrCreateTopic(
  page: { workspace_id: string; space_id: string; updated_by_id: string },
  title: string,
  summary: string
): Promise<{ id: string; isNew: boolean }> {
  const existing = await db.execute<any>(sql`
    SELECT id FROM wiki_topics WHERE space_id = ${page.space_id} AND lower(title) = lower(${title}) LIMIT 1
  `);
  if (existing.rows.length) return { id: existing.rows[0].id, isNew: false };

  const inserted = await db.execute<any>(sql`
    INSERT INTO wiki_topics(workspace_id, space_id, title, content_json, text_content, status, source, ai_summary, created_by_id)
    VALUES (${page.workspace_id}, ${page.space_id}, ${title}, '{"type":"doc","content":[]}'::jsonb, '', 'suggested', 'ai_generated', ${summary}, ${page.updated_by_id})
    RETURNING id
  `);
  return { id: inserted.rows[0].id, isNew: true };
}

async function linkSource(topicId: string, pageId: string) {
  await db.execute(sql`
    INSERT INTO topic_sources(topic_id, page_id) VALUES (${topicId}, ${pageId}) ON CONFLICT DO NOTHING
  `);
}

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
  extra: { topicId?: string; targetPageId?: string }
): Promise<boolean> {
  const conditions = [
    eq(llmSuggestions.spaceId, spaceId),
    eq(llmSuggestions.type, type),
    eq(llmSuggestions.status, 'pending')
  ];
  if (extra.topicId) conditions.push(eq(llmSuggestions.topicId, extra.topicId));
  if (extra.targetPageId) conditions.push(eq(llmSuggestions.pageId, extra.targetPageId));
  const rows = await db
    .select({ one: sql`1` })
    .from(llmSuggestions)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
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

  for (const cand of candidates) {
    const { id: topicId, isNew } = await findOrCreateTopic(page, cand.title, cand.summary);
    await linkSource(topicId, page.id);
    // M6: a topic "covers" the page it was derived from -> a graph edge.
    await upsertEdge({
      workspaceId: page.workspace_id, spaceId: page.space_id,
      sourceType: 'topic', sourceId: topicId, targetType: 'page', targetId: page.id,
      relationType: 'covers', confidence: 70, evidence: { generatedFrom: page.title }
    });

    // Only surface a proposal suggestion for genuinely new topics so the inbox
    // does not re-flag the same topic on every edit.
    if (isNew && !(await hasPendingSuggestion(page.space_id, 'topic_proposal', { topicId }))) {
      await db.execute(sql`
        INSERT INTO llm_suggestions(workspace_id, space_id, page_id, topic_id, type, risk, status, payload, evidence)
        VALUES (
          ${page.workspace_id}, ${page.space_id}, ${page.id}, ${topicId}, 'topic_proposal', 'low', 'pending',
          ${JSON.stringify({
            topicId, topicTitle: cand.title, topicSummary: cand.summary, sourcePageId: page.id,
            changes: `创建主题「${cand.title}」并关联本页`,
            reason: cand.summary || 'AI 从笔记中提炼出的候选主题，审阅后可纳入知识库。',
            evidence: { sourcePageId: page.id, sourcePageTitle: page.title }
          })}::jsonb,
          ${JSON.stringify({ generatedFrom: page.title })}::jsonb
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
    await db.execute(sql`UPDATE wiki_topics SET status = 'stale', updated_at = now() WHERE id = ${t.id}`);

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
 * Regenerate a stale topic's summary from its *current* source pages and clear
 * the stale flag. Invoked by the `topic.refresh_suggestions` job (triggered
 * from the UI "refresh" action). Best-effort: on any AI failure we keep the
 * existing summary and still clear the stale state so the user is unblocked.
 */
export async function refreshTopicSuggestions(topicId: string): Promise<void> {
  const topicRes = await db.execute<any>(sql`SELECT * FROM wiki_topics WHERE id = ${topicId} LIMIT 1`);
  const topic = topicRes.rows[0];
  if (!topic) return;

  const src = await db.execute<any>(sql`
    SELECT p.text_content FROM topic_sources ts
    JOIN pages p ON p.id = ts.page_id
    WHERE ts.topic_id = ${topicId}
    ORDER BY p.updated_at DESC LIMIT 20
  `);
  const text = src.rows.map((r: { text_content: string }) => r.text_content).join('\n\n').slice(0, 4000);

  let summary = topic.ai_summary as string;
  if (text.trim()) {
    try {
      const ai = await createAiProviderForContext({ workspaceId: topic.workspace_id, spaceId: topic.space_id });
      const out = await ai.generateText([
        { role: 'system', content: '用一句话概括以下资料的主题要点。只输出文本，不要使用 JSON。' },
        { role: 'user', content: text.slice(0, 2000) }
      ]);
      if (out && out.trim()) summary = out.trim().slice(0, 500);
    } catch {
      /* keep the previous summary */
    }
  }

  await db.execute(sql`
    UPDATE wiki_topics
    SET ai_summary = ${summary}, status = 'accepted', last_ai_refresh_at = now(),
        ai_version = 'refreshed', updated_at = now()
    WHERE id = ${topicId}
  `);
  // Clear the stale suggestion that prompted this refresh.
  await db.execute(sql`
    UPDATE llm_suggestions SET status = 'ignored', updated_at = now()
    WHERE topic_id = ${topicId} AND type = 'stale_topic' AND status = 'pending'
  `);
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
