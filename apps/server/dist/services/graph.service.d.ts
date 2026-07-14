export declare function getGraphForEntity(params: {
    workspaceId: string;
    spaceId: string;
    sourceType: string;
    sourceId: string;
}): Promise<Record<string, unknown>[]>;
export declare function getEvidenceCard(edgeId: string): Promise<Record<string, unknown>>;
