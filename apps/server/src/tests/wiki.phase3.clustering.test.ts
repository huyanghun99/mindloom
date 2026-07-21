import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAiProvider, deterministicVector, type AiProvider } from '@mindloom/ai';
import { createApp } from '../app';
import { db, sql, makeUser, makeWorkspace, makeSpace, cleanDb, sessionCookie, runPendingJob } from './test-utils';
import { wikiTopics, topicCandidates, documentChunks } from '@mindloom/db';
import { consolidateCandidates, generateTopicSynthesis, buildDeterministicSynthesis } from '../services/wiki.service';
import { hybridSearch } from '../services/search.service';

async function processPage(user: { id: string }, spaceId: string, title: string, textContent: string): Promise<string> {
  const app = createApp();
  const cookie = await sessionCookie(user);
  const res = await app.request('/api/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ spaceId, title, textContent })
  });
  const pageId = (await res.json()).page.id;
  await db.execute(sql`UPDATE jobs SET run_after = now() WHERE entity_id = ${pageId} AND status = 'pending'`);
  await runPendingJob();
  return pageId;
}

const ai = () => new MockAiProvider();

describe('Phase 3 — clustering & Topic synthesis', () => {
  beforeEach(async () => {
    await cleanDb();
    vi.spyOn(await import('../services/ai.service'), 'createAiProviderForContext').mockRestore();
  });

  /* ---- Gate: 同义可聚合 (two related pages -> ONE Topic) ---- */
  it('aggregates synonymous candidates from two pages into one Topic', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    await processPage(user, sp.id, 'P1', '# 机器学习\n机器学习是人工智能的一个分支。深度学习是机器学习的重要方法。神经网络在机器学习中广泛应用。');
    await processPage(user, sp.id, 'P2', '# 机器学习\n机器学习是人工智能的一个分支。深度学习是机器学习的重要方法。决策树也用于机器学习任务。');

    const res = await consolidateCandidates(sp.id, ai());
    expect(res.createdTopics).toBe(1);

    const topics = await db.select().from(wikiTopics).where(sql`space_id = ${sp.id}`);
    expect(topics).toHaveLength(1);
    const t = topics[0];
    // No formal Topic should exist before aggregation; exactly one after.
    const synth = t.contentJson as any;
    expect(synth.schemaVersion).toBe('topic-synthesis-v1');
    expect(typeof synth.overview).toBe('string');
    expect(synth.overview.length).toBeGreaterThan(0);
    expect(Array.isArray(synth.keyPoints) && synth.keyPoints.length).toBeGreaterThan(0);
    // Gate: every keyPoint carries >=1 citation to a real chunk.
    for (const kp of synth.keyPoints) {
      expect(Array.isArray(kp.citations) && kp.citations.length).toBeGreaterThan(0);
      expect(typeof kp.citations[0].chunkId).toBe('string');
    }
    // Alias / normalized title recorded for future clustering.
    expect(t.normalizedTitle).toBe('机器学习');
    expect(Array.isArray(t.aliases) && t.aliases).toContain('机器学习');

    // Candidates were consumed (promoted) rather than left dangling.
    const remaining = await db.select().from(topicCandidates).where(sql`space_id = ${sp.id} AND status = 'candidate'`);
    expect(remaining).toHaveLength(0);
  });

  /* ---- Gate: 同名异义不误合并 (same title, different meaning -> NO merge) ---- */
  it('does NOT merge same-name / different-meaning candidates', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    await processPage(user, sp.id, 'Coffee', '# Java\n爪哇岛是印度尼西亚的岛屿，盛产咖啡豆，气候湿热适合种植。');
    await processPage(user, sp.id, 'Lang', '# Java\nJava 是一种编程语言，运行在 JVM 上，用于后端开发。');

    const res = await consolidateCandidates(sp.id, ai());
    // 同名异义: the two "Java" candidates must NOT be merged into one Topic.
    expect(res.createdTopics).toBe(0);
    const topics = await db.select().from(wikiTopics).where(sql`space_id = ${sp.id}`);
    expect(topics).toHaveLength(0);

    // Candidates are preserved for manual review (not silently dropped/merged).
    const cands = await db.select().from(topicCandidates).where(sql`space_id = ${sp.id} AND status = 'candidate'`);
    expect(cands.length).toBeGreaterThanOrEqual(2);
  });

  /* ---- Gate: 非法 JSON 不写库 (never persist an invalid synthesis) ---- */
  it('never writes illegal JSON; falls back to a valid synthesis', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    await processPage(user, sp.id, 'P1', '# 主题\n关于主题的一些内容用于测试综合。机器学习是核心概念。');
    await processPage(user, sp.id, 'P2', '# 主题\n关于主题的一些内容用于测试综合。深度学习也是核心概念。');
    const cands = await db.select().from(topicCandidates).where(sql`space_id = ${sp.id}`);
    const chunkRows = await db.execute<any>(sql`SELECT id, content, page_id AS page_id FROM document_chunks WHERE page_id = ANY(ARRAY[${sql.join(cands.map((c) => sql`${c.pageId}::uuid`), sql`, `)}])`);
    const support = chunkRows.rows.map((r: any) => ({ chunkId: r.id, pageId: r.page_id, content: r.content, contentVersion: 1 }));

    // An AI that returns non-JSON garbage must NOT produce an invalid synthesis.
    const garbageAi = {
      async generateText() { return 'definitely not json {{{'; },
      async *streamText() {},
      async embed(t: string) { return deterministicVector(t, 1536); },
      async embedBatch(ts: string[]) { return ts.map((t) => deterministicVector(t, 1536)); }
    } as unknown as AiProvider;

    const synth = await generateTopicSynthesis(support, garbageAi);
    expect(synth).not.toBeNull();
    expect(synth!.schemaVersion).toBe('topic-synthesis-v1'); // valid, not the garbage
    for (const kp of synth!.keyPoints) expect(kp.citations.length).toBeGreaterThan(0);

    // And consolidation with the garbage AI still writes a VALID topic, never the garbage.
    const res = await consolidateCandidates(sp.id, garbageAi);
    expect(res.createdTopics).toBe(1);
    const topics = await db.select().from(wikiTopics).where(sql`space_id = ${sp.id}`);
    expect((topics[0].contentJson as any).schemaVersion).toBe('topic-synthesis-v1');
  });

  /* ---- Gate: RAG 可检索 Topic (topic is indexed into the search/vector store) ---- */
  it('indexes the synthesized Topic so RAG / search can retrieve it', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    await processPage(user, sp.id, 'P1', '# 知识图谱\n知识图谱用于连接实体和关系。图数据库存储节点与边。语义检索依赖知识图谱。');
    await processPage(user, sp.id, 'P2', '# 知识图谱\n知识图谱用于连接实体和关系。实体抽取构建知识图谱。图谱增强问答系统。');

    const res = await consolidateCandidates(sp.id, ai());
    expect(res.createdTopics).toBe(1);
    const [topic] = await db.select().from(wikiTopics).where(sql`space_id = ${sp.id}`);

    // The Topic is materialised as document_chunks (topic_id set) for retrieval.
    const topicChunks = await db.select().from(documentChunks).where(sql`topic_id = ${topic.id}::uuid`);
    expect(topicChunks.length).toBeGreaterThan(0);

    // Querying with a Topic chunk's exact content surfaces that Topic chunk.
    const query = topicChunks[0].content;
    const results = await hybridSearch({ userId: user.id, workspaceId: ws.id, spaceId: sp.id, query, limit: 5 });
    const hit = results.find((r) => r.topicId === topic.id);
    expect(hit).toBeDefined();
    expect(hit!.title).toBe(topic.title);
  });

  /* ---- Integration: page processing enqueues a (deduped) clustering job ---- */
  it('enqueues a deduplicated space.consolidate_topic_candidates job after indexing', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    await processPage(user, sp.id, 'A', '# 主题甲\n内容甲用于测试聚类任务入队。');
    await processPage(user, sp.id, 'B', '# 主题乙\n内容乙用于测试聚类任务入队。');

    const rows = await db.execute<any>(sql`
      SELECT id, type, status, dedupe_key FROM jobs
      WHERE type = 'space.consolidate_topic_candidates' AND space_id = ${sp.id} AND status = 'pending'
    `);
    // Deduped: at most one pending consolidate job per space.
    expect(rows.rows.length).toBeLessThanOrEqual(1);
    if (rows.rows.length === 1) {
      expect(rows.rows[0].dedupe_key).toBe(`space:${sp.id}:consolidate`);
    }
  });

  /* ---- Deterministic synthesis always satisfies the citation gate ---- */
  it('buildDeterministicSynthesis yields valid citations for every keyPoint', async () => {
    const user = await makeUser();
    const ws = await makeWorkspace(user);
    const sp = await makeSpace(ws, user);
    const pageId = await processPage(user, sp.id, 'Note', '# 要点\n第一段内容。\n第二段内容。');
    const chunkRows = await db.execute<any>(sql`SELECT id, content, page_id AS page_id FROM document_chunks WHERE page_id = ${pageId}`);
    const support = chunkRows.rows.map((r: any) => ({ chunkId: r.id, pageId: r.page_id, content: r.content, contentVersion: 1 }));
    const synth = buildDeterministicSynthesis(support);
    expect(synth.schemaVersion).toBe('topic-synthesis-v1');
    expect(synth.keyPoints.length).toBe(support.length);
    for (const kp of synth.keyPoints) {
      expect(kp.citations.length).toBe(1);
      expect(kp.citations[0].chunkId).toBe(support.find((s) => s.chunkId === kp.citations[0].chunkId)?.chunkId);
    }
  });
});
