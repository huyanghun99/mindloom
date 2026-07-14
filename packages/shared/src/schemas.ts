import { z } from 'zod';

export const emailSchema = z.string().email().max(320);
export const passwordSchema = z.string().min(8).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(120)
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200)
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120)
});

export const createSpaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  aiPrivacyPolicy: z.enum(['inherit_workspace', 'cloud_allowed', 'local_only', 'disabled']).default('inherit_workspace')
});

export const createPageSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  parentPageId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  contentJson: z.unknown().optional(),
  textContent: z.string().default('')
});

export const updatePageSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  contentJson: z.unknown().optional(),
  textContent: z.string().optional(),
  contentVersion: z.number().int().positive(),
  autosave: z.boolean().default(false)
});

export const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid().optional(),
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).default(10)
});

export const ragAskSchema = searchSchema.extend({
  extendedThinking: z.boolean().default(false)
});

export const captureSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  content: z.string().default(''),
  sourceUrl: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(80)).default([])
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120).optional()
});

export const updateSpaceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  aiPrivacyPolicy: z.enum(['inherit_workspace', 'cloud_allowed', 'local_only', 'disabled']).optional(),
  autoLlmProcessing: z.boolean().optional()
});

export const createGroupSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120)
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(120).optional()
});

export const addGroupMemberSchema = z.object({
  userId: z.string().uuid()
});

export const restoreRevisionSchema = z.object({
  revisionId: z.string().uuid()
});

export const createTopicSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  contentJson: z.unknown().optional(),
  aiSummary: z.string().max(2000).optional()
});

export const updateTopicSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  contentJson: z.unknown().optional(),
  status: z.enum(['accepted', 'user_edited', 'archived']).optional(),
  updatePolicy: z.enum(['suggest_only', 'auto_draft', 'auto_publish']).optional()
});

export const createShareSchema = z.object({
  workspaceId: z.string().uuid(),
  targetType: z.enum(['page', 'topic']),
  targetId: z.string().uuid(),
  shareMode: z.enum(['live', 'snapshot']).default('live')
});

export const patchEdgeSchema = z.object({
  relationType: z.string().min(1).max(120).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  status: z.enum(['suggested', 'confirmed', 'deleted']).optional()
});

export const importMarkdownSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  content: z.string().max(500000),
  sourceUrl: z.string().url().optional()
});

export const createBackupSchema = z.object({
  includeSecrets: z.boolean().default(false)
});

export const restoreBackupSchema = z.object({
  backupId: z.string().uuid()
});
