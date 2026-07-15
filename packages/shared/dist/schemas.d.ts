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
}, "strip", z.ZodTypeAny, {
    contentVersion: number;
    title?: string | undefined;
    contentJson?: unknown;
    textContent?: string | undefined;
}, {
    contentVersion: number;
    title?: string | undefined;
    contentJson?: unknown;
    textContent?: string | undefined;
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
