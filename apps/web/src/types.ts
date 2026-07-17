export type User = { id: string; email: string; name: string; isInstanceOwner: boolean };
export type Workspace = { id: string; name: string; role?: string };
export type Space = { id: string; name: string; workspaceId: string; role?: string };

// Lightweight page node returned by the tree / list API. Deliberately
// EXCLUDES contentJson and textContent (see AGENTS.md perf rules).
export type PageNode = {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentPageId: string | null;
  position: number;
  title: string;
  llmProcessStatus: string;
  hasChildren: boolean;
  updatedAt?: string;
};

// Full page body — only ever fetched via the Page Detail API (GET /api/pages/:id).
export type PageDetail = {
  id: string;
  title: string;
  contentJson: unknown;
  textContent: string;
  contentVersion: number;
  llmProcessStatus: string;
  parentPageId?: string | null;
  updatedAt?: string;
};

export type TreeNode = PageNode & { children: TreeNode[] };

// Primary destinations rendered in the center column. The three-column shell
// (left sidebar + top bar + right panel) stays mounted across all of them, so
// notes / organize / search never feel like separate apps.
export type MainRoute = 'home' | 'page' | 'organize' | 'search' | 'ask' | 'map';

export type RagSession = {
  id: string;
  query: string;
  answer: string;
  spaceId?: string | null;
  createdAt?: string;
  citations?: { title?: string; pageId?: string }[];
};
