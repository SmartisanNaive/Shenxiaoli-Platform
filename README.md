# 深小狸校园 · Shenxiaoli Platform

> A modern, opinionated campus platform for SUAT (深圳先进大学) —
> 评课 · 集市 · 技能互助 · 树洞, in one place.

[![MIT License](https://img.shields.io/badge/License-MIT-1b4332.svg)](LICENSE)
![Bun](https://img.shields.io/badge/runtime-Bun-1b4332?logo=bun)
![Vite](https://img.shields.io/badge/bundler-Vite-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-38BDF8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![Home preview](docs/screenshots/home.png)

---

## ✨ About

**深小狸校园 (Shenxiaoli Campus)** is a frontend-first campus platform built
around the everyday needs of university students:

| Module                      | What it does                                         |
| --------------------------- | ---------------------------------------------------- |
| 评课 / Course Evaluation    | Read & write course reviews before you pick classes. |
| 集市 / Market               | Buy & sell second-hand goods on campus.              |
| 技能互助 / Skill Mutual Aid | Find study buddies & exchange skills.                |
| 树洞 / Tree Hole            | Anonymous, moderated message wall.                   |

The current codebase is **the pure-frontend implementation** rendered
against a static data layer; a real backend will be wired in later without
breaking the existing UI contracts.

### Design language

The visual system is documented in [`docs/DESIGN.md`](docs/DESIGN.md) and
codified in [`tailwind.config.ts`](tailwind.config.ts) /
[`src/styles/tokens.css`](src/styles/tokens.css). It is built around the
**Deep Forest Emerald Academic** palette — deep forest greens, off-white
surfaces, serif headlines, and zero blue.

---

## 🚀 Tech stack

- **[Bun](https://bun.sh)** — package manager & script runner
- **[Vite](https://vitejs.dev)** — multi-page dev server & bundler
- **[Tailwind CSS](https://tailwindcss.com)** — utility-first styling with
  design tokens
- **[TypeScript](https://www.typescriptlang.org)** — strict, ESM-first
- **[ESLint](https://eslint.org) + [Prettier](https://prettier.io)** —
  formatting & linting

No framework lock-in. Each page is a plain HTML entry that imports the
shared layout script and stylesheet.

---

## 📁 Project layout

```
.
├── docs/
│   ├── DESIGN.md              # Deep Forest Emerald Academic design system
│   └── screenshots/           # Reference renders of each page
├── public/
│   └── favicon.svg            # Site favicon
├── src/
│   ├── pages/                 # One HTML file per route (Vite entries)
│   │   ├── index.html                  # 首页   / Home
│   │   ├── course-evaluation.html      # 评课   / Course Evaluation
│   │   ├── market.html                 # 集市   / Market
│   │   ├── skill-mutual-aid.html       # 技能互助 / Skill Mutual Aid
│   │   └── tree-hole.html              # 树洞   / Tree Hole
│   ├── scripts/
│   │   ├── main.ts            # Entry script — mounts shared layout
│   │   └── layout.ts          # Header/footer template functions
│   └── styles/
│       ├── main.css           # Tailwind entry + project resets
│       └── tokens.css         # Design tokens as CSS custom properties
├── .editorconfig
├── .gitignore
├── .prettierrc.json
├── .prettierignore
├── eslint.config.js
├── bunfig.toml
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
├── vite.config.ts
├── package.json
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CHANGELOG.md
└── CODE_OF_CONDUCT.md
```

---

## 🛠️ Getting started

### Prerequisites

- [Bun](https://bun.sh) **>= 1.1** (`curl -fsSL https://bun.sh/install | bash`)
- A modern browser (Chrome / Edge / Firefox / Safari current)

### Install

```bash
bun install
```

### Develop

```bash
bun run dev
```

The dev server starts on <http://127.0.0.1:5173> and opens the Home page
automatically. Each page lives at:

- `/index.html` — Home
- `/course-evaluation.html` — 评课
- `/market.html` — 集市
- `/skill-mutual-aid.html` — 技能互助
- `/tree-hole.html` — 树洞

### Build for production

```bash
bun run build      # type-check + emit dist/
bun run preview    # serve the built output
```

### Lint / format / type-check

```bash
bun run lint           # ESLint
bun run lint:fix       # ESLint --fix
bun run format         # Prettier --write
bun run format:check   # Prettier --check (CI-friendly)
bun run typecheck      # tsc --noEmit
```

---

## 🧱 Adding a page

1. Drop a new HTML file into `src/pages/`, e.g. `lost-and-found.html`.
2. Inside `<body>` place a `<div data-layout="header" data-active="lost-and-found"></div>`,
   then `<main>`, then `<div data-layout="footer"></div>`.
3. Register the entry in `vite.config.ts` under `build.rollupOptions.input`.
4. Add a `NavItem` to `NAV_ITEMS` in `src/scripts/layout.ts`.

The shared header (with the active nav state) and footer are injected by
`src/scripts/main.ts`.

---

## 🌍 Localization

UI copy is currently Chinese-only. To add another language:

1. Extract string literals into `src/scripts/i18n/<locale>.ts`.
2. Make `layout.ts` accept a `t()` function.
3. Document the workflow in `CONTRIBUTING.md`.

---

## 🤝 Contributing

We welcome issues, design feedback, and pull requests.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community standards.

---

## 🔒 Security

Vulnerabilities should **not** be filed as public issues. Please follow
[`SECURITY.md`](SECURITY.md).

---

## 📜 License

[MIT](LICENSE) © 2026 Shenxiaoli Platform Contributors.

---

## 🙏 Acknowledgements

- Inspired by the campus culture of **SUAT — 深圳先进大学 / Shenzhen
  University of Advanced Technology**.
- Design system adapted from the **Deep Forest Emerald Academic** palette.
- Built with open-source tooling: Bun, Vite, Tailwind CSS, TypeScript.
