export declare function enqueueJob(input: {
    workspaceId?: string;
    spaceId?: string;
    entityType: string;
    entityId?: string;
    type: string;
    payload?: Record<string, unknown>;
    runAfterSeconds?: number;
    priority?: number;
}): Promise<void>;
export declare function runOneJob(workerId?: string): Promise<boolean>;
export declare function startJobRunner(): void;
