# DMPG_UML — Agent Instructions

## Workspace Structure

| Folder             | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `apps/server/`     | Express backend (port 3001) — scanner, AI routes, graph store  |
| `apps/web/`        | React frontend (port 5173) — React Flow canvas, Zustand store  |
| `packages/shared/` | Zod schemas, edge projection — shared between server & web     |
| `data_pipeline/`   | **READ-ONLY example project** for scanning context (see below) |

## ⚠️ `data_pipeline/` — Do NOT Edit

The `data_pipeline/` directory is a **sample Python project** used as the default
scan target. It exists solely as context/example data for the UML scanner.

**Rules:**

- Never create, modify, or delete any file inside `data_pipeline/`.
- Never refactor, lint, or "fix" code in this folder.
- It may be read for context (e.g., to understand what the scanner produces).
- The scanner points at `C:\dev\dmpg_models\data_pipeline` by default (`.env`).
- Do not start the server i will do it manually

## Tech Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 18, @xyflow/react v12, Zustand, ELK layout (elkjs), Vite, TypeScript 5.9
- **Backend**: Express, tsx, Ollama AI (gemini-3-flash-preview), Python scanner (ast-based)
- **Shared**: Zod schemas + edge projection logic

## Conventions

- All code is TypeScript (strict). No `any` unless imported raw scanner data.
- CSS is plain CSS in `apps/web/src/styles/global.css` — no CSS-in-JS.
- State management: single Zustand store at `apps/web/src/store.ts`.
- Edge projection: `packages/shared/src/projection.ts` — all edge aggregation/visibility logic.
- Scanner view hierarchy: Root → Group → Module → Class (4 levels).
- AI analysis: SSE-based with polling fallback and cancel support.
