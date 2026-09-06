# Project Architecture

## Purpose

深小狸校园 is a **multi-page campus community prototype**, organized as a
monorepo with a `frontend/` package and a reserved `backend/` package. The
frontend deliberately avoids a UI framework at this stage: each product area
is a plain HTML entry and shares a small amount of TypeScript and CSS.

## Repository layout

| Path        | Responsibility                                                     |
| ----------- | ------------------------------------------------------------------ |
| `frontend/` | Bun + Vite + Tailwind multi-page client. Owns its own lockfile.     |
| `backend/`  | 🚧 Reserved for the API. Not implemented — see its README.          |
| `docs/`     | Design rationale, screenshots, and developer documentation.         |
| root        | Project meta, CI, and delegating scripts. No dependencies of its own. |

Each package installs its own dependencies; there is no shared root
`node_modules` and no workspace linking. The root `package.json` forwards
`dev` / `build` / `preview` / `lint` / `format:check` / `typecheck` into
`frontend/`.

## Runtime model

```text
Browser request
    │
    ▼
Vite dev server / static build
    │  transforms each HTML entry
    ▼
shenxiaoli:inject-layout (frontend/vite.config.ts)
    │  replaces data-layout placeholders before first paint
    ▼
HTML: render-blocking CSS link + pre-rendered header/main/footer
    │
    ▼
main.ts (search interaction only)
```

The layout injection plugin is intentionally build-time / serve-time rather
than client-side. It prevents a flash of incomplete chrome when navigating
between independent HTML pages.

## Frontend source layout

All paths below are relative to `frontend/`.

| Path                    | Responsibility                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| `src/*.html`            | Vite multi-page HTML entries — one per product surface.                    |
| `src/scripts/layout.ts` | Header/footer templates and navigation definition.                         |
| `src/scripts/main.ts`   | Small client-only interactions. It must not own first-paint layout or CSS. |
| `src/styles/main.css`   | Tailwind entrypoint and global base styles.                                |
| `src/styles/tokens.css` | CSS variables that mirror the Tailwind design tokens.                      |
| `public/`               | Files copied unchanged to build output.                                    |

## Design tokens

`docs/DESIGN.md` is the visual-system reference. Every token change must be
made consistently in both:

1. `frontend/tailwind.config.ts` — token exposed as a utility class.
2. `frontend/src/styles/tokens.css` — token exposed as a CSS custom property.

## Adding a product page

1. Add `frontend/src/<page>.html`; include the shared layout placeholders in
   `<body>`. The Vite document plugin injects the render-blocking stylesheet
   for every registered entry, so no page-specific CSS link is necessary.
2. Register the entry in `frontend/vite.config.ts → build.rollupOptions.input`.
3. Add the page to `NAV_ITEMS` in `frontend/src/scripts/layout.ts` when it
   belongs in the global navigation, then set the same key in the page's
   `data-active` placeholder. The Vite plugin validates the key at build time.
4. From `frontend/`, run
   `bun run format:check && bun run lint && bun run typecheck && bun run build`.

## Production contract

`bun run build` produces a portable static site under `frontend/dist/`; it
requires no Node/Bun server after the build. Deploy `frontend/dist/` to any
static host that serves HTML, JavaScript, CSS, and SVG files. The deploy
target is configured at the repo root in `rth-host.json`.
