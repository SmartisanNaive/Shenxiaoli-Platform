# Changelog

All notable changes to **深小狸校园 (Shenxiaoli Platform)** are documented
in this file. Dates are in `YYYY-MM-DD` and follow ISO 8601.

The format is based on [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0](https://semver.org/).

---

## [Unreleased]

### Added

- Project scaffolded as a Bun + Vite + Tailwind CSS + TypeScript
  multi-page application.
- Hono + SQLite API for course reviews, marketplace listings, skill mutual aid,
  anonymous tree-hole posts, cross-module search, reports and moderation.
- Development-only demo student/moderator sessions, opaque cookie handling,
  input validation, per-account rate limits, and validated image uploads.
- A moderation workspace and API integration tests using in-memory SQLite.
- Home, course, market, skills, tree-hole, and moderation page entries.
- Shared header & footer template rendered from
  `frontend/src/scripts/layout.ts`.
- Design tokens (`frontend/src/styles/tokens.css`) and Tailwind theme
  (`frontend/tailwind.config.ts`) extracted from `docs/DESIGN.md`.
- GitHub-standard open-source docs: `README`, `LICENSE` (MIT),
  `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`.
- CI workflow (`.github/workflows/ci.yml`) running
  `bun run lint`, `bun run format:check`, `bun run typecheck`,
  `bun run build` on every push and PR.
- `docs/ARCHITECTURE.md`, `.gitattributes`, and Dependabot configuration
  for a more maintainable GitHub project baseline.
- Root development command that starts the API and frontend together.
- Root `package.json` with delegating `dev` / `build` / `preview` / `lint` /
  `format:check` / `typecheck` / `setup` scripts. It declares no
  dependencies of its own.

### Changed

- **Restructured the repository into a frontend/backend monorepo.** All
  application code and its tooling moved from the repo root into
  `frontend/` (`src/`, `public/`, `vite.config.ts`, `tailwind.config.ts`,
  `postcss.config.js`, `tsconfig.json`, `eslint.config.js`, `bunfig.toml`,
  `.prettierrc.json`, `.prettierignore`, `package.json`, `bun.lock`).
  Project meta — `README`, `LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`,
  `SECURITY`, `CHANGELOG`, `docs/`, `.github/`, `.editorconfig`,
  `.gitattributes`, `.gitignore` — stays at the root. Each package owns its
  own dependencies; there is no shared root `node_modules`.
- The frontend package is now named `@shenxiaoli/frontend`;
  `shenxiaoli-platform` names the repo root.
- Build output moved from `dist/` to `frontend/dist/`. The `rth-host.json`
  deploy target and the CI artifact path were updated to match, and the
  `deploy` script moved to the root `package.json` alongside it.
- CI runs with `working-directory: frontend`; its cache key and uploaded
  artifact now point at `frontend/`. Dependabot's npm ecosystem tracks
  `/frontend`.
- Original `_1`–`_5/code.html` design files were consolidated into a
  unified project layout. The original visual direction is preserved; reference
  screenshots live in `docs/screenshots/`.
- Shared chrome and the main stylesheet are injected during Vite's HTML
  transform, preventing an unstyled first paint when navigating between pages.
- The frontend's static feature samples are now replaced by API-backed data and
  working filters, publishing, contact requests, reactions, and review forms.
- Local development demo sign-in is explicit and disabled in production; the
  README documents remaining school identity, durable hosting, and moderation
  governance requirements.
- Student-run, non-official project wording and tree-hole privacy wording were
  clarified to avoid unsupported claims.

---

## [0.0.0] — 2026-09-06

### Added

- Initial commit: design mockups (`code.html`) for five campus pages
  under `_1/`–`_5/`, plus the _Deep Forest Emerald Academic_ design
  document under `deep_forest_emerald_academic/DESIGN.md`.
- _Reorganized and superseded by the [Unreleased] entry — the
  `_1/`–`_5/` and `deep_forest_emerald_academic/` directories have
  since been removed in favour of `frontend/src/` + `docs/`._
