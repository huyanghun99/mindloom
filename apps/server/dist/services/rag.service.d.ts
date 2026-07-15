import { RagAnswer } from '@mindloom/shared';
export declare function askRag(params: {
    userId: string;
    workspaceId: string;
    spaceId?: string;
    query: string;
    limit: number;
    extendedThinking: boolean;
}): Promise<RagAnswer>;
