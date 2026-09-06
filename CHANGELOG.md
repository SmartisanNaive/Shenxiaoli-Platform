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
- Five page entries: Home (`/`), 评课, 集市, 技能互助, 树洞.
- Shared header & footer template rendered from
  `src/scripts/layout.ts`.
- Design tokens (`src/styles/tokens.css`) and Tailwind theme
  (`tailwind.config.ts`) extracted from `docs/DESIGN.md`.
- GitHub-standard open-source docs: `README`, `LICENSE` (MIT),
  `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`.
- CI workflow (`.github/workflows/ci.yml`) running
  `bun run lint`, `bun run format:check`, `bun run typecheck`,
  `bun run build` on every push and PR.

### Changed

- Original `_1`–`_5/code.html` design files were consolidated into a
  unified project layout. Original visual designs are preserved 1:1;
  reference screenshots live in `docs/screenshots/`.

---

## [0.0.0] — 2026-09-06

### Added

- Initial commit: design mockups (`code.html`) for five campus pages
  under `_1/`–`_5/`, plus the _Deep Forest Emerald Academic_ design
  document under `deep_forest_emerald_academic/DESIGN.md`.
- _Reorganized and superseded by the [Unreleased] entry — the
  `_1/`–`_5/` and `deep_forest_emerald_academic/` directories have
  since been removed in favour of `src/pages/` + `docs/`._
