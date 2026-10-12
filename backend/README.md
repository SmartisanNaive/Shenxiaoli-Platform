# Backend API

Bun + Hono API for the 深小狸校园 MVP. The implementation uses SQLite for
local persistence and exposes a same-origin `/api` contract for the Vite client.

## Run locally

From the repository root:

```bash
bun run setup
bun run dev
```

The root dev command starts the API at `http://127.0.0.1:8787` and the Vite
client at `http://127.0.0.1:5173`. Vite proxies `/api/*` and `/uploads/*` to the
API. The API seeds clearly synthetic demo courses, listings, skills, and
approved tree-hole posts on first boot. Local database and uploads are stored
in `backend/data/` and `backend/uploads/`.

To run one package separately:

```bash
cd backend
cp .env.example .env
bun install
bun run dev
```

The development server enables student and moderator demo sign-in by default.
That flow is intentionally disabled in production; it is not SUAT identity
verification. Do not expose a development server or demo accounts publicly.

## API surface

- `GET /api/health`, `GET /api/session`, `POST /api/auth/demo`, `POST /api/auth/logout`
- `GET /api/home`, `GET /api/search?q=...`
- `GET /api/courses`, `GET /api/courses/:id/reviews`, `POST /api/courses/:id/reviews`
- `GET /api/market/listings`, `POST /api/market/listings`, `PATCH /api/market/listings/:id`
- `POST /api/market/listings/:id/contact`
- `GET /api/skills`, `POST /api/skills`, `POST /api/skills/:id/contact`
- `GET /api/tree-hole`, `POST /api/tree-hole`, `POST /api/tree-hole/:id/feel`
- `POST /api/reports`, `GET/PATCH /api/me/contact-requests`
- `POST /api/uploads`, `GET /uploads/:filename`
- `GET /api/admin/queue`, `PATCH /api/admin/:type/:id`

All writes except the development-only sign-in require an authenticated session.
Sessions use random opaque tokens stored as hashes in SQLite and are delivered
in `HttpOnly`, `SameSite=Lax` cookies. Writes check the `Origin` against the
configured allowlist. User-generated text has server-side length/range checks;
queries use parameters; image uploads are limited to JPEG/PNG/WebP, 4 MB per
file, and stored under random filenames. Per-account fixed-window limits cover
reviews, listings, skills, tree posts, contacts, reports, and uploads.

New course reviews and tree-hole posts enter a moderation queue. Public tree
posts do not expose author or account IDs; the internal account link exists for
rate limiting and moderation. This is **public anonymity**, not a claim that the
service itself cannot associate content with an account. The interface explains
that limitation. Reports can also be triaged in the moderation workspace.

## Checks

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Production gaps

This is an executable MVP, not a ready-to-launch campus service. Before a public
launch, the maintainers must:

1. Integrate an approved student identity provider (school SSO or a verified
   institution email workflow); demo login is disabled in production.
2. Configure `SESSION_SECRET`, `ALLOWED_ORIGINS`, `DATABASE_PATH`, and
   `UPLOADS_PATH`; use HTTPS and a same-origin reverse proxy for the browser API.
3. Decide a persistent backup and recovery plan. SQLite here assumes a single
   API instance with durable local storage; it is not configured for horizontal
   scaling or a managed database.
4. Define moderator governance, response SLAs, retention/deletion policy,
   appeals, and a real contact/messaging flow. Current contact requests only
   record and accept/decline a request; they do not expose private contact data
   or provide chat.
5. Review campus policies, privacy notices, abuse handling, and legal obligations
   for user-generated content before accepting real accounts or uploads.

The static hosting workflow only deploys `frontend/dist/`; it does not deploy
this API or provision persistent storage. Backend deployment must be configured
separately.
