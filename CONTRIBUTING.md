# 参与深小狸校园

欢迎参与功能开发、设计反馈、测试和文档修正。项目包含已实现的前端与后端；协作须遵守
[行为准则](CODE_OF_CONDUCT.md)。

## 安装与开发

推荐使用与 CI/Docker 一致的 Bun 1.3.14。Fork 并克隆仓库后，在根目录执行：

```bash
bun run setup
bun run dev
```

前端默认在 `http://127.0.0.1:5173`，API 在 `http://127.0.0.1:8787`。根目录协调脚本
同时启动两个服务；两包独立维护依赖和锁文件，不在根目录安装共享依赖。
`bun run dev:web` 和 `bun run dev:api` 可分别启动服务。

本地默认提供学生和审核员演示登录及合成数据，数据库、上传及真实环境文件忽略于 Git。
真实邮箱和独立 worker 联调见[运维说明](docs/OPERATIONS.md)。
`bun run preview` 只预览静态前端，不能替代 API 联调。

| 位置                                                  | 职责                                 |
| ----------------------------------------------------- | ------------------------------------ |
| `frontend/src/*.html`                                 | 九个 Vite 页面入口                   |
| `frontend/src/scripts/`                               | 公共布局、认证、API 辅助与各页面模块 |
| `frontend/src/styles/`、`frontend/tailwind.config.ts` | 样式与设计令牌                       |
| `frontend/vite.config.ts`                             | 入口注册、HTML 转换与开发代理        |
| `backend/src/app.ts`                                  | 业务路由、权限、校验、限流和治理     |
| `backend/src/db.ts`                                   | schema、迁移与演示数据               |
| `backend/src/auth.ts`、`backend/src/worker.ts`        | 邮箱认证、邮件消费与清理任务入口     |
| `backend/test/`                                       | 内存 SQLite API 集成测试             |
| `docs/`、`ops/`                                       | 架构、设计、运维与备份/恢复脚本      |
| `package.json`（根目录）                              | 双包协调命令                         |

## 变更与检查流程

1. 从 `main` 创建有明确用途的分支，例如 `feat/course-filter`、`fix/message-cursor` 或 `docs/api-reference`。
2. 保持提交聚焦于一项可审阅的行为，避免覆盖他人的未提交改动。
3. 根据改动运行对应检查；提交前从根目录运行双包检查：

   ```bash
   bun run lint
   bun run format:check
   bun run typecheck
   bun run test
   bun run build
   ```

4. 向 `main` 提交 PR，填写[模板](.github/PULL_REQUEST_TEMPLATE.md)，说明行为变化、验证结果及未覆盖的条件。UI 改动附前后截图。

根目录 `test` 运行后端集成测试，`build` 分别安装锁定依赖并构建两包；前端构建包含
类型检查。CI 分前后端及浏览器任务执行；后端运行 API 测试，浏览器任务覆盖桌面与手机视口并上传报告，前端上传构建产物。浏览器测试需 Node.js 20 或更新版本，运行步骤见[本地测试说明](docs/LOCAL_TESTING.md)。根目录格式命令
不会自动覆盖根目录和 `docs/` 中的 Markdown，文档改动需额外检查，例如：

```bash
cd frontend
bunx --no-install prettier --check ../README.md ../CONTRIBUTING.md ../CHANGELOG.md ../SECURITY.md ../CODE_OF_CONDUCT.md ../backend/README.md ../docs/ARCHITECTURE.md ../docs/OPERATIONS.md
bunx --no-install prettier --check --single-quote ../docs/DESIGN.md
```

设计文档沿用既有 YAML 单引号格式，因此单独使用 `--single-quote`。需要格式化时
将上述命令的 `--check` 改为 `--write`，不要为了文档改动批量重写业务代码。
无行为改动的文档更新通常无需新增测试，但须检查链接、命令、环境变量与真实实现一致。

## API、数据与隐私变更

- 更新接口时同步[后端 API](backend/README.md)，核对方法、请求字段、响应、角色与资源归属；新增页面同步 README 和[架构说明](docs/ARCHITECTURE.md)。
- 修改数据库时在 `schema_migrations` 机制中提供迁移，验证旧数据保留；同步启动、就绪和恢复对迁移版本的要求。生产显式迁移，不依赖 API/worker 隐式升级。
- 测试使用内存数据库与邮件替身；真实收信、HTTPS、图片访问和 Restic 恢复需单独验收。不要向生产数据执行开发测试。
- 校园邮箱验证只证明邮箱控制权；树洞普通展示须隐藏账号标识，私信按参与者授权。避免在接口、日志、截图或测试夹具中暴露真实隐私与凭据。
- 账号注销、证据保留和邮件行为的修改应同步运维与隐私说明，不把软删除或部分清理描述成所有历史数据即时销毁。

图片读取已覆盖会话解析并有接口及浏览器回归。修改该功能时须检查已登录请求实际能读取，
以及访客访问被拒绝，而不能只检查上传成功。其余前端入口缺口和验证边界见[测试报告](docs/TEST_REPORT.md)。

## 设计与可访问性

沿用[设计规范](docs/DESIGN.md)。修改颜色、排版或间距令牌时，同时同步：

- `frontend/tailwind.config.ts`
- `frontend/src/styles/tokens.css`
- `docs/DESIGN.md`

页面扩展保持 Vite 注入公共布局和首屏样式的机制。验证空列表、未登录、加载失败、
长文本、窄屏、键盘操作和焦点可见性；状态同时使用文字表达，避免仅靠颜色。
早期 `docs/screenshots/` 是设计参考；更新截图时使用合成数据并说明对应页面与状态。

## 提交、问题与发布记录

提交和 PR 标题推荐使用 Conventional Commits 风格，例如
`feat(market): add listing filter`。问题报告使用[Issue 模板](.github/ISSUE_TEMPLATE/)，
提供期望/实际行为、复现步骤、页面路径、环境及已脱敏的错误信息。
安全问题按[安全政策](SECURITY.md)私密报告，不提交公共漏洞复现细节。

功能及行为变更记录到 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased`；维护者实际发布时
再整理版本和日期。部署、迁移、备份或恢复步骤变化同步[运维文档](docs/OPERATIONS.md)。
