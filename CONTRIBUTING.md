# Contributing to 深小狸校园

First off, thanks for taking the time to contribute! 🎉
This project is a frontend-first campus platform built by and for students.
Every issue, design critique, doc fix, and PR helps.

## 📋 Code of Conduct

This project and everyone participating in it is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected
to uphold this code.

---

## 🚀 Quick start

```bash
# 1. Install Bun (if you don't already have it)
curl -fsSL https://bun.sh/install | bash

# 2. Fork & clone the repo
git clone https://github.com/<you>/shenxiaoli-platform.git
cd shenxiaoli-platform

# 3. Install dependencies
bun install

# 4. Run the dev server
bun run dev
```

The dev server runs at <http://127.0.0.1:5173> and live-reloads on save.

---

## 🧰 Workflow

1. **Branch off `main`.** Use a short, descriptive name:
   `feat/course-filter-chips`, `fix/tree-hole-overflow`,
   `docs/readme-screenshots`, etc.
2. **Make focused commits.** One logical change per commit; imperative
   mood (`Add`, `Fix`, `Refactor`).
3. **Run the checks before pushing:**
   ```bash
   bun run typecheck
   bun run lint
   bun run format:check
   bun run build
   ```
4. **Open a Pull Request** against `main`. Fill in the PR template.

---

## 🎨 Design-first changes

UI changes are governed by [`docs/DESIGN.md`](docs/DESIGN.md). Before
tweaking styles, read it (or skim the relevant section). New colors,
typography, or spacing **must** be added there **and** mirrored in:

- `tailwind.config.ts` (Tailwind theme.extend)
- `src/styles/tokens.css` (CSS custom properties)

Keep the two files in lockstep — the README + DESIGN.md are the source
of truth for the brand.

---

## 📝 Commit & PR conventions

- **Commits:** We don't enforce Conventional Commits, but the
  [Conventional Commits 1.0](https://www.conventionalcommits.org/) spec
  produces a much cleaner `git log`, so it's encouraged.
- **PR titles:** Same convention — short, imperative, scoped
  (`feat(market): add sold-out badge`).
- **Screenshots:** UI changes should attach before/after screenshots.
  Drop reference renders into `docs/screenshots/` if they don't already
  exist there.

---

## 🧪 What we look for in review

- ✅ **Correctness** — does it work on the happy path **and** the
  edge cases (empty states, long text, narrow viewports)?
- ✅ **Design fidelity** — does it respect the design tokens?
- ✅ **Accessibility** — keyboard reachable, sufficient contrast,
  semantic HTML, `aria-*` where appropriate.
- ✅ **Performance** — no blocking work on first paint, sensible
  bundle impact.
- ✅ **Reuse** — prefer existing components / utilities over
  copy-pasted markup.

---

## 🐛 Filing issues

Use the provided templates in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/). Include:

- **What you expected vs. what happened**
- **Steps to reproduce** (URL, browser, viewport)
- **Screenshots / screen recordings** — these are gold.
- **Console errors**, if any.

---

## 🧭 Project structure cheatsheet

| Path                    | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `src/*.html`            | One HTML entry per route (Vite multi-page). |
| `src/scripts/layout.ts` | Shared header/footer templates.             |
| `src/scripts/main.ts`   | Mounts shared layout + page wiring.         |
| `src/styles/main.css`   | Tailwind entry & global resets.             |
| `src/styles/tokens.css` | Design tokens as CSS custom properties.     |
| `tailwind.config.ts`    | Tailwind theme (mirrors `tokens.css`).      |
| `vite.config.ts`        | Multi-page build config.                    |
| `docs/DESIGN.md`        | Design system source of truth.              |

---

## 📦 Release process

We tag releases with `vMAJOR.MINOR.PATCH` using
[SemVer 2.0](https://semver.org/). The maintainer updates
[`CHANGELOG.md`](CHANGELOG.md) at release time.

---

Thanks again for contributing — see you on `main`! 🌿
