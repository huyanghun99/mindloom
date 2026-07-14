export declare function canManageWorkspace(userId: string, workspaceId: string): Promise<boolean>;
export declare function canViewSpace(userId: string, spaceId: string): Promise<boolean>;
export declare function canEditSpace(userId: string, spaceId: string): Promise<boolean>;
export declare function canViewPage(userId: string, pageId: string): Promise<boolean>;
export declare function canEditPage(userId: string, pageId: string): Promise<boolean>;
export declare function getReadableSpaceIds(userId: string, workspaceId: string): Promise<string[]>;
