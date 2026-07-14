import { z } from 'zod';
export declare const emailSchema: z.ZodString;
export declare const passwordSchema: z.ZodString;
export declare const registerSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    name: string;
}, {
    email: string;
    password: string;
    name: string;
}>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const createWorkspaceSchema: z.ZodObject<{
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
}, {
    name: string;
}>;
export declare const createSpaceSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    name: z.ZodString;
    aiPrivacyPolicy: z.ZodDefault<z.ZodEnum<["inherit_workspace", "cloud_allowed", "local_only", "disabled"]>>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    name: string;
    aiPrivacyPolicy: "inherit_workspace" | "cloud_allowed" | "local_only" | "disabled";
}, {
    workspaceId: string;
    name: string;
    aiPrivacyPolicy?: "inherit_workspace" | "cloud_allowed" | "local_only" | "disabled" | undefined;
}>;
export declare const createPageSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodString;
    parentPageId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodString;
    contentJson: z.ZodOptional<z.ZodUnknown>;
    textContent: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    spaceId: string;
    title: string;
    textContent: string;
    parentPageId?: string | null | undefined;
    contentJson?: unknown;
}, {
    workspaceId: string;
    spaceId: string;
    title: string;
    parentPageId?: string | null | undefined;
    contentJson?: unknown;
    textContent?: string | undefined;
}>;
export declare const updatePageSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    contentJson: z.ZodOptional<z.ZodUnknown>;
    textContent: z.ZodOptional<z.ZodString>;
    contentVersion: z.ZodNumber;
    autosave: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    contentVersion: number;
    autosave: boolean;
    title?: string | undefined;
    contentJson?: unknown;
    textContent?: string | undefined;
}, {
    contentVersion: number;
    title?: string | undefined;
    contentJson?: unknown;
    textContent?: string | undefined;
    autosave?: boolean | undefined;
}>;
export declare const searchSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodOptional<z.ZodString>;
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    query: string;
    limit: number;
    spaceId?: string | undefined;
}, {
    workspaceId: string;
    query: string;
    spaceId?: string | undefined;
    limit?: number | undefined;
}>;
export declare const ragAskSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodOptional<z.ZodString>;
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
} & {
    extendedThinking: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    query: string;
    limit: number;
    extendedThinking: boolean;
    spaceId?: string | undefined;
}, {
    workspaceId: string;
    query: string;
    spaceId?: string | undefined;
    limit?: number | undefined;
    extendedThinking?: boolean | undefined;
}>;
export declare const captureSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodString;
    title: z.ZodString;
    content: z.ZodDefault<z.ZodString>;
    sourceUrl: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    spaceId: string;
    title: string;
    content: string;
    tags: string[];
    sourceUrl?: string | undefined;
}, {
    workspaceId: string;
    spaceId: string;
    title: string;
    content?: string | undefined;
    sourceUrl?: string | undefined;
    tags?: string[] | undefined;
}>;
export declare const updateWorkspaceSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
}, {
    name?: string | undefined;
}>;
export declare const updateSpaceSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    aiPrivacyPolicy: z.ZodOptional<z.ZodEnum<["inherit_workspace", "cloud_allowed", "local_only", "disabled"]>>;
    autoLlmProcessing: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    aiPrivacyPolicy?: "inherit_workspace" | "cloud_allowed" | "local_only" | "disabled" | undefined;
    description?: string | undefined;
    autoLlmProcessing?: boolean | undefined;
}, {
    name?: string | undefined;
    aiPrivacyPolicy?: "inherit_workspace" | "cloud_allowed" | "local_only" | "disabled" | undefined;
    description?: string | undefined;
    autoLlmProcessing?: boolean | undefined;
}>;
export declare const createGroupSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    name: string;
}, {
    workspaceId: string;
    name: string;
}>;
export declare const updateGroupSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
}, {
    name?: string | undefined;
}>;
export declare const addGroupMemberSchema: z.ZodObject<{
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
}, {
    userId: string;
}>;
export declare const restoreRevisionSchema: z.ZodObject<{
    revisionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    revisionId: string;
}, {
    revisionId: string;
}>;
export declare const createTopicSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodString;
    title: z.ZodString;
    contentJson: z.ZodOptional<z.ZodUnknown>;
    aiSummary: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    spaceId: string;
    title: string;
    contentJson?: unknown;
    aiSummary?: string | undefined;
}, {
    workspaceId: string;
    spaceId: string;
    title: string;
    contentJson?: unknown;
    aiSummary?: string | undefined;
}>;
export declare const updateTopicSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    contentJson: z.ZodOptional<z.ZodUnknown>;
    status: z.ZodOptional<z.ZodEnum<["accepted", "user_edited", "archived"]>>;
    updatePolicy: z.ZodOptional<z.ZodEnum<["suggest_only", "auto_draft", "auto_publish"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "accepted" | "user_edited" | "archived" | undefined;
    title?: string | undefined;
    contentJson?: unknown;
    updatePolicy?: "suggest_only" | "auto_draft" | "auto_publish" | undefined;
}, {
    status?: "accepted" | "user_edited" | "archived" | undefined;
    title?: string | undefined;
    contentJson?: unknown;
    updatePolicy?: "suggest_only" | "auto_draft" | "auto_publish" | undefined;
}>;
export declare const createShareSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    targetType: z.ZodEnum<["page", "topic"]>;
    targetId: z.ZodString;
    shareMode: z.ZodDefault<z.ZodEnum<["live", "snapshot"]>>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    targetType: "page" | "topic";
    targetId: string;
    shareMode: "live" | "snapshot";
}, {
    workspaceId: string;
    targetType: "page" | "topic";
    targetId: string;
    shareMode?: "live" | "snapshot" | undefined;
}>;
export declare const patchEdgeSchema: z.ZodObject<{
    relationType: z.ZodOptional<z.ZodString>;
    confidence: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<["suggested", "confirmed", "deleted"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "suggested" | "confirmed" | "deleted" | undefined;
    relationType?: string | undefined;
    confidence?: number | undefined;
}, {
    status?: "suggested" | "confirmed" | "deleted" | undefined;
    relationType?: string | undefined;
    confidence?: number | undefined;
}>;
export declare const importMarkdownSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    spaceId: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    sourceUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    spaceId: string;
    title: string;
    content: string;
    sourceUrl?: string | undefined;
}, {
    workspaceId: string;
    spaceId: string;
    title: string;
    content: string;
    sourceUrl?: string | undefined;
}>;
export declare const createBackupSchema: z.ZodObject<{
    includeSecrets: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    includeSecrets: boolean;
}, {
    includeSecrets?: boolean | undefined;
}>;
export declare const restoreBackupSchema: z.ZodObject<{
    backupId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    backupId: string;
}, {
    backupId: string;
}>;
