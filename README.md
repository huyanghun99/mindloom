# MindLoom 知织

MindLoom is a personal and small-team LLM-first wiki. It keeps a controllable Notes view while adding an LLM Wiki view for AI-generated topics, backlinks, knowledge graph relationships, and strictly cited RAG answers.

This repository is a **starter implementation** generated from the v1.3 design specification. It is not a finished production product, but it includes the core architecture, database schema, API routes, AI abstraction, job runner, search/RAG flow, editor extension contract, and test skeletons needed for continued development.

## What is included

- TypeScript monorepo with pnpm workspaces
- React + Vite web app
- Hono API server
- PostgreSQL + pgvector schema and migrations
- Application-level Chinese tokenization strategy for Windows-friendly full-text search
- Instance-level embedding dimension lock for MVP
- Inline encrypted AI API key model
- Persistent PostgreSQL jobs table with in-process job runner
- Strict-citation RAG route with mock AI provider
- API rate-limit middleware for RAG and AI routes
- Page / Topic / Entity / Knowledge Edge schema
- Notes view and LLM Wiki view skeleton
- Editor extension contract for Draw.io / Excalidraw / Mermaid / KaTeX / embeds
- Windows bundle design notes
- Vitest test skeletons

## Quick start

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm --filter @mindloom/server db:migrate
pnpm dev
```

Open:

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:39280

## First user

When `ALLOW_SIGNUP=true`, the first registered user becomes the instance owner.

## Important MVP constraints

- MVP supports one instance-wide embedding dimension only. Default: `1536`.
- Workspace-level different embedding dimensions are intentionally not supported in MVP.
- zhparser is not required in MVP. Chinese full-text search uses application-level tokenization and PostgreSQL `simple` tsvector strategy.
- AI provider tests use the mock provider by default.
- Draw.io / Excalidraw / Mermaid / KaTeX are represented by the editor extension contract and UI placeholders in this starter; production-grade extension UIs still need to be completed.

## Project layout

```text
apps/web      React/Vite client
apps/server   Hono API server
packages/shared   shared Zod schemas and types
packages/editor   editor extension contract
scripts       release scripts
docs          design notes
```

## License

You should review third-party licenses before public release. This starter does not copy Docmost source code; it provides a clean-room implementation scaffold guided by product behavior.
