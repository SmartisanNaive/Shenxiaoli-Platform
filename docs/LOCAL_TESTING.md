# 本地全功能测试

## 启动与数据隔离

需要 Bun 1.3.14；浏览器测试另需 Node.js 20 或更新版本。先在仓库根目录安装依赖：

```bash
bun run setup
bun run test:local
```

前端为 <http://127.0.0.1:5174>，API 为 <http://127.0.0.1:8788>。启动命令同时运行
API、Vite 和邮件 worker；任一进程退出时停止其他进程。按 Ctrl+C 停止本轮服务。

数据库、上传目录和独立生成的会话密钥位于 `.local-test/manual/`，不会使用
`backend/data/` 或 `backend/uploads/`。测试 API 只监听本机；生产模式拒绝启动测试
工具。根目录原有数据库和部署环境不会被测试命令重置。

页面左下角的“本地测试工具”显示合成身份、worker 状态和本地收件箱。选择合成身份
会正常申请并验证验证码。工具中的重置操作会清空独立数据库中的全部账号、内容、邮件
及测试上传文件，也包括在此库中通过真实邮箱注册的账号。原开发数据库不受影响。

需要彻底删除独立运行目录并重新启动时执行：

```bash
bun run test:local:reset
```

## 合成身份与邮件

| 身份         | 邮箱                              | 权限                   |
| ------------ | --------------------------------- | ---------------------- |
| 测试同学 A   | `test.user.a@stu.suat-sz.edu.cn`  | 普通用户               |
| 测试同学 B   | `test.user.b@suat-sz.edu.cn`      | 普通用户               |
| 测试审核员 A | `test.moderator.a@suat-sz.edu.cn` | 审核、处置、争议处理   |
| 测试审核员 B | `test.moderator.b@suat-sz.edu.cn` | 另一人员独立复核       |
| 测试管理员   | `test.admin.a@suat-sz.edu.cn`     | 审核权限及课程管理 API |

这些账号仅为合成测试身份，不代表真实邮箱或学校认证。仅本地测试模式预置已验证的
合成身份；实际登录仍经过现有验证码及会话流程。

本地模式将以下严格匹配的合成地址投递到 SQLite 收件箱：

```text
test.(user|moderator|admin).<小写字母、数字、点或连字符>@stu.suat-sz.edu.cn
test.(user|moderator|admin).<同上>@suat-sz.edu.cn
test.(user|moderator|admin).<同上>@example.test
```

其他收件人使用正常的 Resend 服务，真实验证码不会展示在本地收件箱。
需要真实收信时，在仓库根目录的 `.env.local` 配置 `RESEND_API_KEY` 和已认证的
`RESEND_FROM`，再重启 `bun run test:local`。密钥和此文件均不得提交。
真实校园邮件本轮曾进入垃圾箱，未在收件箱找到时应同时检查垃圾箱，验证码仍只有 5 分钟有效。

## 同一真实账号的两阶段测试

1. 打开页眉登录入口，使用自己的 SUAT 邮箱申请验证码；在真实邮箱收信并完成登录。
2. 此时账号为普通用户。测试发布、评论、私信、互助和个人中心，并确认管理员 API 返回 403。
3. 在“个人中心 → 账号设置”绑定辅助邮箱。首次绑定需同时输入校园邮箱与新辅助邮箱的验证码。
4. 绑定后所有旧会话被撤销；在页眉勾选“通过已绑定的辅助邮箱接收登录验证码”，仍填写 SUAT 主邮箱，以辅助邮箱收到的验证码登录原账号。
5. 普通用户阶段完成后，另开终端，从仓库根目录授予该已验证校园账号管理员权限：

```bash
DATABASE_PATH="$PWD/.local-test/manual/database.sqlite" bun run backend/src/admin.ts grant-admin your.name@stu.suat-sz.edu.cn
```

6. 刷新页面，检查审核入口及管理员 API。身份仍为同一个用户，原发布和绑定记录保留。

修改或解绑辅助邮箱需要重新验证校园邮箱或当前辅助邮箱；修改时还须验证新邮箱。
辅助验证仅恢复原账号登录，主邮箱更换和注销继续使用校园邮箱验证码。
注册和更换主邮箱支持所有有效邮箱；`ADMIN_EMAIL` 自动授权已取消。

双用户互动及原处理人不得复核自己的申诉，应使用额外的合成身份配合。注销、封禁和
清理测试使用合成账号或数据库副本。真实邮箱的服务商受理、实际到达和验证码验证结果
必须分别记录；接口 200 不等于已经由人确认收件。

## 自动化与报告

```bash
bun run test
bun run lint
bun run typecheck
bun run format:check
bun run build

cd frontend
bunx playwright install chromium
cd ..
bun run test:e2e
```

后端用例使用内存数据库及临时文件，邮件发送均被测试替身接收。浏览器用例启动独立
的 `.local-test/e2e/` 环境，前端 5176、API 8790，每例重置测试数据库，覆盖桌面和手机
视口。主环境 5174 和 E2E 环境可以同时运行。

浏览器报告位于 `frontend/playwright-report/index.html`，截图和失败跟踪位于
`frontend/test-results/`。生成目录均忽略于 Git。CI 使用同一套检查和浏览器用例，且
不会向真实邮箱发信。

功能、缺陷及人工验收状态见[测试报告](TEST_REPORT.md)。课程管理和添加收藏等缺少前端
入口的能力通过 API 验证，并在报告中列出入口缺口。
