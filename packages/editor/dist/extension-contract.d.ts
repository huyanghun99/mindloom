export interface AttachmentRef {
    attachmentId: string;
    fileName: string;
    mimeType?: string;
    url?: string;
}
export interface EditorNodeLike {
    type: string;
    attrs?: Record<string, unknown>;
    text?: string;
    content?: EditorNodeLike[];
}
export interface EditorBlockExtension {
    name: string;
    nodeType: string;
    insertCommand: string;
    toTextContent(node: EditorNodeLike): string;
    toMarkdown?(node: EditorNodeLike): string;
    toHtml?(node: EditorNodeLike): string;
    getAttachments?(node: EditorNodeLike): AttachmentRef[];
    isIndexableByLlm: boolean;
}
export declare const mermaidExtensionContract: EditorBlockExtension;
export declare const katexExtensionContract: EditorBlockExtension;
export declare const drawioExtensionContract: EditorBlockExtension;
export declare const excalidrawExtensionContract: EditorBlockExtension;
