export interface IndexabilityRule {
    contentType: string;
    fullText: boolean;
    vector: boolean;
    llmWiki: boolean;
    export: boolean;
    print: boolean;
    notes: string;
}
export declare const contentIndexabilityMatrix: IndexabilityRule[];
