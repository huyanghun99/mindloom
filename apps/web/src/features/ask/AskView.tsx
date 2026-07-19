import { useRef, useState } from 'react';
import { Brain, Loader2, Send } from 'lucide-react';
import { streamRag } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import type { Space, Workspace } from '../../types';

type Citation = { chunkId?: string; pageId?: string; title?: string; excerpt?: string };

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
        <button key={i} className="cite-badge" title={c?.title ?? `引用 ${m[1]}`} onClick={() => pid && onOpen(pid)}>
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
  const [sources, setSources] = useState<Citation[]>([]);
  const [answer, setAnswer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = () => {
    if (!query.trim() || streaming) return;
    setStreaming(true);
    setSources([]);
    setAnswer('');
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    streamRag(
      { workspaceId: workspace.id, spaceId: space.id, query, extendedThinking: extended },
      (ev) => {
        if (ev.type === 'sources') setSources(ev.citations as Citation[]);
        else if (ev.type === 'token') setAnswer((a) => a + ev.text);
        else if (ev.type === 'error') { setError(ev.message); setStreaming(false); }
        else if (ev.type === 'done') setStreaming(false);
      },
      ac.signal
    ).catch(() => setStreaming(false));
  };

  const openChunk = (c: Citation) => { if (c.pageId) onOpenPage(c.pageId); };

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
          onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) ask(); }} />
        <button className="primary" disabled={!query.trim() || streaming} onClick={ask}>
          {streaming ? <Loader2 className="spin" size={15} /> : <Send size={15} />} 提问
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {(sources.length > 0 || answer) && (
        <div className="answer-card">
          {sources.length > 0 && (
            <div className="rp-ai-cites">
              <span className="muted small">来源（先出现，可点击跳转）</span>
              <div className="cite-list">
                {sources.map((c, i) => (
                  <button key={c.chunkId ?? i} className="src-chip" title={c.excerpt} onClick={() => openChunk(c)}>
                    <span className="cite-idx">[{i + 1}]</span> {c.title || '来源'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {answer && <p className="answer-text">{renderAnswer(answer, sources, onOpenPage)}</p>}
          {streaming && <span className="stream-cursor" />}
        </div>
      )}

      {!streaming && sources.length === 0 && !answer && !error && (
        <EmptyState icon={<Brain size={32} />} title="向知识库提问" hint="回答会先列出引用来源，再逐步生成内容，便于回到原文核对。" />
      )}
    </div>
  );
}
