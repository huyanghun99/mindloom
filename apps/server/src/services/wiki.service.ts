import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { pages, wikiTopics, topicSources, llmSuggestions } from '@mindloom/db';
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
  const conds: string[] = [`space_id = ${spaceId}`, `type = ${type}`, `status = 'pending'`];
  if (extra.topicId) conds.push(`topic_id = ${extra.topicId}`);
  if (extra.targetPageId) conds.push(`page_id = ${extra.targetPageId}`);
  const rows = await db.execute<any>(sql`
    SELECT 1 FROM llm_suggestions WHERE ${sql.raw(conds.join(' AND '))} LIMIT 1
  `);
  return rows.rows.length > 0;
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
          ${JSON.stringify({ topicId, topicTitle: cand.title, topicSummary: cand.summary, sourcePageId: page.id })}::jsonb,
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
        ${JSON.stringify({ sourcePageId: page.id, targetPageId: other.id, targetPageTitle: other.title, reason: '内容主题高度相关', sharedTerms: [] })}::jsonb,
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
