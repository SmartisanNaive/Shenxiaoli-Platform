# 后端 API

深小狸校园后端使用 Bun + Hono + SQLite，校园邮箱认证使用 Better Auth email OTP，
邮件通过 Resend 发送。浏览器客户端使用同源 `/api`，业务路由定义于
[`src/app.ts`](src/app.ts)，认证配置见 [`src/auth.ts`](src/auth.ts)。

## 本地运行

从仓库根目录执行：

```bash
bun run setup
bun run dev
```

API 默认地址为 `http://127.0.0.1:8787`，前端为 `http://127.0.0.1:5173`。
Vite 代理 `/api/*` 和 `/uploads/*`。本地默认启用合成数据和学生/审核员演示登录；
生产模式禁止演示登录，且不种入开发数据。数据库和图片默认位于 `backend/data/`
与 `backend/uploads/`，相对环境变量路径以进程工作目录解析。

开发时迁移随 API 启动执行；Compose 将 `RUN_MIGRATIONS=false`，须先显式迁移。
根目录开发命令不启动 worker；真实邮件和周期清理的配置见
[运维文档](../docs/OPERATIONS.md)。

## 认证、权限与请求约定

校园邮箱只接受精确的 `stu.suat-sz.edu.cn` 与 `suat-sz.edu.cn` 域名，输入会去除首尾空格
并转成小写，子域名不在允许范围内。验证证明邮箱控制权，不证明学籍或实名身份。
外部邮箱不能注册，也不会自动获得管理员权限。已验证的校园账号可再验证并绑定辅助
邮箱；辅助邮箱仅用于恢复原账号，不能替代首次校园邮箱验证。
密码登录关闭；登录验证码为 6 位、5 分钟有效、最多 5 次校验尝试，同一邮箱发送冷却
60 秒。验证码由 API 直接调用 Resend 发送，不经过通知队列。

正式账号由 Better Auth 管理，已验证的认证用户通过请求同步到业务 `users` 表。
演示账号使用另一套开发 cookie，会话有效期 14 天，只存储令牌摘要；不要将演示会话
规则套用于 Better Auth。浏览器应携带 cookie，前端 `api()` 已设置
`credentials: 'same-origin'`，不要把会话令牌放入 URL。

下文表格使用以下权限简称，资源归属检查仍需同时满足：

| 权限     | 含义                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| 公开     | 不要求业务登录；反馈、验证码和 webhook 仍有各自校验                                           |
| 会话     | 必须有业务会话；申诉保留此入口，不通过普通封禁检查                                            |
| 用户     | 已登录，且账号不是 `banned` 或 `deleting`；`suspended` 可使用部分读取和自助接口               |
| 活跃用户 | 用户权限且不处于 `suspended`，可发布与互动                                                    |
| 审核员   | 活跃用户，角色为 `moderator` 或 `admin`                                                       |
| 管理员   | 活跃用户，角色为 `admin`；由已验证校园账号的授权命令设置业务表 `is_admin`，邮箱域不会自动授予 |

写入请求若带有 `Origin`，业务中间件接受请求同源地址或 `ALLOWED_ORIGINS` 列表中的地址；
未携带 `Origin` 的请求不会被该检查拒绝，Better Auth 另执行其认证校验。API 没有通用
跨域开放配置，正式服务应经 Caddy 同源访问。

通常使用 JSON 请求体及 `Content-Type: application/json`；图片上传使用 multipart，字段
为 `file`。业务错误通常返回：

```json
{ "error": { "code": "AUTH_REQUIRED", "message": "请先登录后再操作" } }
```

| HTTP 状态     | 常见情况                                                            |
| ------------- | ------------------------------------------------------------------- |
| `400`         | 输入、邮箱域、验证码或消息游标不合法                                |
| `401`         | 缺少业务会话                                                        |
| `403`         | 账号受限、无角色/资源权限、来源不受信任或双方屏蔽                   |
| `404`         | 资源不存在、无权访问私有资源、演示接口已禁用或导入预览失效          |
| `409`         | 重复评价/举报、互助状态冲突或记录已处理                             |
| `410`         | 邮箱仍处于注销清理窗口                                              |
| `413` / `415` | 图片过大或类型/文件签名不合法                                       |
| `422`         | CSV 行校验失败，返回 `{ valid: false, errors: [{ row, message }] }` |
| `429`         | 请求过于频繁或验证码仍在冷却                                        |
| `500` / `503` | 服务异常、邮件/回执未配置或数据库未就绪                             |

Better Auth 自身的响应和错误格式由认证处理器返回，不保证与业务错误外层一致。

### 分页与搜索

普通列表接受 `page`（默认 1）和 `pageSize`（默认 20，最大 100），一般返回
`{ items, total, page, pageSize }`。按类型搜索返回 `results`，教师详情返回
`offerings`，通知另含 `unread`；不能假设所有接口共享同一顶层字段。

树洞兼容 `limit/offset`，返回 `hasMore`。私信列表使用消息 ID 游标：

- 不带游标或带 `before`：按时间、ID 倒序，返回 `items/nextCursor/hasMore`。
- 带 `after`：按时间、ID 正序取新消息，当前返回 `nextCursor: null, hasMore: false`，单次仍最多 `pageSize` 条；客户端持续用最后收到的 ID 拉取。
- `before` 与 `after` 不能同时传入；游标须属于该会话且尚未删除。

## API 路由

表中的 `:id` 等为路径参数；未列为独立业务路由的 Better Auth 操作由
`/api/auth/*` 通配处理器接管。

### 服务、登录与账号

| 方法  | 路径                                        | 权限与行为                                                                    |
| ----- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| GET   | `/api/health`                               | 公开；存活状态                                                                |
| GET   | `/api/ready`                                | 公开；数据库访问和迁移版本检查，当前要求至少版本 10                           |
| GET   | `/api/session`                              | 公开；`authenticated/user/demoAuthAvailable/campusEmailVerified`              |
| POST  | `/api/feedback`                             | 公开；`subject/message/email`，未登录者须提供校园邮箱；此提交不验证邮箱控制权 |
| POST  | `/api/auth/email-otp/send-verification-otp` | 公开；`email/type`，登录使用 `type: 'sign-in'`                                |
| POST  | `/api/auth/sign-in/email-otp`               | 公开；`email/otp/name`，验证码验证后注册或登录                                |
| POST  | `/api/auth/sign-out`                        | Better Auth 正式账号退出                                                      |
| POST  | `/api/auth/email-otp/request-email-change`  | Better Auth 邮箱变更流程；`newEmail` 须为校园邮箱                             |
| POST  | `/api/auth/email-otp/change-email`          | Better Auth 验证邮箱变更；须验证当前邮箱并完成新邮箱验证                      |
| POST  | `/api/auth/demo`                            | 仅开发；`role: 'student'` 或 `'moderator'`                                    |
| POST  | `/api/auth/logout`                          | 清除开发演示会话；正式账号使用 Better Auth sign-out                           |
| PATCH | `/api/me/profile`                           | 用户；`displayName`（2–40 字）                                                |
| POST  | `/api/me/sessions/revoke`                   | 用户；撤销该用户的演示与 Better Auth 会话                                     |
| POST  | `/api/me/account/deletion-code`             | 用户且邮箱已验证；发送注销验证码                                              |
| POST  | `/api/me/account/delete`                    | 用户；`otp`，确认后立即停用账号、撤销会话并隐藏发布内容                       |

### 内容、目录与搜索

| 方法  | 路径                       | 权限与行为                                                                        |
| ----- | -------------------------- | --------------------------------------------------------------------------------- |
| GET   | `/api/home`                | 用户；首页统计与内容聚合                                                          |
| GET   | `/api/search`              | 用户；`q`，可选 `type=course/listing/skill/tree-hole`；不指定类型时提供跨模块建议 |
| GET   | `/api/courses`             | 用户；`q/department/courseType/enrollmentType/term/assessment` 筛选               |
| GET   | `/api/courses/:id`         | 用户；支持课程 ID 或代码，包含开课和教师关系                                      |
| GET   | `/api/courses/:id/reviews` | 用户；可按 `teacherId` 筛选                                                       |
| POST  | `/api/courses/:id/reviews` | 活跃用户；直接发布，同一课程、用户、学期只能评价一次                              |
| GET   | `/api/teachers`            | 用户；`q` 搜索教师                                                                |
| GET   | `/api/teachers/:id`        | 用户；教师及分页开课记录                                                          |
| GET   | `/api/market/listings`     | 用户；`q/category` 筛选可见在售商品                                               |
| POST  | `/api/market/listings`     | 活跃用户；发布商品，最多关联 4 张上传图片                                         |
| PATCH | `/api/market/listings/:id` | 活跃用户且为卖家；`status=active/reserved/sold`                                   |
| GET   | `/api/skills`              | 用户；`kind=offer/request`、`category` 筛选                                       |
| POST  | `/api/skills`              | 活跃用户；发布技能分享或求助                                                      |
| GET   | `/api/tree-hole`           | 用户；`topic`、`sort=recent/popular` 和分页                                       |
| POST  | `/api/tree-hole`           | 活跃用户；`content/topic`，直接发布、匿名展示                                     |
| POST  | `/api/tree-hole/:id/feel`  | 活跃用户；切换共鸣状态                                                            |
| POST  | `/api/uploads`             | 活跃用户；JPEG/PNG/WebP，单张 4 MB，校验文件签名并随机命名                        |
| GET   | `/uploads/:filename`       | 用户；读取已上传图片，访客拒绝访问，私有缓存                                      |

评价字段为 `rating`（1–10）、`difficulty/workload`（1–5）、`content`（10–1200 字）、
`term`（3–40 字）、可选 `tags/offeringId`。指定开课时会校验归属并使用该开课学期；
当前仍须提交合法的 `term` 字段。树洞正文长度为 5–1000 字。

### 发布维护、收藏、评论与通知

| 方法           | 路径                             | 权限与行为                                                    |
| -------------- | -------------------------------- | ------------------------------------------------------------- |
| GET            | `/api/me/publications`           | 用户；只返回自己的发布记录                                    |
| PATCH          | `/api/publications/:type/:id`    | 用户且为作者；修改可见、未删除内容，保存修改前快照            |
| DELETE         | `/api/publications/:type/:id`    | 用户且为作者；软删除                                          |
| GET            | `/api/favorites`                 | 用户；个人收藏                                                |
| POST / DELETE  | `/api/favorites/:type/:id`       | 用户；收藏或取消收藏                                          |
| GET            | `/api/comments`                  | 用户；`targetType/targetId`，目标须可见                       |
| POST           | `/api/comments`                  | 活跃用户；`targetType/targetId/content`，可选 `parentId` 回复 |
| PATCH / DELETE | `/api/comments/:id`              | 活跃用户且为作者；编辑或删除评论                              |
| GET            | `/api/notifications`             | 用户；个人通知及未读总数                                      |
| PATCH          | `/api/notifications/:id`         | 用户且为接收者；标为已读                                      |
| POST           | `/api/notifications/read-all`    | 用户；全部标为已读                                            |
| GET / PATCH    | `/api/notifications/preferences` | 用户；读取或设置 `socialEmailEnabled`（boolean）              |

发布、收藏和评论目标类型使用 `review/listing/skill/tree-hole`。
树洞与其评论的普通展示不返回作者账号 ID；评论使用同帖匿名标识，仍可能返回
`isMine` 等当前用户自己的操作状态。治理状态与商品/互助业务状态分开存储，
已下架发布内容不能通过编辑接口恢复，需申请复核。

### 联系请求与私信

| 方法   | 路径                               | 权限与行为                                                       |
| ------ | ---------------------------------- | ---------------------------------------------------------------- |
| POST   | `/api/market/listings/:id/contact` | 活跃用户；向其他卖家发起联系请求                                 |
| POST   | `/api/skills/:id/contact`          | 活跃用户；向其他发布者发起联系请求                               |
| GET    | `/api/me/contact-requests`         | 用户；自己发送或接收的请求                                       |
| PATCH  | `/api/me/contact-requests/:id`     | 活跃用户；接收者 `accepted/declined`，发起者 `cancelled`         |
| GET    | `/api/conversations`               | 用户；自己参与的会话                                             |
| GET    | `/api/conversations/:id/messages`  | 用户且为参与者；游标分页                                         |
| POST   | `/api/conversations/:id/messages`  | 活跃用户且为参与者；`body`（1–2000 字）及 `clientId`（8–100 字） |
| POST   | `/api/conversations/:id/read`      | 用户且为参与者；更新当前已读时间                                 |
| POST   | `/api/messages/:id/report`         | 用户且为参与者；举报他人消息，`reason`（3–300 字）               |
| GET    | `/api/me/blocks`                   | 用户；屏蔽列表                                                   |
| POST   | `/api/me/blocks/:userId`           | 活跃用户；添加屏蔽                                               |
| DELETE | `/api/me/blocks/:userId`           | 用户；解除屏蔽                                                   |

联系请求被接受时创建或复用双方会话，响应包含 `conversationId`。任一方向的屏蔽会阻止
接受请求和发消息。相同发送者的 `clientId` 用于消息去重，重试成功时可能返回
`200` 与 `duplicate: true`。审核员没有普通接口的全量会话读取权限；消息举报会保存
被举报消息与有限邻近上下文作为证据，审核队列读取被举报消息会写入审计。

### 互助协作

| 方法  | 路径                                      | 权限与行为                                                                  |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------- |
| GET   | `/api/skills/stats`                       | 用户；真实互助统计，开发记录单独识别                                        |
| GET   | `/api/skills/recommendations`             | 用户；`requestId` 必须是自己的求助，按同类和标签重合推荐                    |
| POST  | `/api/skills/requests/:id/collaborations` | 活跃用户且持有自己的分享帖；`offerPostId/scope`，申请帮助其他人的求助       |
| GET   | `/api/me/collaborations`                  | 用户；自己参与的互助                                                        |
| PATCH | `/api/collaborations/:id`                 | 活跃用户且为参与者；`action=accept/decline/cancel/confirm-complete/dispute` |
| POST  | `/api/collaborations/:id/feedback`        | 活跃用户且为参与者；完成后提交 `rating`（1–5）与可选 `content`              |

`proposed` 由求助者接受后进入 `active`；双方都确认后才变为 `completed`，每人仅能
反馈一次。拒绝或取消进入 `cancelled`，进行中的合作可提出争议进入 `disputed`。
审核员可恢复进行或取消合作；恢复时清除原完成确认，双方需重新确认。

### 治理、课程管理与邮件回执

| 方法  | 路径                                    | 权限与行为                                                                                            |
| ----- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST  | `/api/reports`                          | 用户；`targetType/targetId/reason`，普通内容举报；私信使用专用消息举报接口                            |
| GET   | `/api/me/appeals`                       | 会话；自己的可申诉处置与复核记录                                                                      |
| POST  | `/api/me/appeals`                       | 会话且为内容作者；`caseId/reason`，申请复核                                                           |
| GET   | `/api/admin/queue`                      | 审核员；历史待审内容、未结举报及互助争议                                                              |
| POST  | `/api/admin/reports/:id/action`         | 审核员；`action=dismiss/hide/remove/warn/mute/ban`、`reason`；禁言可传 `durationDays`（1–30，默认 7） |
| POST  | `/api/admin/collaborations/:id/resolve` | 审核员；`outcome=resume/cancel`、`reason`                                                             |
| GET   | `/api/admin/appeals`                    | 审核员；待复核记录                                                                                    |
| PATCH | `/api/admin/appeals/:id`                | 审核员且非原处理人；`outcome=restore/uphold`、`reason`                                                |
| PATCH | `/api/admin/:type/:id`                  | 审核员；`type=reviews/tree-hole`，`status=approved/rejected`，处理历史待审内容                        |
| GET   | `/api/admin/courses/import-template`    | 管理员；CSV 表头模板                                                                                  |
| POST  | `/api/admin/courses/import-preview`     | 管理员；`filename/csv`，校验并创建预览                                                                |
| POST  | `/api/admin/courses/import-confirm`     | 管理员；`previewId`，事务提交导入                                                                     |
| PATCH | `/api/admin/courses/:id`                | 管理员；设置 `active`（boolean）                                                                      |
| PATCH | `/api/admin/teachers/:id`               | 管理员；`name/department/bio/active`                                                                  |
| POST  | `/api/webhooks/resend`                  | 无业务登录；验证 `svix-id/svix-timestamp/svix-signature` 与 webhook secret，按事件 ID 去重            |

复核 `restore` 可恢复符合条件的隐藏内容并撤销本案处罚，不保证恢复已软删除的普通内容。
审计记录内部持久化，目前没有独立的通用审计浏览 API。

## 调用示例

以下示例在浏览器打开本地前端后，于控制台执行。同源请求自动携带当前会话；真实邮箱
示例须替换地址与验证码，且先完成邮件配置。不要把验证码或会话写入提交记录。

```js
const email = "your.name@stu.suat-sz.edu.cn";
await fetch("/api/auth/email-otp/send-verification-otp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, type: "sign-in" }),
});
// 读取收件箱后填入本次验证码。
await fetch("/api/auth/sign-in/email-otp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, otp: "替换为六位验证码", name: "狸友" }),
});
const session = await fetch("/api/session").then((r) => r.json());
console.log(session.authenticated, session.campusEmailVerified);
```

本地演示可改用 `POST /api/auth/demo`，JSON 为 `{ "role": "student" }`。
登录后读取内容与发布树洞：

```js
const courses = await fetch("/api/courses?page=1&pageSize=20").then((r) =>
  r.json(),
);
const response = await fetch("/api/tree-hole", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    content: "这是本地开发环境的测试树洞。",
    topic: "校园生活",
  }),
});
console.log(response.status, await response.json()); // 201、status: 'approved'
```

## 辅助邮箱恢复 API

所有路径均以 `/api/auth/recovery-email` 开头。设置操作要求已验证、未封禁或注销的正式
校园账号会话；恢复登录成功后建立同一用户的 Better Auth 会话。

| 方法 | 后缀              | 请求与结果                                                                                       |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------ |
| GET  | 空                | 返回自己的 `email`、`verifiedAt`；未绑定时为 null                                                |
| POST | `/change/request` | `email` 为新辅助邮箱，`method=campus/auxiliary`；首次仅允许 campus；返回 `challengeId/expiresIn` |
| POST | `/change/confirm` | `challengeId/currentOtp/newOtp`；同时验证当前与新邮箱，保存后撤销所有会话                        |
| POST | `/remove/request` | `method=campus/auxiliary`；返回解绑挑战                                                          |
| POST | `/remove/confirm` | `challengeId/otp`；解绑并撤销所有会话                                                            |
| POST | `/login/request`  | `email` 必须为注册时的校园邮箱；只发送到已绑定辅助邮箱，返回挑战，不公开是否存在账号             |
| POST | `/login/confirm`  | `email/challengeId/otp`；成功登录原账号，不修改主邮箱或权限                                      |

辅助验证码按挑战、用途、账号和目标邮箱隔离，仅保存 HMAC 哈希，5 分钟有效、最多
5 次错误、60 秒重发冷却，成功后不可重放。修改或解绑使该账号其他恢复挑战失效。
验证码发送及绑定步骤失败时不会产生已验证辅助邮箱。注销时由外键删除辅助邮箱和挑战。
主邮箱更换和账号注销继续使用校园邮箱验证。

仅本地测试模式启用 `/api/testing/status`、`/inbox` 和 `/reset`，并限制本机 Host/Origin。
重置要求 `confirmation=RESET_LOCAL_TEST_DATABASE`。真实邮箱不进入本地明文收件箱。
详见[本地测试说明](../docs/LOCAL_TESTING.md)。

## 管理员与 CSV 导入

管理员必须先用校园邮箱完成验证码登录，再在 `backend/` 工作目录执行授权命令。
`ADMIN_EMAIL` 已取消，不再按外部邮箱或配置地址自动授权。

```bash
bun run admin:grant name@suat-sz.edu.cn
```

命令要求数据库已迁移、邮箱属于允许域且在 `auth_users` 中已验证；生产容器的等价命令
见运维文档。演示审核员不能通过正式邮箱授权命令替代已验证账号。

CSV 每行描述一个开课记录与一个教师的关联，多个教师可占多行。示例完全为测试数据：

```csv
courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment
TEST100,测试课程,测试学院,3,2026秋,A,TC001,测试教师甲,测试学院
TEST100,测试课程,测试学院,3,2026秋,A,TC002,测试教师乙,测试学院
```

表头九列都必须存在；CSV 文本长度最大 1,000,000。同一课程信息应一致，同一开课不能重复关联同一
教师；学分为 0–50。先下载模板，调用预览检查逐行错误或新增/已有课程及开课数量，
再由同一管理员在 30 分钟内用 `previewId` 确认。确认在事务中更新课程、教师和开课，
替换所涉开课的教师关联并记录导入批次；预览本身不提交目录更改，确认后预览失效。

已登录管理员可在控制台用以下方式预览（`csv` 替换为上述完整 CSV 字符串）：

```js
const csv = `courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment
TEST100,测试课程,测试学院,3,2026秋,A,TC001,测试教师甲,测试学院`;
const previewResponse = await fetch("/api/admin/courses/import-preview", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ filename: "test-courses.csv", csv }),
});
const preview = await previewResponse.json();
console.log(preview); // 人工确认 valid、summary 和差异后，再单独执行下面的确认。
```

```js
await fetch("/api/admin/courses/import-confirm", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ previewId: preview.previewId }),
});
```

## 数据保留、检查与上线边界

注销确认立即停用账号、隐藏内容、撤销会话并删除认证账号。业务邮箱等身份资料保留
30 天，期间阻止该邮箱再次注册；worker 启动时及每 6 小时清理到期身份资料、部分内容
正文和修订记录。到期举报证据也由该任务清理，处置时设定 180 天到期时间；未结证据
未设置到期时间。并非所有业务历史、私信、上传文件或旧备份都会删除。

图片读取与 API 使用相同的会话解析；演示 Cookie 的路径为 `/`，退出时同时清理历史
`/api` 路径 Cookie。登录后的图片请求可以正常携带会话。

从仓库根目录执行检查：

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
```

API 集成测试使用内存 SQLite 和注入的邮件发送函数，不发送真实邮件；当前覆盖登录、
发布与维护、互动、私信、互助、举报复核、注销、CSV 和迁移等行为。它们不验证真实
Resend 投递、Docker HTTPS、图片读取闭环或异地恢复。

正式上线需完成[运维验收](../docs/OPERATIONS.md)：服务器/DNS、发件域、双域收信、
持久化数据、管理员、真实课程、治理流程、备份与恢复。SSO、学籍核验和教务自动同步
尚未实现。静态部署工作流只发布前端。
