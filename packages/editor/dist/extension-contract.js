export const mermaidExtensionContract = {
    name: 'Mermaid',
    nodeType: 'codeBlock',
    insertCommand: 'insertMermaid',
    isIndexableByLlm: true,
    toTextContent(node) {
        return typeof node.text === 'string' ? node.text : '';
    }
};
export const katexExtensionContract = {
    name: 'KaTeX',
    nodeType: 'mathBlock',
    insertCommand: 'insertMathBlock',
    isIndexableByLlm: true,
    toTextContent(node) {
        return String(node.attrs?.text ?? '');
    }
};
export const drawioExtensionContract = {
    name: 'Draw.io',
    nodeType: 'drawio',
    insertCommand: 'insertDrawio',
    isIndexableByLlm: false,
    toTextContent(node) {
        return String(node.attrs?.title ?? 'Draw.io diagram');
    },
    getAttachments(node) {
        const attachmentId = String(node.attrs?.attachmentId ?? '');
        if (!attachmentId)
            return [];
        return [{ attachmentId, fileName: String(node.attrs?.title ?? 'diagram.drawio.svg') }];
    }
};
export const excalidrawExtensionContract = {
    name: 'Excalidraw',
    nodeType: 'excalidraw',
    insertCommand: 'insertExcalidraw',
    isIndexableByLlm: false,
    toTextContent(node) {
        return String(node.attrs?.title ?? 'Excalidraw diagram');
    },
    getAttachments(node) {
        const attachmentId = String(node.attrs?.attachmentId ?? '');
        if (!attachmentId)
            return [];
        return [{ attachmentId, fileName: String(node.attrs?.title ?? 'diagram.excalidraw.svg') }];
    }
};
