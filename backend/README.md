# Backend

> 🚧 Not implemented yet — this directory is a placeholder.

The frontend in [`../frontend`](../frontend) currently renders static
placeholder data. This package will own the real API behind it.

## Scope

The five product surfaces the API needs to serve:

| Surface                     | Expected responsibilities                             |
| --------------------------- | ----------------------------------------------------- |
| 首页 / Home                 | Aggregated feed, search across modules.               |
| 评课 / Course Evaluation    | Courses, reviews, ratings, moderation.                |
| 集市 / Market               | Listings, images, transaction state.                  |
| 技能互助 / Skill Mutual Aid | Skill offers/requests, matching.                      |
| 树洞 / Tree Hole            | Anonymous posts, rate limiting, abuse handling.       |

## Cross-cutting concerns

- **Auth** — SUAT student verification; anonymity guarantees for 树洞.
- **Moderation** — the 树洞 and 评课 modules need it before any public launch.
- **Rate limiting** — anonymous write endpoints are the obvious abuse target.

## Conventions to keep

This directory manages its own dependencies and its own lockfile; there is
no shared root `node_modules`. Whatever stack it lands on should expose the
same script names the frontend does, so the root delegating scripts and CI
stay symmetric:

```bash
bun run dev         # or the stack's equivalent
bun run build
bun run lint
bun run typecheck
```

When this becomes real, add a `backend` job to
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) mirroring the
`frontend` job, and document the API contract in
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
