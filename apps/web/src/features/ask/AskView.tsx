import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Brain, Loader2, Send } from 'lucide-react';
import { post } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import type { Space, Workspace } from '../../types';

type Citation = { chunkId?: string; pageId?: string; title: string; excerpt: string };

// Render the answer while turning inline [n] citation markers into clickable
// badges that jump to the referenced source page (strict-citation UX).
function renderAnswer(answer: string, citations: Citation[], onOpen: (pageId: string) => void) {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const c = citations[Number(m[1]) - 1];
      const pid = c?.pageId;
      return (
        <button
          key={i}
          className="cite-badge"
          title={c?.title ?? `引用 ${m[1]}`}
          onClick={() => pid && onOpen(pid)}
        >
          {m[1]}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function AskView({ workspace, space, onOpenPage }: { workspace: Workspace; space: Space; onOpenPage: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [extended, setExtended] = useState(false);
  const mutation = useMutation({
    mutationFn: () => post<{ answer: string; citations: Citation[] }>('/api/rag/ask', {
      workspaceId: workspace.id, spaceId: space.id, query, limit: 5, extendedThinking: extended
    })
  });
  return (
    <div className="single-pane">
      <div className="ask-head">
        <h3><Brain size={18} /> 带引用的问答 <span className="tag">strict citation</span></h3>
        <label className="switch">
          <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} />
          扩展思考
        </label>
      </div>
      <div className="search-bar">
        <input autoFocus value={query} placeholder="向你的知识库提问…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) mutation.mutate(); }} />
        <button className="primary" disabled={!query.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />} 提问
        </button>
      </div>
      {mutation.error && <p className="error">{String((mutation.error as Error).message)}</p>}
      {mutation.data && (
        <div className="answer-card">
          <p className="answer-text">{renderAnswer(mutation.data.answer, mutation.data.citations ?? [], onOpenPage)}</p>
          {mutation.data.citations?.length > 0 && (
            <>
              <h4>引用来源（点击跳转原文）</h4>
              {mutation.data.citations.map((c, i) => (
                <blockquote
                  key={c.chunkId ?? i}
                  className="citation"
                  onClick={() => c.pageId && onOpenPage(c.pageId)}
                >
                  <b>{c.title}</b> <span className="muted small">[{i + 1}]</span>
                  <span>{c.excerpt}</span>
                </blockquote>
              ))}
            </>
          )}
        </div>
      )}
      {!mutation.data && !mutation.isPending && !mutation.error && (
        <EmptyState icon={<Brain size={32} />} title="向知识库提问" hint="回答会附带可点击的引用来源，便于回到原文核对。" />
      )}
    </div>
  );
}
