# 运行配置、生产部署与恢复

当前部署路径为单实例 Bun/Hono API、SQLite、独立邮件与清理 worker，以及 Caddy。
本文命令除特别标注外均从仓库根目录执行。静态前端部署只提供预览文件。

## 运行方式与配置变量

| 方式               | 特征                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| 本地 `bun run dev` | API + Vite，默认开启开发数据与演示登录，自动迁移，不自动启动 worker       |
| 静态预览/托管      | 只有前端产物，不包含 API、数据库、上传、邮件或开发代理                    |
| Docker Compose     | 固定 `NODE_ENV=production`、演示登录关闭、独立迁移、持久化数据卷和 worker |

`.env.production.example` 和 `.env.demo.example` 是站点变量示例。后者虽然标注为
非生产演示/预发布配置，但当前 `compose.yaml` 固定采用生产模式；复制它不会启用
演示账号、合成数据或放宽生产检查。示例域名、密钥和密码路径均须替换。

| 变量                    | 本地默认/要求                              | Compose 行为                                                     |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `NODE_ENV`              | 未设置时按开发处理                         | 固定 `production`                                                |
| `DEMO_AUTH_ENABLED`     | 默认非生产为 `true`，可显式关闭            | 固定 `false`；生产开启会拒绝启动                                 |
| `RUN_MIGRATIONS`        | 默认执行，`false` 关闭版本迁移             | API 固定 `false`；migrate 任务为 `true`；worker 自身禁用版本迁移 |
| `PORT`                  | 默认 `8787`                                | 固定容器端口 `8787`，不向宿主机发布                              |
| `DATABASE_PATH`         | 默认 `backend/data/shenxiaoli.sqlite`      | 固定 `/data/shenxiaoli.sqlite`，挂载 `sqlite-data`               |
| `UPLOADS_PATH`          | 默认 API 工作目录的 `./uploads`            | 固定 `/uploads`，挂载 `uploads`                                  |
| `SESSION_SECRET`        | 开发可使用代码默认值；真实部署须另设       | 必填，至少 32 字符，使用随机值                                   |
| `BETTER_AUTH_URL`       | 默认 `http://127.0.0.1:8787`               | 必填，设为浏览器访问的 HTTPS 站点 origin                         |
| `ALLOWED_ORIGINS`       | 默认包含本地 5173 来源，逗号分隔           | 必填，配置实际 HTTPS 来源                                        |
| `SITE_ADDRESS`          | 原生开发不使用                             | Caddy 的公开主机名，通常不包含协议                               |
| `RESEND_API_KEY`        | 真实验证码和通知邮件需要                   | 必填                                                             |
| `RESEND_FROM`           | 已认证发件域上的发件地址                   | 必填                                                             |
| `RESEND_WEBHOOK_SECRET` | 本地仅验证邮件发送时可不设置，回执接口需要 | 必填，用于验证 Resend 回执签名                                   |
| `RESTIC_REPOSITORY`     | 备份脚本使用的异地仓库地址                 | 宿主机配置，不注入应用服务                                       |
| `RESTIC_PASSWORD_FILE`  | Restic 密码文件路径                        | 宿主机配置，密码文件独立保护                                     |

API 原生进程的相对数据路径以进程工作目录解析。Compose 的运行参数由配置固定或
显式映射，不能假定在根 `.env` 中增加变量会自动传入容器。

### 本地真实邮箱联调

`backend/.env.example` 只包含基础开发配置，不是完整的邮件配置。准备后端环境文件：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 添加/设置随机 `SESSION_SECRET`、
`BETTER_AUTH_URL=http://127.0.0.1:5173`、对应 `ALLOWED_ORIGINS`、
`RESEND_API_KEY` 和已认证的 `RESEND_FROM`。然后重启 `bun run dev`。
端口变化时同时调整 origin 与认证 URL。需要回执联调时，还须配置 webhook secret
与能接收 Resend 回调的地址。

登录和注销验证码在 API 请求内直接发送。通知邮件与到期清理需要另开终端，确保 API
已完成迁移，再从后端目录启动：

```bash
cd backend
bun run src/worker.ts
```

worker 读取同一个数据库与环境配置；邮件密钥缺失时邮件消费闲置，但周期清理仍会
运行。合成演示账号没有正式邮箱，不能代替真实校园邮箱收信测试。不要在日志、截图
或提交中保存验证码、会话、真实邮箱数据和密钥。

## 上线前准备与发布

准备持久挂载 Docker volume 的 Linux 主机、公开域名与 DNS，开放 TCP 80/443
（可选 UDP 443），安装 Docker Compose、Restic，以及 cron 或 systemd timer。
Resend 发件域须由运营方控制 DNS 并认证，不使用未经授权的学校邮箱域发信。

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 48
```

将生成的随机值写入 `SESSION_SECRET`，补全站点、origin、Resend 密钥和发件地址。
`.env` 是受信任的服务器配置，只由管理员保存。Resend webhook 指向
`https://<站点域名>/api/webhooks/resend`，订阅 `email.sent`、`email.delivered`、
`email.delivery_delayed`、`email.bounced`、`email.complained`、`email.failed` 和
`email.suppressed`。API 校验 Svix 签名并按事件 ID 去重；通知队列才有对应的回执状态。

先校验配置，再构建、迁移和启动；`config --quiet` 避免将展开的密钥打印到终端：

```bash
docker compose config --quiet
docker compose build api worker web
docker compose --profile ops run --rm migrate
docker compose up -d --force-recreate api worker web
docker compose ps
```

首次使用干净数据卷。关闭 demo seed 不会清除旧库中的合成数据，不要把开发库直接
用于正式服务。迁移当前要求至少版本 9；API、worker 和恢复校验都依赖这个版本。
更新已有服务时先备份，再安排维护窗口停止 API/worker，执行构建与迁移，最后重建
服务。worker 和 API 使用相同 Dockerfile 阶段，各服务都要更新镜像。

确认 Caddy 从公网取得 HTTPS 证书，检查 `/api/health` 和 `/api/ready`，后者仅证明
数据库可访问与迁移版本达到要求，不能证明邮件、图片、备份或业务流程正常。

### 管理员与真实课程目录

用正式校园邮箱完成验证和首次登录后，执行：

```bash
docker compose exec api bun run src/admin.ts grant-admin name@suat-sz.edu.cn
```

命令只向数据库中已验证的允许域账号授予 `is_admin`，不会由邮箱域或演示审核员自动
授予。管理员登录后，在审核页面可下载课程 CSV 模板、预览并确认导入，也可设置
课程启停和教师资料。模板、九列表头与预览有效期见[后端 API](../backend/README.md)。
生产库不会自动提供合成目录；真实课程和教师来源需由运营方审核。

### 邮件与清理检查

Compose worker 与 API 共享 SQLite 卷。站内通知不依赖发信成功；符合条件的通知写入
`email_outbox` 后由 worker 消费，社交提醒延迟聚合并受用户偏好控制。worker 每秒
检查到期任务，失败退避重试，8 次失败后标为 `failed`；启动时将未完成的 `sending`
任务重置为 `pending`。Resend 接受发送不等于收件人已收到，需结合回执与实际收信。

worker 启动及每 6 小时清理注销已满 30 天的身份资料和部分内容数据，同时清理
`expires_at` 到期的举报证据。举报处置时设置 180 天到期时间，未结证据尚未到期。
没有 worker 时这些任务不会按期执行；私信历史、上传物理文件等没有通用自动删除
流程，备份也按单独策略轮换。

管理员可在容器内查询队列状态，不输出收件人或正文：

```bash
docker compose exec api bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.env.DATABASE_PATH, { readonly: true }); console.log(db.query("SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest FROM email_outbox GROUP BY status").all()); db.close();'
```

持续关注队列最老任务与 `failed` 数量，排查 worker、密钥、发件域和网络；当前没有
专用人工重投管理界面，不将修改数据库状态当作常规操作说明。

## 加密备份与调度

将 Restic 仓库放到异地对象存储或另一台主机，密码文件放在独立的受保护位置。
对象存储凭据由宿主机安全环境或 IAM 提供。准备 `/etc/shenxiaoli/backup.env`，内容为
实际 `RESTIC_REPOSITORY` 与 `RESTIC_PASSWORD_FILE`，限制该文件和密码文件的读取权限。
在受限服务账号的 shell 中加载环境后初始化仓库：

```bash
set -a
. /etc/shenxiaoli/backup.env
set +a
restic init
```

该服务账号须能访问项目配置、Docker 和 Restic 仓库；Docker 访问本身具备较高权限，
应由运营方管理。备份从项目根目录执行：

```bash
./ops/backup.sh
restic snapshots --tag shenxiaoli
```

脚本使用数据库只读事务和 Bun SQLite 序列化取得一致快照，并校验数据库完整性；
随后单独打包上传目录，交由 Restic 加密上传，再保留标签 `shenxiaoli` 下最近 30 个
每日快照。数据库与图片不是同一原子时间点，备份期间图片写入可能形成时间差；不要
把该流程描述成跨资源原子快照。需要严格配对时安排上传暂停窗口。

备份明文暂存在项目 `backups/`，正常退出和可捕获失败会清理；异常终止后需检查残留。
脚本不是内置定时服务，运营方必须调度。以下 cron 示例每日 02:00 执行，时间取服务器
cron 时区；先将服务器调度时区设为运营所需时区（例如 Asia/Shanghai）：

```cron
0 2 * * * /bin/bash -c 'cd /srv/shenxiaoli && set -a && . /etc/shenxiaoli/backup.env && set +a && ./ops/backup.sh' >> /var/log/shenxiaoli-backup.log 2>&1
```

`/srv/shenxiaoli` 和日志目录按实际部署替换，确保日志可写并配置轮换与失败告警。
至少每月检查 `restic snapshots --tag shenxiaoli` 和 `restic check`，关注最近成功备份
时间、存储空间和失败状态。不要复制运行中的 SQLite 主文件代替一致快照。

## 恢复演练、事故恢复与回滚

上线前在隔离环境用同一版本镜像演练数据库和图片恢复，此后至少每季度复演。
建议目标 RPO ≤ 24 小时、RTO ≤ 4 小时，这是运营目标，需要调度与演练证明。
恢复会替换现场数据，事故中先保存现场并选定正确快照；优先使用明确 snapshot ID，
避免 `latest` 误选其他数据集。

```bash
set -a
. /etc/shenxiaoli/backup.env
set +a
restic snapshots --tag shenxiaoli
./ops/restore.sh <snapshot-id>
```

脚本先将 Restic 快照取回临时目录并寻找数据库/上传配对文件，再停止 API 和 worker。
恢复程序检查数据库完整性、迁移版本、外键、图片归档路径和文件类型，然后保留旧
数据库与上传目录、安装恢复数据，成功后启动服务。当前恢复至少接受迁移版本 9，
不代表任意未来版本的数据库都兼容旧应用；回滚须确认镜像与快照匹配。

在停止服务后的恢复校验/安装失败会保持 API/worker 停止，先查看失败阶段再决定处理；
更早的 Restic 下载失败并未停止服务。程序会尝试回滚安装中的失败，并保留恢复前数据
供检查。不要跳过校验强行启动，也不要未经核验删除旧副本。

成功后检查健康和就绪、课程与内容、登录、图片、私信、互助、申诉和邮件队列，记录
snapshot ID、镜像版本、耗时和结果。恢复会带回备份当时的会话、账号和队列状态：
账号删除与处置需核对事故窗口，真实邮件 worker 在演练中保持停用或使用隔离发信配置，
避免向真实用户发出恢复的旧任务。

发布失败时先区分应用问题和数据问题：兼容数据库的应用回滚可部署原镜像；涉及迁移
或数据损坏时停止写入、保存现场并恢复匹配快照，再启动相应版本。现有 Compose 使用
本地构建镜像，没有自动版本化回滚或生产发布流水线，发布前需保存可追溯的应用提交、
镜像标识及备份，后续操作依照实际发布环境。

## 监控与上线验收

监控健康/就绪状态、容器重启、磁盘空间、worker 队列积压、Resend 退信/投诉和备份
新鲜度。SQLite 为单实例部署，API 与 worker 都会写库，不直接水平扩容。日志避免
验证码、会话、完整私信正文与举报人信息。

上线检查由运营方逐项完成：

- 公开项目说明与规则可访问，HTTPS 和同源代理正确；未登录业务读取受限。
- 两个允许域均完成真实收信和登录，错误域被拒绝，演示登录禁用，普通用户无法调用管理员接口。
- CSV 使用真实审核数据，先预览再确认；管理权限与审核权限验证正确。
- 评课和树洞直接发布，作者可维护；举报与申诉由不同审核人员处理，并核查匿名展示。
- 联系接受后可私信，非参与者不能读取，屏蔽限制发送；互助双方确认完成后才能反馈。
- 验证通知邮件偏好、队列重试和签名回执；确认 worker 运行并核验注销及证据清理。
- 完成一致数据库与图片备份、隔离恢复演练，以及失败恢复与版本回滚记录。
- **处理图片读取已知问题**：当前 `/uploads/*` 未覆盖会话解析，已登录请求仍返回 401。须修复后验证页面图片加载及未登录访问拒绝，此项未通过前不能宣称完整图片功能已验收。

学校 SSO、学籍核验、教务自动同步尚未实现，需要正式接口。服务器、DNS、发件域、
密钥、异地备份账号、管理员、审核团队、真实课程数据及事件响应流程由运营方提供。
[安全政策](../SECURITY.md)和[行为准则](../CODE_OF_CONDUCT.md)提供项目报告渠道，
不替代运营方的值班与响应安排。API 自动化测试不能替代以上真实部署验收。
