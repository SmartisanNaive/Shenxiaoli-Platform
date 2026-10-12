# Project Architecture

## Purpose

深小狸校园 is a multi-page campus community MVP. It keeps the existing
Bun + Vite + Tailwind + TypeScript frontend and adds a Bun + Hono API backed by
SQLite. The frontend is still framework-free: existing HTML entries share a
pre-rendered header/footer and small TypeScript feature modules.

## Packages and runtime

| Path | Responsibility |
| --- | --- |
| `frontend/` | Vite multi-page client, HTML, Tailwind styling, API integration |
| `backend/` | Hono API, SQLite schema/seed, opaque cookie sessions, moderation and upload handling |
| `docs/` | Design rationale, screenshots and this architecture reference |
| root | CI, project metadata, and scripts that coordinate the packages |

Each package owns its dependencies and lockfile. There is no shared root
`node_modules`. `bun run dev` starts both services; `bun run dev:web` and
`bun run dev:api` start them separately. The Vite development server proxies
`/api/*` and `/uploads/*` to `127.0.0.1:8787`, so browser requests use a
same-origin URL.

```text
Browser
  ├─ Vite multi-page client :5173
  │    ├─ pre-rendered shared layout
  │    └─ page feature modules ── /api/*, /uploads/*
  └─ Hono API :8787
       ├─ session cookies + write-origin checks
       ├─ input validation + per-account rate limits
       └─ SQLite (`backend/data/shenxiaoli.sqlite`)
```

Production needs a reverse proxy or equivalent same-origin routing for the
static frontend and API. `frontend/dist/` alone is not a complete deployment.
The repository's static deploy workflow does not deploy the backend or provide
persistent storage.

## Product/API contract

| Surface | Client behavior | API responsibilities |
| --- | --- | --- |
| Home | Aggregate counts, featured courses, latest listings/tree posts | `GET /api/home` |
| Search | Live cross-module suggestions | `GET /api/search?q=...` |
| Course evaluation | Filter courses, view approved reviews, submit a review | `/api/courses*`; new reviews are pending moderation |
| Market | Filter/list/detail, create listing with photos, status update, contact request | `/api/market/listings*`, `/api/uploads` |
| Skill mutual aid | Filter offers/requests, publish, contact request | `/api/skills*` |
| Tree hole | Topic/sort/pagination, anonymous feed, reaction, report, publish | `/api/tree-hole*`; new posts are pending moderation |
| Moderation | Review pending course/tree content and triage reports | `/api/admin/queue`, `/api/admin/:type/:id` |

Responses intentionally do not expose tree-post author/account IDs. The server
retains an internal account association for rate limits and moderation; the
product promise is public anonymity, not untraceability from the service.

## Authentication and data

The local app provides a development-only demo student and demo moderator. The
opaque session token is sent as an `HttpOnly`, `SameSite=Lax` cookie; only its
hash is stored in SQLite. Demo sign-in is disabled when `NODE_ENV=production`.
No school identity provider, student verification, password reset, or production
account lifecycle is implemented yet.

SQLite schema is created idempotently on startup. Demo records are seeded only
when their tables are empty; they are clearly labeled as local development data
in the interface/docs. Runtime database files and image uploads are ignored by
Git. Market uploads accept JPEG/PNG/WebP with size and magic-byte checks and use
random filenames.

## Frontend structure

- `frontend/src/*.html`: Vite multi-page entries.
- `frontend/src/scripts/layout.ts`: pre-rendered shared chrome and navigation.
- `frontend/src/scripts/main.ts`: auth widget, search, notifications, page dispatch.
- `frontend/src/scripts/api.ts`: typed fetch helper, escaping, common UI helpers.
- `frontend/src/scripts/{home,courses,market,skills,tree-hole,moderation}.ts`: feature modules.
- `frontend/src/styles/tokens.css` and `frontend/tailwind.config.ts`: mirrored design tokens.

The Vite HTML transform still injects the shared header/footer and stylesheet
before first paint. Feature modules enhance each page only after the document
loads; they do not own first-paint layout.

## Quality checks

From the repository root:

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
```

CI runs independent frontend and backend jobs. The API tests use an in-memory
SQLite database and do not require a network service.

## Production considerations

SQLite is appropriate for a single-instance MVP with a durable volume and
backups. It is not configured for horizontally scaled instances. Public launch
also requires school-approved identity verification, a durable storage/backup
plan, HTTPS, a configured session secret and production origin allowlist,
moderator governance, retention/deletion policies, and a real communication
flow for contact requests. See [`../backend/README.md`](../backend/README.md).

## Adding a page

1. Add `frontend/src/<page>.html` with the shared layout placeholders.
2. Register the entry in `frontend/vite.config.ts → build.rollupOptions.input`.
3. Add a page module and dispatch it from `frontend/src/scripts/main.ts` if needed.
4. Add a navigation item only if it should appear in global navigation.
5. Run the root quality checks above.

## Design tokens

`docs/DESIGN.md` remains the visual reference. When changing a token, update
both `frontend/tailwind.config.ts` and `frontend/src/styles/tokens.css`.