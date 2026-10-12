# 深小狸校园 · Shenxiaoli Platform

> 学生共建的非官方校园社区 — 服务于深圳理工大学（SUAT）的同学。
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

**深小狸校园 (Shenxiaoli Campus)** 是一个 **学生共建** 的非官方校园社区,
围绕深圳理工大学（SUAT）同学的日常需求设计:

| Module                      | What it does                |
| --------------------------- | --------------------------- |
| 评课 / Course Evaluation    | 选课之前,先看看大家怎么说。 |
| 集市 / Market               | 校内闲置好物流转平台。      |
| 技能互助 / Skill Mutual Aid | 找搭子,互帮互助,共享知识。  |
| 树洞 / Tree Hole            | 匿名、克制、可控的心声墙。  |

> ⚠️ **非官方声明**: 本项目由学生自发维护,与深圳理工大学（SUAT）校方
> 无隶属关系。"深小狸校园" 是这个开源社区项目的名称,不代表学校的官方
> 立场。`SUAT` / `Shenzhen University of Advanced Technology` 在文案
> 中仅作为校园场景的语境说明。

当前仓库为 **前后端分离的 monorepo**：前端保留多页 HTML + TypeScript +
Tailwind 的设计体系，后端提供 Bun + Hono + SQLite API。课程评价、集市、技能互助、
匿名树洞、跨模块搜索和内容审核已接入本地持久化。初始数据是显式标注的本地演示数据，
登录也仅提供开发演示身份；上线前仍需接入学校认可的身份验证与持久化托管。

### Design language

The visual system is documented in [`docs/DESIGN.md`](docs/DESIGN.md) and
codified in [`frontend/tailwind.config.ts`](frontend/tailwind.config.ts) /
[`frontend/src/styles/tokens.css`](frontend/src/styles/tokens.css). It is
built around the **Deep Forest Emerald Academic** palette — deep forest
greens, off-white surfaces, serif headlines, and zero blue.

---

## 🚀 Tech stack

- **[Bun](https://bun.sh)** — package manager & script runner
- **[Hono](https://hono.dev)** — lightweight TypeScript API
- **SQLite** — local persistence for the MVP
- **[Vite](https://vitejs.dev)** — multi-page dev server & bundler
- **[Tailwind CSS](https://tailwindcss.com)** — utility-first styling with
  design tokens
- **[TypeScript](https://www.typescriptlang.org)** — strict, ESM-first
- **[ESLint](https://eslint.org) + [Prettier](https://prettier.io)** —
  formatting & linting

No framework lock-in. Each page is a plain HTML entry with shared chrome
pre-rendered by Vite before the first browser paint; see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the runtime model.

The API contract and deployment boundaries are documented in
[`backend/README.md`](backend/README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 📁 Project layout

A two-package monorepo. Each package owns its own dependencies and lockfile;
there is no shared root `node_modules`.

```
.
├── .github/
│   ├── ISSUE_TEMPLATE/          # Issue templates
│   ├── workflows/ci.yml         # Frontend and backend quality checks
│   ├── workflows/deploy.yml     # Static deploy
│   ├── dependabot.yml           # Monthly dependency update checks
│   └── PULL_REQUEST_TEMPLATE.md # Pull request checklist
├── docs/
│   ├── ARCHITECTURE.md          # Runtime model and extension guide
│   ├── DESIGN.md                # Deep Forest Emerald Academic design system
│   └── screenshots/             # Reference renders of each page
├── frontend/                    # Bun + Vite + Tailwind multi-page client
│   ├── public/
│   │   └── favicon.svg          # Site favicon
│   ├── src/
│   │   ├── index.html              # 首页     / Home (Vite entry)
│   │   ├── course-evaluation.html  # 评课     / Course Evaluation (Vite entry)
│   │   ├── market.html             # 集市     / Market (Vite entry)
│   │   ├── skill-mutual-aid.html   # 技能互助 / Skill Mutual Aid (Vite entry)
│   │   ├── tree-hole.html          # 树洞     / Tree Hole (Vite entry)
│   │   ├── moderation.html         # 内容审核 / Moderation (Vite entry)
│   │   ├── scripts/
│   │   │   ├── main.ts          # Shared auth, search, and page dispatch
│   │   │   ├── api.ts           # Typed API client and shared helpers
│   │   │   └── layout.ts        # Header/footer template functions
│   │   └── styles/
│   │       ├── main.css         # Tailwind entry + project resets
│   │       └── tokens.css       # Design tokens as CSS custom properties
│   ├── .prettierrc.json
│   ├── .prettierignore
│   ├── eslint.config.js
│   ├── bunfig.toml
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── package.json             # @shenxiaoli/frontend
├── backend/                     # Bun + Hono API and SQLite persistence
│   ├── src/app.ts               # API routes, auth, moderation and rate limits
│   ├── src/db.ts                # SQLite schema and demo seed data
│   ├── test/                    # API integration tests
│   └── README.md                # API, setup and production boundaries
├── .editorconfig
├── .gitattributes
├── .gitignore
├── rth-host.json                # Static-host deploy target
├── package.json                 # Root: delegating scripts only, no deps
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CHANGELOG.md
├── SECURITY.md
└── CODE_OF_CONDUCT.md
```

---

## 🛠️ Getting started

### Prerequisites

- [Bun](https://bun.sh) **>= 1.1** (`curl -fsSL https://bun.sh/install | bash`)
- A modern browser (Chrome / Edge / Firefox / Safari current)

### Install

```bash
bun run setup          # from the repo root — installs both packages
```

### Develop

```bash
bun run dev            # from the repo root — starts API and Vite together
```

The root `package.json` has no runtime dependencies. Each package owns its own
lockfile and dependencies; use `bun run dev:api` / `bun run dev:web` to start
only one service.

The dev server starts on <http://127.0.0.1:5173> and opens the Home page
automatically. Each page lives at:

- `/index.html` — Home
- `/course-evaluation.html` — 评课
- `/market.html` — 集市
- `/skill-mutual-aid.html` — 技能互助
- `/tree-hole.html` — 树洞
- `/moderation.html` — 内容审核（开发环境使用演示审核员登录）

Vite proxies `/api/*` and `/uploads/*` to the API on port `8787`. The first
local run enables development-only student and moderator demo accounts; select
one from the account menu in the header. **These accounts do not verify SUAT
enrollment and are disabled automatically in production.** Demo data is stored
in `backend/data/shenxiaoli.sqlite`; uploaded images are stored in
`backend/uploads/`. Both runtime directories are ignored by Git.

### Build for production

```bash
bun run build          # type-check and build both API and frontend
bun run test           # run backend API integration tests
bun run preview        # preview the static frontend only
```

### Lint / format / type-check

Run the root checks across both packages:

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
```

---

## 🧱 Adding a page

1. Drop a new HTML file into `frontend/src/`, e.g. `lost-and-found.html`.
2. Inside `<body>` place a `<div data-layout="header" data-active="lost-and-found"></div>`,
   then `<main>`, then `<div data-layout="footer"></div>`.
3. Register the entry in `frontend/vite.config.ts` under
   `build.rollupOptions.input`.
4. If it belongs in global navigation, add its `NavItem` to `NAV_ITEMS` in
   `frontend/src/scripts/layout.ts` and use that same key for `data-active`.

The shared header (with the active nav state), footer, and render-blocking
stylesheet are **pre-rendered into the HTML** by the
`shenxiaoli:inject-layout` plugin defined in `frontend/vite.config.ts`, so
there is no flash of unstyled chrome on first paint — the browser sees the
full page immediately.

---

## 🌍 Localization

UI copy is currently Chinese-only. To add another language:

1. Extract string literals into `frontend/src/scripts/i18n/<locale>.ts`.
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

- 灵感来自 **SUAT — 深圳理工大学 / Shenzhen University of Advanced
  Technology** 的校园文化。本项目由学生自发维护,与校方无关。
- 同类项目参考 / Inspired by other student-run 评课 & 校园社区:
  - [USTC iCourse](https://github.com/USTC-iCourse/ustc-course) — 中科大评课平台
  - [NWU.ICU](https://github.com/NWUCA/NWU.ICU) — 西北大学课程评价
  - [YourTJ](https://github.com/YourTongji/YourTJCourse-Serverless) — 同济选课社区
  - [jCourse](https://github.com/SJTU-jCourse/next) — 上交选课社区
  - [CourseBench](https://github.com/ShanghaitechGeekPie/coursebench-next) — 上科大 CourseBench
- Design system adapted from the **Deep Forest Emerald Academic** palette.
- Built with open-source tooling: Bun, Vite, Tailwind CSS, TypeScript.
