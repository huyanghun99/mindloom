import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

const EMPTY_XML =
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="800" pageHeight="600" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

const DRAWIO_URL =
  'https://embed.diagrams.net/?embed=1&ui=kennedy&proto=json&noSaveBtn=0&noExitBtn=0&saveAndExit=0&spin=1&libraries=1';

function DrawioView({ node, updateAttributes, selected }: NodeViewProps) {
  const xml = (node.attrs.xml as string) || '';
  const preview = (node.attrs.preview as string) || '';
  const [open, setOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const xmlRef = useRef(xml);
  xmlRef.current = xml;
  const sentLoadRef = useRef(false);

  const sendLoad = () => {
    if (sentLoadRef.current) return;
    sentLoadRef.current = true;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ action: 'load', xml: xmlRef.current || EMPTY_XML }),
      '*'
    );
  };

  useEffect(() => {
    if (!open) return;
    sentLoadRef.current = false;
    const handler = (e: MessageEvent) => {
      let msg: { event?: string; xml?: string; data?: unknown } | null = null;
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.event) {
        case 'init':
        case 'load':
          sendLoad();
          break;
        case 'save': {
          const newXml = msg.xml ?? (typeof msg.data === 'string' ? msg.data : '') ?? '';
          updateAttributes({ xml: newXml });
          // Request an SVG export so we can render a preview inside the note.
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: 'export', format: 'xmlsvg', xml: newXml }),
            '*'
          );
          break;
        }
        case 'export': {
          if (typeof msg.data === 'string') updateAttributes({ preview: msg.data });
          break;
        }
        case 'exit':
          setOpen(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [open]);

  return (
    <NodeViewWrapper
      className={`drawio-block${selected ? ' ProseMirror-selectednode' : ''}`}
      data-drag-handle
    >
      <div className="drawio-bar" contentEditable={false}>
        <span className="drawio-badge">Draw.io 流程图</span>
        <button
          type="button"
          className="drawio-act"
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          编辑图表
        </button>
      </div>
      {preview ? (
        <div className="drawio-preview" contentEditable={false} onDoubleClick={() => setOpen(true)}>
          <img src={preview} alt="diagram" />
        </div>
      ) : (
        <div className="drawio-empty" contentEditable={false} onDoubleClick={() => setOpen(true)}>
          点击「编辑图表」打开 Draw.io 编辑器绘制流程图
        </div>
      )}

      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal drawio-modal">
            <div className="modal-head">
              <span>Draw.io 编辑器</span>
              <button
                type="button"
                className="modal-close"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                }}
              >
                ×
              </button>
            </div>
            <iframe
              ref={iframeRef}
              className="drawio-frame"
              src={DRAWIO_URL}
              title="Draw.io"
              onLoad={() => setTimeout(sendLoad, 1200)}
            />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export { DrawioView };
