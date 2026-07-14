import { HybridSearchResult } from '@mindloom/shared';
export declare function hybridSearch(params: {
    userId: string;
    workspaceId: string;
    spaceId?: string;
    query: string;
    limit: number;
}): Promise<HybridSearchResult[]>;
