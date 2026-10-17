import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { SCHEMA_VERSION, type AppDatabase } from "./db";
import { createAuth, deliverCampusEmail, normalizeCampusEmail } from "./auth";
import { enqueueEmail } from "./notifications";
import { Resend } from "resend";
import {
  initializeLocalTesting,
  isSyntheticTestEmail,
  localTestEmailSender,
  localTestRouter,
} from "./local-testing";

export interface User {
  id: string;
  displayName: string;
  department: string;
  role: "student" | "moderator" | "admin";
  email?: string;
  emailVerified?: boolean;
  accountStatus?: "active" | "suspended" | "banned" | "deleting";
}

interface AppConfig {
  database: AppDatabase;
  localTestMode?: boolean;
  demoAuthEnabled?: boolean;
  production?: boolean;
  sessionSecret?: string;
  allowedOrigins?: string[];
  uploadsDir?: string;
  sendEmail?: Parameters<typeof createAuth>[0]["sendEmail"];
}

interface Variables {
  user: User | null;
  auth: ReturnType<typeof createAuth>;
}

type AppContext = { Variables: Variables };
type RouteContext = Context<AppContext>;
type StatusCode = ContentfulStatusCode;

class HttpError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const COOKIE_NAME = "shenxiaoli_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nowIso = (): string => new Date().toISOString();
const tokenHash = (token: string, secret: string): string =>
  createHash("sha256").update(`${secret}:${token}`).digest("hex");

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function requiredText(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", `${label}格式不正确`);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      `${label}长度需为 ${min}–${max} 个字符`,
    );
  }
  return text;
}

function optionalText(value: unknown, max: number, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new HttpError(400, "INVALID_INPUT", "文本格式或长度不正确");
  }
  return value.trim();
}

function numberInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      `${label}需在 ${min}–${max} 之间`,
    );
  }
  return number;
}

function clampInt(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function pagination(c: RouteContext): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = clampInt(c.req.query("page"), 1, 1_000_000);
  const pageSize = clampInt(c.req.query("pageSize"), 20, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function requireSessionUser(c: RouteContext): User {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "AUTH_REQUIRED", "请先登录后再操作");
  return user;
}

function requireUser(c: RouteContext): User {
  const user = requireSessionUser(c);
  if (user.accountStatus === "banned" || user.accountStatus === "deleting") {
    throw new HttpError(403, "ACCOUNT_RESTRICTED", "当前账号无法执行此操作");
  }
  return user;
}

function requireActiveUser(c: RouteContext): User {
  const user = requireUser(c);
  if (user.accountStatus === "suspended") {
    throw new HttpError(403, "ACCOUNT_SUSPENDED", "当前账号暂时无法互动");
  }
  return user;
}

function requireModerator(c: RouteContext): User {
  const user = requireActiveUser(c);
  if (user.role !== "moderator" && user.role !== "admin") {
    throw new HttpError(403, "MODERATOR_REQUIRED", "此操作仅限内容管理员");
  }
  return user;
}

function requireAdmin(c: RouteContext): User {
  const user = requireActiveUser(c);
  if (user.role !== "admin")
    throw new HttpError(403, "ADMIN_REQUIRED", "此操作仅限课程管理员");
  return user;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new HttpError(400, "INVALID_CSV", "CSV 存在未闭合的引号");
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function consumeRateLimit(
  db: AppDatabase,
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
): void {
  const start = Math.floor(Date.now() / windowMs) * windowMs;
  const row = db
    .query(
      "SELECT count FROM rate_limits WHERE user_id = ? AND action = ? AND window_start = ?",
    )
    .get(userId, action, start) as { count: number } | null;
  if (row && row.count >= limit) {
    throw new HttpError(429, "RATE_LIMITED", "操作太频繁，请稍后再试");
  }
  db.query(
    `INSERT INTO rate_limits (user_id, action, window_start, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, action, window_start) DO UPDATE SET count = count + 1`,
  ).run(userId, action, start);
  if (Math.random() < 0.01) {
    db.query("DELETE FROM rate_limits WHERE window_start < ?").run(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    );
  }
}

function setSessionCookie(
  c: RouteContext,
  token: string,
  production: boolean,
): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: production,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  deleteCookie(c, COOKIE_NAME, { path: "/api" });
}

function readUser(db: AppDatabase, userId: string): User | null {
  const row = db
    .query(
      `SELECT id, display_name, department, role, email, email_verified,
         is_admin, account_status, suspended_until
       FROM users WHERE id = ?`,
    )
    .get(userId) as {
    id: string;
    display_name: string;
    department: string;
    role: "student" | "moderator";
    email: string | null;
    email_verified: number;
    is_admin: number;
    account_status: NonNullable<User["accountStatus"]>;
    suspended_until: string | null;
  } | null;
  return row
    ? {
        id: row.id,
        displayName: row.display_name,
        department: row.department,
        role: row.is_admin ? "admin" : row.role,
        ...(row.email ? { email: row.email } : {}),
        emailVerified: Boolean(row.email_verified),
        accountStatus:
          row.account_status === "suspended" &&
          row.suspended_until &&
          row.suspended_until <= nowIso()
            ? "active"
            : row.account_status,
      }
    : null;
}

function mapListing(
  row: Record<string, unknown>,
  userId?: string,
): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    price: row.price,
    condition: row.condition,
    location: row.location,
    description: row.description,
    images: parseJsonArray(String(row.images_json ?? "[]")),
    status: row.status,
    sellerName: row.seller_name ?? "匿名同学",
    isOwner: Boolean(userId && row.seller_id === userId),
    createdAt: row.created_at,
  };
}

function mapSkill(
  row: Record<string, unknown>,
  userId?: string,
): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    category: row.category,
    description: row.description,
    tags: parseJsonArray(String(row.tags_json ?? "[]")),
    canOffer: row.can_offer,
    wants: row.wants,
    isOwner: Boolean(userId && row.user_id === userId),
    createdAt: row.created_at,
  };
}

function addContactRequest(
  db: AppDatabase,
  user: User,
  targetType: "listing" | "skill",
  targetId: string,
  message: string,
): string {
  const table = targetType === "listing" ? "market_listings" : "skill_posts";
  const ownerColumn = targetType === "listing" ? "seller_id" : "user_id";
  const target = db
    .query(`SELECT id, ${ownerColumn} AS owner_id FROM ${table} WHERE id = ?`)
    .get(targetId) as { id: string; owner_id: string | null } | null;
  if (!target) throw new HttpError(404, "NOT_FOUND", "内容不存在或已下架");
  if (!target.owner_id)
    throw new HttpError(404, "NOT_FOUND", "发布者已注销，无法联系");
  if (target.owner_id === user.id) {
    throw new HttpError(400, "SELF_CONTACT", "不能联系自己发布的内容");
  }
  if (target.owner_id) {
    const blocked = db
      .query(
        `SELECT 1 FROM user_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      )
      .get(user.id, target.owner_id, target.owner_id, user.id);
    if (blocked)
      throw new HttpError(
        403,
        "USER_BLOCKED",
        "双方存在屏蔽关系，无法发送联系请求",
      );
  }
  const id = randomUUID();
  db.query(
    `INSERT INTO contact_requests
     (id, target_type, target_id, sender_id, recipient_id, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, targetType, targetId, user.id, target.owner_id, message, nowIso());
  return id;
}

function addNotification(
  db: AppDatabase,
  userId: string,
  kind: string,
  title: string,
  detail: string,
  href: string | null,
  dedupeKey: string,
): void {
  db.query(
    `INSERT OR IGNORE INTO notifications
      (id, user_id, kind, title, detail, href, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, kind, title, detail, href, dedupeKey, nowIso());
  const isSocial =
    kind === "message" || kind === "contact" || kind === "contact-accepted";
  const isCritical = [
    "moderation",
    "appeal",
    "account",
    "security",
    "report-result",
  ].some((prefix) => kind.startsWith(prefix));
  if (isSocial || isCritical) {
    enqueueEmail(db, {
      userId,
      kind: isSocial ? kind : "important",
      subject: isSocial
        ? "深小狸校园：你有新的站内消息"
        : `深小狸校园：${title}`,
      text: isSocial
        ? "你有新的站内消息。请登录深小狸校园查看。\n\n为保护隐私，邮件不包含消息内容。"
        : `${title}\n\n请登录深小狸校园查看详情。`,
      dedupeKey,
    });
  }
}

function shanghaiMonthStart(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return new Date(`${year}-${month}-01T00:00:00+08:00`).toISOString();
}

export function createApp(config: AppConfig): Hono<AppContext> {
  const { database: db } = config;
  const production = config.production ?? process.env.NODE_ENV === "production";
  const demoAuthEnabled = Boolean(config.demoAuthEnabled) && !production;
  if (production && config.localTestMode)
    throw new Error("Local test mode must not be enabled in production");
  if (config.localTestMode) initializeLocalTesting(db);
  const sendEmail =
    config.sendEmail ??
    (config.localTestMode ? localTestEmailSender(db) : undefined);
  const secret =
    config.sessionSecret ??
    process.env.SESSION_SECRET ??
    "local-development-only-secret";
  const defaultOrigins = production
    ? ""
    : "http://localhost:5173,http://127.0.0.1:5173";
  const allowedOrigins = new Set(
    config.allowedOrigins ??
      (process.env.ALLOWED_ORIGINS ?? defaultOrigins)
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
  );
  const uploadsDir = resolve(
    config.uploadsDir ?? process.env.UPLOADS_PATH ?? "./uploads",
  );
  const authInstances = new Map<string, ReturnType<typeof createAuth>>();
  const configuredAuthURL = process.env.BETTER_AUTH_URL?.trim();
  const requestOrigin = (request: Request): string => {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    if (!host || /[\s,@/\\?#]/.test(host))
      throw new HttpError(400, "INVALID_HOST", "请求主机地址无效");
    try {
      // Compose exposes HTTP to the local tunnel; production browsers use HTTPS.
      return new URL(
        `${production ? "https" : url.protocol.slice(0, -1)}://${host}`,
      ).origin;
    } catch {
      throw new HttpError(400, "INVALID_HOST", "请求主机地址无效");
    }
  };
  const authForOrigin = (origin: string): ReturnType<typeof createAuth> => {
    const baseURL = configuredAuthURL || origin;
    let auth = authInstances.get(baseURL);
    if (!auth) {
      auth = createAuth({
        database: db,
        baseURL,
        production,
        secret,
        trustedOrigins: [...allowedOrigins],
        sendEmail,
      });
      // Bound memory when a tunnel changes hosts or a client varies Host.
      if (authInstances.size >= 32)
        authInstances.delete(authInstances.keys().next().value!);
      authInstances.set(baseURL, auth);
    }
    return auth;
  };

  const app = new Hono<AppContext>();

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    await next();
  });

  app.use("*", async (c, next) => {
    if (!c.req.path.startsWith("/api/") && !c.req.path.startsWith("/uploads/"))
      return next();
    const incomingOrigin = requestOrigin(c.req.raw);
    const method = c.req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const origin = c.req.header("origin");
      if (origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(origin).origin === incomingOrigin;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin && !allowedOrigins.has(origin)) {
          throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "请求来源不受信任");
        }
      }
    }

    const rawToken = getCookie(c, COOKIE_NAME);
    if (rawToken) {
      const session = db
        .query("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
        .get(tokenHash(rawToken, secret)) as {
        user_id: string;
        expires_at: number;
      } | null;
      if (session && session.expires_at > Math.floor(Date.now() / 1000)) {
        c.set("user", readUser(db, session.user_id));
      } else {
        c.set("user", null);
      }
    } else {
      c.set("user", null);
    }
    const auth = authForOrigin(incomingOrigin);
    c.set("auth", auth);
    const authSession = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (authSession?.user.emailVerified) {
      const email = normalizeCampusEmail(authSession.user.email);
      if (email) {
        const now = nowIso();
        db.query(
          `INSERT INTO users
            (id, display_name, email, email_verified, department, role, created_at, updated_at)
           VALUES (?, ?, ?, 1, '', 'student', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             email = excluded.email,
             email_verified = 1,
             updated_at = excluded.updated_at`,
        ).run(authSession.user.id, authSession.user.name, email, now, now);
        const user = readUser(db, authSession.user.id);
        c.set("user", user);
      }
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    console.error("[shenxiaoli-api] request failed:", error.name);
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用，请稍后重试",
        },
      },
      500,
    );
  });

  if (config.localTestMode)
    app.route(
      "/api/testing",
      localTestRouter(db, async () => {
        authInstances.clear();
        if (
          uploadsDir.startsWith(
            `${resolve(import.meta.dir, "../../.local-test")}/`,
          )
        )
          await rm(uploadsDir, { recursive: true, force: true });
      }),
    );

  app.get("/api/health", (c) =>
    c.json({ status: "ok", service: "shenxiaoli-api" }),
  );

  app.get("/api/ready", (c) => {
    try {
      const migrations = db
        .query("SELECT MAX(version) AS version FROM schema_migrations")
        .get() as { version: number | null };
      db.query("SELECT 1").get();
      if ((migrations.version ?? 0) < SCHEMA_VERSION)
        return c.json({ status: "not-ready", reason: "migrations" }, 503);
      return c.json({ status: "ready" });
    } catch {
      return c.json({ status: "not-ready", reason: "database" }, 503);
    }
  });

  app.post("/api/feedback", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "反馈内容格式不正确");
    const user = c.get("user");
    const subject = requiredText(body.subject, "主题", 3, 120);
    const message = requiredText(body.message, "反馈内容", 10, 2000);
    const emailInput = optionalText(body.email, 254);
    const email =
      user?.email ?? (emailInput ? normalizeCampusEmail(emailInput) : null);
    if (!user && !email)
      throw new HttpError(
        400,
        "CAMPUS_EMAIL_REQUIRED",
        "未登录反馈请填写有效校园邮箱",
      );
    if (emailInput && !normalizeCampusEmail(emailInput))
      throw new HttpError(400, "CAMPUS_EMAIL_REQUIRED", "仅支持 SUAT 校园邮箱");
    const forwarded =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const sourceHash = createHash("sha256").update(forwarded).digest("hex");
    const hour = Math.floor(Date.now() / 3_600_000);
    const limited = db
      .query(
        `INSERT INTO feedback_rate_limits (source_hash, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(source_hash) DO UPDATE SET
        count = CASE WHEN feedback_rate_limits.window_start = excluded.window_start THEN feedback_rate_limits.count + 1 ELSE 1 END,
        window_start = excluded.window_start
      WHERE feedback_rate_limits.window_start <> excluded.window_start OR feedback_rate_limits.count < 5`,
      )
      .run(sourceHash, hour);
    if (!limited.changes)
      throw new HttpError(429, "RATE_LIMITED", "反馈提交过于频繁，请稍后再试");
    const id = randomUUID();
    db.query(
      "INSERT INTO feedback_tickets (id, user_id, email, subject, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
    ).run(id, user?.id ?? null, email, subject, message, nowIso());
    return c.json({ id, message: "反馈已提交" }, 201);
  });

  app.get("/api/session", (c) => {
    const user = c.get("user");
    return c.json({
      authenticated: Boolean(user),
      user,
      demoAuthAvailable: demoAuthEnabled,
      localTestMode: Boolean(config.localTestMode),
      syntheticIdentity: Boolean(
        config.localTestMode && user?.email && isSyntheticTestEmail(user.email),
      ),
      campusEmailVerified: Boolean(
        user?.emailVerified && user.email && normalizeCampusEmail(user.email),
      ),
    });
  });

  app.patch("/api/me/profile", async (c) => {
    const user = requireUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "账号资料格式不正确");
    const displayName = requiredText(body.displayName, "昵称", 2, 40);
    const now = nowIso();
    db.query(
      "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
    ).run(displayName, now, user.id);
    db.query("UPDATE auth_users SET name = ?, updatedAt = ? WHERE id = ?").run(
      displayName,
      Date.now(),
      user.id,
    );
    return c.json({ displayName });
  });

  app.post("/api/me/sessions/revoke", (c) => {
    const user = requireUser(c);
    db.query("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    db.query("DELETE FROM auth_sessions WHERE userId = ?").run(user.id);
    deleteCookie(c, COOKIE_NAME, { path: "/api" });
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/api/me/account/deletion-code", async (c) => {
    const user = requireUser(c);
    if (!user.email || !user.emailVerified)
      throw new HttpError(
        400,
        "VERIFIED_EMAIL_REQUIRED",
        "仅正式校园邮箱账号可以申请注销",
      );
    consumeRateLimit(db, user.id, "account-deletion-code", 3, 60 * 60 * 1000);
    const otp = String(randomInt(100000, 1_000_000));
    const hash = tokenHash(`${user.id}:${otp}`, secret);
    const expiresAt = Date.now() + 5 * 60_000;
    db.query(
      "INSERT INTO account_deletion_codes (user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at",
    ).run(user.id, hash, expiresAt, Date.now());
    try {
      await deliverCampusEmail(
        {
          to: user.email,
          subject: "深小狸校园：确认账号注销",
          text: `你的注销验证码是 ${otp}，5 分钟内有效。提交后账号立即停用，身份资料将在 30 天后清理。若非本人操作，请忽略此邮件。`,
          idempotencyKey: `account-delete/${user.id}/${hash}`,
        },
        sendEmail,
      );
    } catch (error) {
      db.query("DELETE FROM account_deletion_codes WHERE user_id = ?").run(
        user.id,
      );
      throw new HttpError(
        503,
        "EMAIL_UNAVAILABLE",
        error instanceof Error ? error.message : "注销邮件发送失败",
      );
    }
    return c.json({ ok: true, expiresIn: 300 });
  });

  app.post("/api/me/account/delete", async (c) => {
    const user = requireUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    const otp = requiredText(isRecord(body) ? body.otp : null, "验证码", 6, 6);
    const row = db
      .query(
        "SELECT code_hash AS codeHash, expires_at AS expiresAt, attempts FROM account_deletion_codes WHERE user_id = ?",
      )
      .get(user.id) as {
      codeHash: string;
      expiresAt: number;
      attempts: number;
    } | null;
    if (!row || row.expiresAt < Date.now() || row.attempts >= 5)
      throw new HttpError(400, "INVALID_OTP", "验证码无效或已过期");
    const submittedHash = tokenHash(`${user.id}:${otp}`, secret);
    const expected = Buffer.from(row.codeHash, "hex");
    const submitted = Buffer.from(submittedHash, "hex");
    if (
      expected.length !== submitted.length ||
      !timingSafeEqual(expected, submitted)
    ) {
      db.query(
        "UPDATE account_deletion_codes SET attempts = attempts + 1 WHERE user_id = ?",
      ).run(user.id);
      throw new HttpError(400, "INVALID_OTP", "验证码不正确");
    }
    const now = nowIso();
    db.transaction(() => {
      db.query(
        "UPDATE users SET account_status = 'deleting', deleted_at = ?, display_name = '已注销用户', updated_at = ? WHERE id = ?",
      ).run(now, now, user.id);
      db.query(
        "UPDATE course_reviews SET deleted_at = COALESCE(deleted_at, ?), moderation_status = 'hidden' WHERE user_id = ?",
      ).run(now, user.id);
      db.query(
        "UPDATE market_listings SET deleted_at = COALESCE(deleted_at, ?), moderation_status = 'hidden' WHERE seller_id = ?",
      ).run(now, user.id);
      db.query(
        "UPDATE skill_posts SET deleted_at = COALESCE(deleted_at, ?), moderation_status = 'hidden' WHERE user_id = ?",
      ).run(now, user.id);
      db.query(
        "UPDATE tree_posts SET deleted_at = COALESCE(deleted_at, ?), moderation_status = 'hidden' WHERE user_id = ?",
      ).run(now, user.id);
      db.query(
        "UPDATE content_comments SET deleted_at = COALESCE(deleted_at, ?), status = 'removed', updated_at = ? WHERE user_id = ?",
      ).run(now, now, user.id);
      db.query("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      db.query("DELETE FROM auth_sessions WHERE userId = ?").run(user.id);
      db.query("DELETE FROM auth_users WHERE id = ?").run(user.id);
      db.query("DELETE FROM account_deletion_codes WHERE user_id = ?").run(
        user.id,
      );
      db.query("DELETE FROM content_favorites WHERE user_id = ?").run(user.id);
      db.query("DELETE FROM notification_preferences WHERE user_id = ?").run(
        user.id,
      );
      db.query(
        "UPDATE email_outbox SET recipient = '', text_body = '', subject = 'Account deleted', status = 'failed' WHERE user_id = ? AND status IN ('pending','sending')",
      ).run(user.id);
    })();
    deleteCookie(c, COOKIE_NAME, { path: "/api" });
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({
      ok: true,
      message: "账号已停用，身份资料将在 30 天后清理。",
    });
  });

  app.post("/api/auth/demo", async (c) => {
    if (!demoAuthEnabled) throw new HttpError(404, "NOT_FOUND", "接口不存在");
    const body: unknown = await c.req.json().catch(() => null);
    const requestedRole = isRecord(body) ? body.role : undefined;
    const userId =
      requestedRole === "moderator" ? "demo-moderator" : "demo-student";
    const user = readUser(db, userId);
    if (!user)
      throw new HttpError(503, "DEMO_USER_MISSING", "演示账号尚未初始化");
    const token = randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    db.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash(token, secret), user.id, expiresAt, nowIso());
    setSessionCookie(c, token, production);
    return c.json({ authenticated: true, user, demo: true });
  });

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (token)
      db.query("DELETE FROM sessions WHERE token_hash = ?").run(
        tokenHash(token, secret),
      );
    deleteCookie(c, COOKIE_NAME, { path: "/api" });
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/home", (c) => {
    const user = requireUser(c);
    const counts = {
      courses: Number(
        (
          db
            .query("SELECT COUNT(*) AS count FROM courses WHERE active = 1")
            .get() as {
            count: number;
          } | null
        )?.count ?? 0,
      ),
      listings: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM market_listings WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
            )
            .get() as { count: number } | null
        )?.count ?? 0,
      ),
      skills: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM skill_posts WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
            )
            .get() as { count: number } | null
        )?.count ?? 0,
      ),
      treePosts: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM tree_posts WHERE status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL",
            )
            .get() as { count: number } | null
        )?.count ?? 0,
      ),
    };
    const courses = db
      .query(
        `SELECT c.id, c.code, c.title, c.department,
           ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating,
           COUNT(r.id) AS review_count
         FROM courses c LEFT JOIN course_reviews r
           ON r.course_id = c.id AND r.status = 'approved'
             AND r.moderation_status = 'visible' AND r.deleted_at IS NULL
         WHERE c.active = 1
         GROUP BY c.id ORDER BY rating DESC, review_count DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const listings = db
      .query(
        `SELECT l.*, '匿名同学' AS seller_name FROM market_listings l
         WHERE l.status = 'active' AND l.moderation_status = 'visible'
           AND l.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const skills = db
      .query(
        `SELECT * FROM skill_posts WHERE status = 'active'
           AND moderation_status = 'visible' AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const posts = db
      .query(
        `SELECT id, content, topic, created_at FROM tree_posts
         WHERE status = 'approved' AND moderation_status = 'visible'
           AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    return c.json({
      counts,
      featuredCourses: courses,
      latestListings: listings.map((row) => mapListing(row, user?.id)),
      latestSkills: skills.map((row) => mapSkill(row, user?.id)),
      latestTreePosts: posts.map((row) => ({ ...row, author: "匿名狸友" })),
      demoData: demoAuthEnabled || Boolean(config.localTestMode),
    });
  });

  app.get("/api/search", (c) => {
    requireUser(c);
    const query = optionalText(c.req.query("q"), 120).slice(0, 120);
    const type = c.req.query("type");
    const page = pagination(c);
    if (type && ["course", "listing", "skill", "tree-hole"].includes(type)) {
      if (!query)
        return c.json({
          query,
          type,
          results: [],
          total: 0,
          page: page.page,
          pageSize: page.pageSize,
        });
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      const search = {
        course: {
          items: `SELECT id, code AS identifier, title, department AS detail, 'course' AS type FROM courses WHERE active = 1 AND (code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR english_title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\') ORDER BY title, id`,
          count: `SELECT COUNT(*) AS count FROM courses WHERE active = 1 AND (code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR english_title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\')`,
          args: [like, like, like, like],
        },
        listing: {
          items: `SELECT id, '' AS identifier, title, category AS detail, 'listing' AS type FROM market_listings WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY created_at DESC, id DESC`,
          count: `SELECT COUNT(*) AS count FROM market_listings WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`,
          args: [like, like],
        },
        skill: {
          items: `SELECT id, '' AS identifier, title, category AS detail, 'skill' AS type FROM skill_posts WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY created_at DESC, id DESC`,
          count: `SELECT COUNT(*) AS count FROM skill_posts WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`,
          args: [like, like],
        },
        "tree-hole": {
          items: `SELECT id, '' AS identifier, substr(content, 1, 80) AS title, topic AS detail, 'tree-hole' AS type FROM tree_posts WHERE status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC`,
          count: `SELECT COUNT(*) AS count FROM tree_posts WHERE status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL AND content LIKE ? ESCAPE '\\'`,
          args: [like],
        },
      }[type as "course" | "listing" | "skill" | "tree-hole"];
      const results = db
        .query(`${search.items} LIMIT ? OFFSET ?`)
        .all(...search.args, page.pageSize, page.offset);
      const total = Number(
        (db.query(search.count).get(...search.args) as { count: number }).count,
      );
      return c.json({
        query,
        type,
        results,
        total,
        page: page.page,
        pageSize: page.pageSize,
      });
    }
    if (type) throw new HttpError(400, "INVALID_SEARCH_TYPE", "搜索类别不正确");
    if (!query) return c.json({ query, results: [] });
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const courses = db
      .query(
        `SELECT id, code AS identifier, title, department AS detail, 'course' AS type
         FROM courses WHERE active = 1 AND (code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
           OR english_title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\') LIMIT 5`,
      )
      .all(like, like, like, like) as Record<string, unknown>[];
    const listings = db
      .query(
        `SELECT id, '' AS identifier, title, category AS detail, 'listing' AS type
         FROM market_listings WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 5`,
      )
      .all(like, like) as Record<string, unknown>[];
    const skills = db
      .query(
        `SELECT id, '' AS identifier, title, category AS detail, 'skill' AS type
         FROM skill_posts WHERE status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 5`,
      )
      .all(like, like) as Record<string, unknown>[];
    const treePosts = db
      .query(
        `SELECT id, '' AS identifier, substr(content, 1, 80) AS title,
           topic AS detail, 'tree-hole' AS type
         FROM tree_posts WHERE status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 5`,
      )
      .all(like) as Record<string, unknown>[];
    return c.json({
      query,
      results: [...courses, ...listings, ...skills, ...treePosts].slice(0, 12),
    });
  });

  app.get("/api/me/publications", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const sql = `SELECT * FROM (
      SELECT 'review' AS type, r.id, c.title AS title, c.code AS context,
        r.content AS body, r.status AS status, r.created_at AS createdAt
        FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE r.user_id = ? AND r.deleted_at IS NULL
      UNION ALL
      SELECT 'listing', l.id, l.title, l.category, l.description, l.status, l.created_at
        FROM market_listings l WHERE l.seller_id = ? AND l.deleted_at IS NULL
      UNION ALL
      SELECT 'skill', s.id, s.title, s.category, s.description, s.status, s.created_at
        FROM skill_posts s WHERE s.user_id = ? AND s.deleted_at IS NULL
      UNION ALL
      SELECT 'tree-hole', t.id, '树洞发布', t.topic, t.content, t.status, t.created_at
        FROM tree_posts t WHERE t.user_id = ? AND t.deleted_at IS NULL
    ) ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`;
    const pageItems = db
      .query(sql)
      .all(user.id, user.id, user.id, user.id, page.pageSize, page.offset) as {
      type: string;
      id: string;
      title: string;
      context: string;
      body: string;
      status: string;
      createdAt: string;
    }[];
    const items = pageItems.map((item) => {
      const detailQuery =
        item.type === "review"
          ? "SELECT rating, difficulty, workload, tags_json AS tagsJson, term FROM course_reviews WHERE id = ?"
          : item.type === "listing"
            ? "SELECT price, condition, location, images_json AS imagesJson FROM market_listings WHERE id = ?"
            : item.type === "skill"
              ? "SELECT kind, tags_json AS tagsJson, can_offer AS canOffer, wants FROM skill_posts WHERE id = ?"
              : "SELECT topic FROM tree_posts WHERE id = ?";
      const details = db.query(detailQuery).get(item.id) as Record<
        string,
        unknown
      > | null;
      return {
        ...item,
        details: details
          ? {
              ...details,
              ...(typeof details.tagsJson === "string"
                ? { tags: parseJsonArray(details.tagsJson) }
                : {}),
              ...(typeof details.imagesJson === "string"
                ? { images: parseJsonArray(details.imagesJson) }
                : {}),
            }
          : {},
      };
    });
    const total = Number(
      (
        db
          .query(
            `SELECT
      (SELECT COUNT(*) FROM course_reviews WHERE user_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM market_listings WHERE seller_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM skill_posts WHERE user_id = ? AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM tree_posts WHERE user_id = ? AND deleted_at IS NULL) AS count`,
          )
          .get(user.id, user.id, user.id, user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.patch("/api/publications/:type/:id", async (c) => {
    const user = requireUser(c);
    const type = c.req.param("type");
    const id = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "发布内容格式不正确");
    const table =
      type === "review"
        ? "course_reviews"
        : type === "listing"
          ? "market_listings"
          : type === "skill"
            ? "skill_posts"
            : type === "tree-hole"
              ? "tree_posts"
              : null;
    if (!table) throw new HttpError(404, "NOT_FOUND", "发布类型不存在");
    const ownerColumn =
      type === "review"
        ? "user_id"
        : type === "listing"
          ? "seller_id"
          : "user_id";
    const row = db
      .query(
        `SELECT * FROM ${table} WHERE id = ? AND ${ownerColumn} = ? AND deleted_at IS NULL`,
      )
      .get(id, user.id) as Record<string, unknown> | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "找不到你发布的内容");
    if (row.moderation_status !== "visible")
      throw new HttpError(
        403,
        "CONTENT_RESTRICTED",
        "内容已被下架，请通过申诉申请复核",
      );
    db.query(
      "INSERT INTO content_revisions (id, target_type, target_id, editor_id, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), type, id, user.id, JSON.stringify(row), nowIso());
    const now = nowIso();
    if (type === "review") {
      const content = requiredText(body.content, "评价内容", 10, 1200);
      const rating = numberInRange(body.rating, "评分", 1, 10);
      const difficulty = numberInRange(body.difficulty, "难度", 1, 5);
      const workload = numberInRange(body.workload, "作业量", 1, 5);
      const tags = Array.isArray(body.tags)
        ? body.tags
            .filter((tag): tag is string => typeof tag === "string")
            .slice(0, 8)
            .map((tag) => tag.trim().slice(0, 24))
        : [];
      db.query(
        "UPDATE course_reviews SET content = ?, rating = ?, difficulty = ?, workload = ?, tags_json = ? WHERE id = ? AND user_id = ?",
      ).run(
        content,
        rating,
        difficulty,
        workload,
        JSON.stringify(tags),
        id,
        user.id,
      );
    } else if (type === "listing") {
      const title = requiredText(body.title, "商品标题", 2, 100);
      const category = requiredText(body.category, "分类", 1, 50);
      const price = numberInRange(body.price, "价格", 0, 1000000);
      const condition = requiredText(body.condition, "成色", 1, 30);
      const location = requiredText(body.location, "面交地点", 1, 100);
      const description = requiredText(body.description, "商品描述", 5, 1200);
      const status = ["active", "reserved", "sold"].includes(
        String(body.status),
      )
        ? String(body.status)
        : String(row.status);
      const images = Array.isArray(body.images)
        ? body.images
            .filter((value): value is string => typeof value === "string")
            .slice(0, 4)
        : parseJsonArray(String(row.images_json));
      if (
        images.some(
          (image) => !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(image),
        )
      )
        throw new HttpError(400, "INVALID_IMAGE", "图片地址不合法");
      db.query(
        "UPDATE market_listings SET title = ?, category = ?, price = ?, condition = ?, location = ?, description = ?, images_json = ?, status = ?, updated_at = ? WHERE id = ? AND seller_id = ?",
      ).run(
        title,
        category,
        price,
        condition,
        location,
        description,
        JSON.stringify(images),
        status,
        now,
        id,
        user.id,
      );
    } else if (type === "skill") {
      const title = requiredText(body.title, "标题", 3, 100);
      const category = requiredText(body.category, "领域", 2, 50);
      const description = requiredText(body.description, "详细描述", 10, 1000);
      const tags = Array.isArray(body.tags)
        ? body.tags
            .filter((tag): tag is string => typeof tag === "string")
            .slice(0, 10)
            .map((tag) => tag.trim().slice(0, 24))
        : [];
      db.query(
        "UPDATE skill_posts SET title = ?, category = ?, description = ?, tags_json = ?, can_offer = ?, wants = ? WHERE id = ? AND user_id = ?",
      ).run(
        title,
        category,
        description,
        JSON.stringify(tags),
        optionalText(body.canOffer, 200),
        optionalText(body.wants, 200),
        id,
        user.id,
      );
    } else {
      const content = requiredText(body.content, "树洞内容", 5, 1000);
      const topic = optionalText(body.topic, 40, String(row.topic));
      db.query(
        "UPDATE tree_posts SET content = ?, topic = ? WHERE id = ? AND user_id = ?",
      ).run(content, topic, id, user.id);
    }
    return c.json({ ok: true, updatedAt: now });
  });

  app.delete("/api/publications/:type/:id", (c) => {
    const user = requireUser(c);
    const type = c.req.param("type");
    const table =
      type === "review"
        ? "course_reviews"
        : type === "listing"
          ? "market_listings"
          : type === "skill"
            ? "skill_posts"
            : type === "tree-hole"
              ? "tree_posts"
              : null;
    if (!table) throw new HttpError(404, "NOT_FOUND", "发布类型不存在");
    const ownerColumn = type === "listing" ? "seller_id" : "user_id";
    const row = db
      .query(
        `SELECT * FROM ${table} WHERE id = ? AND ${ownerColumn} = ? AND deleted_at IS NULL`,
      )
      .get(c.req.param("id"), user.id) as Record<string, unknown> | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "找不到你发布的内容");
    db.query(
      "INSERT INTO content_revisions (id, target_type, target_id, editor_id, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      type,
      c.req.param("id"),
      user.id,
      JSON.stringify(row),
      nowIso(),
    );
    db.query(
      `UPDATE ${table} SET deleted_at = ? WHERE id = ? AND ${ownerColumn} = ?`,
    ).run(nowIso(), c.req.param("id"), user.id);
    return c.json({ ok: true });
  });

  const contentTableFor = (
    type: string,
  ): { table: string; owner: string; predicate: string } | null => {
    if (type === "review")
      return {
        table: "course_reviews",
        owner: "user_id",
        predicate:
          "status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL",
      };
    if (type === "listing")
      return {
        table: "market_listings",
        owner: "seller_id",
        predicate:
          "status IN ('active','reserved') AND moderation_status = 'visible' AND deleted_at IS NULL",
      };
    if (type === "skill")
      return {
        table: "skill_posts",
        owner: "user_id",
        predicate:
          "status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
      };
    if (type === "tree-hole")
      return {
        table: "tree_posts",
        owner: "user_id",
        predicate:
          "status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL",
      };
    return null;
  };

  app.get("/api/favorites", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const visible = ["review", "listing", "skill", "tree-hole"]
      .map((type) => {
        const target = contentTableFor(type)!;
        return `(f.target_type = '${type}' AND EXISTS (SELECT 1 FROM ${target.table} WHERE id = f.target_id AND ${target.predicate}))`;
      })
      .join(" OR ");
    const rows = db
      .query(
        `SELECT f.target_type AS type, f.target_id AS id, f.created_at AS createdAt FROM content_favorites f WHERE f.user_id = ? AND (${visible}) ORDER BY f.created_at DESC, f.target_type, f.target_id LIMIT ? OFFSET ?`,
      )
      .all(user.id, page.pageSize, page.offset) as {
      type: string;
      id: string;
      createdAt: string;
    }[];
    const items = rows.flatMap((favorite) => {
      const target = contentTableFor(favorite.type);
      if (!target) return [];
      const titleSql =
        favorite.type === "review"
          ? "SELECT c.title AS title, c.code AS context FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE r.id = ?"
          : favorite.type === "tree-hole"
            ? "SELECT substr(content, 1, 80) AS title, topic AS context FROM tree_posts WHERE id = ?"
            : `SELECT title, ${favorite.type === "listing" ? "category" : "category"} AS context FROM ${target.table} WHERE id = ?`;
      const row = db
        .query(
          `SELECT * FROM ${target.table} WHERE id = ? AND ${target.predicate}`,
        )
        .get(favorite.id);
      const label = db.query(titleSql).get(favorite.id) as {
        title: string;
        context: string;
      } | null;
      return row && label ? [{ ...favorite, ...label }] : [];
    });
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM content_favorites f WHERE f.user_id = ? AND (${visible})`,
          )
          .get(user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.post("/api/favorites/:type/:id", (c) => {
    const user = requireActiveUser(c);
    const target = contentTableFor(c.req.param("type"));
    if (!target) throw new HttpError(400, "INVALID_INPUT", "收藏类型不正确");
    const exists = db
      .query(
        `SELECT id FROM ${target.table} WHERE id = ? AND ${target.predicate}`,
      )
      .get(c.req.param("id"));
    if (!exists) throw new HttpError(404, "NOT_FOUND", "内容不存在或已隐藏");
    db.query(
      "INSERT OR IGNORE INTO content_favorites (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(user.id, c.req.param("type"), c.req.param("id"), nowIso());
    return c.json({ favorited: true });
  });

  app.delete("/api/favorites/:type/:id", (c) => {
    const user = requireActiveUser(c);
    db.query(
      "DELETE FROM content_favorites WHERE user_id = ? AND target_type = ? AND target_id = ?",
    ).run(user.id, c.req.param("type"), c.req.param("id"));
    return c.json({ favorited: false });
  });

  app.get("/api/comments", (c) => {
    const user = requireUser(c);
    const targetType = c.req.query("targetType") ?? "";
    const targetId = requiredText(c.req.query("targetId"), "内容", 1, 80);
    const target = contentTableFor(targetType);
    if (
      !target ||
      !db
        .query(
          `SELECT id FROM ${target.table} WHERE id = ? AND ${target.predicate}`,
        )
        .get(targetId)
    )
      throw new HttpError(404, "NOT_FOUND", "内容不存在或已隐藏");
    const page = pagination(c);
    const rows = db
      .query(
        `SELECT c.id, c.parent_id AS parentId, c.content, c.created_at AS createdAt,
      c.user_id AS commentUserId, c.user_id = ? AS isMine, COALESCE(u.display_name, '已注销用户') AS author,
      c.status
      FROM content_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.target_type = ? AND c.target_id = ? AND c.deleted_at IS NULL AND c.status = 'visible'
      ORDER BY CASE WHEN c.parent_id IS NULL THEN c.created_at ELSE (SELECT p.created_at FROM content_comments p WHERE p.id = c.parent_id) END DESC,
        c.parent_id IS NOT NULL, c.created_at, c.id LIMIT ? OFFSET ?`,
      )
      .all(user.id, targetType, targetId, page.pageSize, page.offset) as {
      commentUserId: string | null;
      author: string;
      [key: string]: unknown;
    }[];
    const items = rows.map(({ commentUserId, author, ...row }) => ({
      ...row,
      author:
        targetType === "tree-hole" && commentUserId
          ? `同帖同学 ${createHash("sha256").update(`${targetId}:${commentUserId}`).digest("hex").slice(0, 4)}`
          : author,
    }));
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM content_comments WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL AND status = 'visible'",
          )
          .get(targetType, targetId) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.post("/api/comments", async (c) => {
    const user = requireActiveUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "评论内容格式不正确");
    const targetType = String(body.targetType ?? "");
    const targetId = requiredText(body.targetId, "内容", 1, 80);
    const content = requiredText(body.content, "评论", 1, 1000);
    const target = contentTableFor(targetType);
    if (!target) throw new HttpError(400, "INVALID_INPUT", "评论类型不正确");
    const targetOwner = db
      .query(
        `SELECT ${target.owner} AS ownerId FROM ${target.table} WHERE id = ? AND ${target.predicate}`,
      )
      .get(targetId) as { ownerId: string | null } | null;
    if (!targetOwner)
      throw new HttpError(404, "NOT_FOUND", "内容不存在或已隐藏");
    const parentId = body.parentId
      ? requiredText(body.parentId, "回复对象", 1, 80)
      : null;
    let parentOwner: string | null = null;
    if (parentId) {
      const parent = db
        .query(
          "SELECT id, target_type, target_id, parent_id, user_id FROM content_comments WHERE id = ? AND deleted_at IS NULL AND status = 'visible'",
        )
        .get(parentId) as {
        id: string;
        target_type: string;
        target_id: string;
        parent_id: string | null;
        user_id: string | null;
      } | null;
      if (
        !parent ||
        parent.target_type !== targetType ||
        parent.target_id !== targetId ||
        parent.parent_id
      )
        throw new HttpError(
          400,
          "INVALID_REPLY",
          "只能回复同一内容下的一级评论",
        );
      parentOwner = parent.user_id;
    }
    const id = randomUUID();
    const now = nowIso();
    db.query(
      "INSERT INTO content_comments (id, target_type, target_id, user_id, parent_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'visible', ?, ?)",
    ).run(id, targetType, targetId, user.id, parentId, content, now, now);
    const notifyUser =
      parentOwner && parentOwner !== user.id
        ? parentOwner
        : targetOwner.ownerId;
    if (notifyUser && notifyUser !== user.id)
      addNotification(
        db,
        notifyUser,
        "comment-reply",
        parentId ? "收到一条评论回复" : "你的内容收到新评论",
        "登录后查看社区互动。",
        "./account.html#notifications",
        `comment/${id}`,
      );
    return c.json({ id, createdAt: now }, 201);
  });

  app.patch("/api/comments/:id", async (c) => {
    const user = requireActiveUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    const content = requiredText(
      isRecord(body) ? body.content : null,
      "评论",
      1,
      1000,
    );
    const row = db
      .query(
        "SELECT * FROM content_comments WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      )
      .get(c.req.param("id"), user.id) as Record<string, unknown> | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "找不到你发布的评论");
    db.query(
      "INSERT INTO content_revisions (id, target_type, target_id, editor_id, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      "comment",
      c.req.param("id"),
      user.id,
      JSON.stringify(row),
      nowIso(),
    );
    db.query(
      "UPDATE content_comments SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).run(content, nowIso(), c.req.param("id"), user.id);
    return c.json({ ok: true });
  });

  app.delete("/api/comments/:id", (c) => {
    const user = requireActiveUser(c);
    const result = db
      .query(
        "UPDATE content_comments SET deleted_at = ?, status = 'removed', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      )
      .run(nowIso(), nowIso(), c.req.param("id"), user.id);
    if (!result.changes)
      throw new HttpError(404, "NOT_FOUND", "找不到你发布的评论");
    return c.json({ ok: true });
  });

  app.get("/api/notifications", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const items = db
      .query(
        "SELECT id, kind, title, detail, href, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      )
      .all(user.id, page.pageSize, page.offset);
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?",
          )
          .get(user.id) as { count: number }
      ).count,
    );
    const unread = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL",
          )
          .get(user.id) as { count: number }
      ).count,
    );
    return c.json({
      items,
      total,
      unread,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  app.get("/api/notifications/preferences", (c) => {
    const user = requireUser(c);
    const row = db
      .query(
        "SELECT social_email_enabled AS socialEmailEnabled FROM notification_preferences WHERE user_id = ?",
      )
      .get(user.id) as { socialEmailEnabled: number } | null;
    return c.json({ socialEmailEnabled: row?.socialEmailEnabled !== 0 });
  });

  app.patch("/api/notifications/preferences", async (c) => {
    const user = requireUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.socialEmailEnabled !== "boolean")
      throw new HttpError(400, "INVALID_INPUT", "邮件通知设置不正确");
    db.query(
      "INSERT INTO notification_preferences (user_id, social_email_enabled) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET social_email_enabled = excluded.social_email_enabled",
    ).run(user.id, body.socialEmailEnabled ? 1 : 0);
    return c.json({ socialEmailEnabled: body.socialEmailEnabled });
  });

  app.patch("/api/notifications/:id", (c) => {
    const user = requireUser(c);
    const result = db
      .query(
        "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?",
      )
      .run(nowIso(), c.req.param("id"), user.id);
    if (!result.changes) throw new HttpError(404, "NOT_FOUND", "通知不存在");
    return c.json({ ok: true });
  });

  app.post("/api/notifications/read-all", (c) => {
    const user = requireUser(c);
    db.query(
      "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND read_at IS NULL",
    ).run(nowIso(), user.id);
    return c.json({ ok: true });
  });

  app.post("/api/webhooks/resend", async (c) => {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret)
      throw new HttpError(503, "WEBHOOK_UNCONFIGURED", "邮件回执尚未配置");
    const payload = await c.req.text();
    if (payload.length > 1_000_000)
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "邮件回执内容过大");
    const id = c.req.header("svix-id");
    const timestamp = c.req.header("svix-timestamp");
    const signature = c.req.header("svix-signature");
    if (!id || !timestamp || !signature)
      throw new HttpError(400, "INVALID_WEBHOOK", "邮件回执签名无效");
    let event;
    try {
      const resend = new Resend(
        process.env.RESEND_API_KEY ?? "re_webhook_verification_only",
      );
      event = resend.webhooks.verify({
        payload,
        headers: { id, timestamp, signature },
        webhookSecret,
      });
    } catch {
      throw new HttpError(400, "INVALID_WEBHOOK", "邮件回执签名无效");
    }
    if (!event.type.startsWith("email.") || !("email_id" in event.data))
      return c.json({ received: true, ignored: true });
    const emailId = (event.data as typeof event.data & { email_id: string })
      .email_id;
    const status =
      event.type === "email.delivered"
        ? "delivered"
        : event.type === "email.delivery_delayed"
          ? "delayed"
          : event.type === "email.bounced"
            ? "bounced"
            : event.type === "email.complained"
              ? "complained"
              : event.type === "email.failed"
                ? "failed"
                : event.type === "email.suppressed"
                  ? "suppressed"
                  : event.type === "email.sent"
                    ? "sent"
                    : null;
    db.transaction(() => {
      const inserted = db
        .query(
          "INSERT OR IGNORE INTO email_webhook_events (id, event_type, resend_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, event.type, emailId, nowIso());
      if (!inserted.changes) return;
      if (status)
        db.query(
          "UPDATE email_outbox SET delivery_status = ? WHERE resend_id = ?",
        ).run(status, emailId);
    })();
    return c.json({ received: true });
  });

  app.get("/api/admin/courses/import-template", (c) => {
    requireAdmin(c);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      "attachment; filename=suat-course-import-template.csv",
    );
    return c.body(
      "courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment\n",
    );
  });

  app.post("/api/admin/courses/import-preview", async (c) => {
    const admin = requireAdmin(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.csv !== "string")
      throw new HttpError(400, "INVALID_INPUT", "请提供 CSV 文本");
    const filename = requiredText(
      body.filename ?? "course-import.csv",
      "文件名",
      1,
      160,
    );
    const source = body.csv.replace(/^\uFEFF/, "");
    if (!source.trim() || source.length > 1_000_000)
      throw new HttpError(400, "INVALID_CSV", "CSV 不能为空且不能超过 1 MB");
    const rows = parseCsv(source);
    const requiredHeaders = [
      "courseCode",
      "courseTitle",
      "department",
      "credits",
      "term",
      "section",
      "teacherCode",
      "teacherName",
      "teacherDepartment",
    ];
    const headers = (rows.shift() ?? []).map((header) => header.trim());
    if (requiredHeaders.some((header) => !headers.includes(header)))
      throw new HttpError(
        400,
        "INVALID_CSV_HEADERS",
        `CSV 表头必须包含：${requiredHeaders.join(", ")}`,
      );
    const positions = Object.fromEntries(
      requiredHeaders.map((header) => [header, headers.indexOf(header)]),
    ) as Record<string, number>;
    const errors: { row: number; message: string }[] = [];
    const courses = new Map<
      string,
      {
        code: string;
        title: string;
        department: string;
        credits: number;
        term: string;
      }
    >();
    const offerings = new Map<
      string,
      {
        courseCode: string;
        term: string;
        section: string;
        teachers: Map<
          string,
          { code: string; name: string; department: string }
        >;
      }
    >();
    const rowKeys = new Set<string>();
    rows.forEach((columns, index) => {
      const line = index + 2;
      const value = (key: string) => columns[positions[key]]?.trim() ?? "";
      if (columns.length !== headers.length) {
        errors.push({ row: line, message: "列数与表头不一致" });
        return;
      }
      const code = value("courseCode").toUpperCase();
      const title = value("courseTitle");
      const department = value("department");
      const rawCredits = value("credits");
      const credits = Number(rawCredits);
      const term = value("term");
      const section = value("section");
      const teacherCode = value("teacherCode").toUpperCase();
      const teacherName = value("teacherName");
      const teacherDepartment = value("teacherDepartment");
      if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(code))
        errors.push({ row: line, message: "课程代码格式不正确" });
      if (!title || title.length > 120)
        errors.push({ row: line, message: "课程名称不能为空且最多 120 字" });
      if (department.length > 100)
        errors.push({ row: line, message: "院系最多 100 字" });
      if (
        !rawCredits ||
        !Number.isFinite(credits) ||
        credits < 0 ||
        credits > 50
      )
        errors.push({ row: line, message: "学分需为 0–50 的数字" });
      if (!term || term.length > 40)
        errors.push({ row: line, message: "学期不能为空且最多 40 字" });
      if (section.length > 40)
        errors.push({ row: line, message: "开课标识最多 40 字" });
      if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(teacherCode))
        errors.push({ row: line, message: "教师标识不能为空且最多 40 位" });
      if (!teacherName || teacherName.length > 80)
        errors.push({ row: line, message: "教师姓名不能为空且最多 80 字" });
      if (teacherDepartment.length > 100)
        errors.push({ row: line, message: "教师院系最多 100 字" });
      const duplicateKey = `${code}\u0000${term}\u0000${section}\u0000${teacherCode}`;
      if (rowKeys.has(duplicateKey))
        errors.push({ row: line, message: "同一开课记录重复出现该教师" });
      rowKeys.add(duplicateKey);
      const previous = courses.get(code);
      if (
        previous &&
        (previous.title !== title ||
          previous.department !== department ||
          previous.credits !== credits)
      )
        errors.push({
          row: line,
          message: "同一课程代码对应了不一致的课程信息",
        });
      if (!previous)
        courses.set(code, { code, title, department, credits, term });
      const offeringKey = `${code}\u0000${term}\u0000${section}`;
      const offering = offerings.get(offeringKey) ?? {
        courseCode: code,
        term,
        section,
        teachers: new Map(),
      };
      const existingTeacher = offering.teachers.get(teacherCode);
      if (
        existingTeacher &&
        (existingTeacher.name !== teacherName ||
          existingTeacher.department !== teacherDepartment)
      )
        errors.push({
          row: line,
          message: "同一教师标识对应了不一致的教师信息",
        });
      offering.teachers.set(teacherCode, {
        code: teacherCode,
        name: teacherName,
        department: teacherDepartment,
      });
      offerings.set(offeringKey, offering);
    });
    if (!rows.length) errors.push({ row: 2, message: "CSV 至少需要一条数据" });
    if (errors.length) return c.json({ valid: false, errors }, 422);
    const payload = {
      courses: [...courses.values()],
      offerings: [...offerings.values()].map((offering) => ({
        ...offering,
        teachers: [...offering.teachers.values()],
      })),
    };
    const existingCourses = payload.courses.filter((course) =>
      db.query("SELECT 1 FROM courses WHERE code = ?").get(course.code),
    ).length;
    const existingOfferings = payload.offerings.filter((offering) =>
      db
        .query(
          "SELECT 1 FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE c.code = ? AND o.term = ? AND o.section = ?",
        )
        .get(offering.courseCode, offering.term, offering.section),
    ).length;
    const previewId = randomUUID();
    const createdAt = nowIso();
    db.query(
      "INSERT INTO course_import_previews (id, actor_id, filename, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      previewId,
      admin.id,
      filename,
      JSON.stringify(payload),
      new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt,
    );
    db.query("DELETE FROM course_import_previews WHERE expires_at <= ?").run(
      createdAt,
    );
    return c.json({
      valid: true,
      previewId,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      summary: {
        rows: rows.length,
        courses: payload.courses.length,
        offerings: payload.offerings.length,
        teachers: new Set(
          payload.offerings.flatMap((offering) =>
            offering.teachers.map((teacher) => teacher.code),
          ),
        ).size,
        existingCourses,
        newCourses: payload.courses.length - existingCourses,
        existingOfferings,
        newOfferings: payload.offerings.length - existingOfferings,
      },
    });
  });

  app.post("/api/admin/courses/import-confirm", async (c) => {
    const admin = requireAdmin(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "导入确认格式不正确");
    const previewId = requiredText(body.previewId, "预览编号", 1, 80);
    const preview = db
      .query(
        "SELECT filename, payload_json AS payloadJson, expires_at AS expiresAt FROM course_import_previews WHERE id = ? AND actor_id = ?",
      )
      .get(previewId, admin.id) as {
      filename: string;
      payloadJson: string;
      expiresAt: string;
    } | null;
    if (!preview || preview.expiresAt <= nowIso())
      throw new HttpError(
        404,
        "IMPORT_PREVIEW_EXPIRED",
        "导入预览不存在或已过期，请重新上传 CSV",
      );
    const payload = JSON.parse(preview.payloadJson) as {
      courses: {
        code: string;
        title: string;
        department: string;
        credits: number;
        term: string;
      }[];
      offerings: {
        courseCode: string;
        term: string;
        section: string;
        teachers: { code: string; name: string; department: string }[];
      }[];
    };
    const now = nowIso();
    const batchId = randomUUID();
    db.transaction(() => {
      const rowCount = payload.offerings.reduce(
        (sum, offering) => sum + offering.teachers.length,
        0,
      );
      db.query(
        "INSERT INTO course_import_batches (id, actor_id, filename, row_count, imported_at) VALUES (?, ?, ?, ?, ?)",
      ).run(batchId, admin.id, preview.filename, rowCount, now);
      for (const course of payload.courses) {
        db.query(
          `INSERT INTO courses (id, code, title, department, credits, term, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(code) DO UPDATE SET title = excluded.title, department = excluded.department, credits = excluded.credits, active = 1`,
        ).run(
          randomUUID(),
          course.code,
          course.title,
          course.department,
          course.credits,
          course.term,
          now,
        );
      }
      for (const offering of payload.offerings) {
        const course = db
          .query("SELECT id FROM courses WHERE code = ?")
          .get(offering.courseCode) as { id: string };
        db.query(
          `INSERT INTO course_offerings (id, course_id, term, section, source, import_batch_id, active, created_at) VALUES (?, ?, ?, ?, 'csv', ?, 1, ?)
          ON CONFLICT(course_id, term, section) DO UPDATE SET source = 'csv', import_batch_id = excluded.import_batch_id, active = 1`,
        ).run(
          randomUUID(),
          course.id,
          offering.term,
          offering.section,
          batchId,
          now,
        );
        const savedOffering = db
          .query(
            "SELECT id FROM course_offerings WHERE course_id = ? AND term = ? AND section = ?",
          )
          .get(course.id, offering.term, offering.section) as { id: string };
        db.query("DELETE FROM offering_teachers WHERE offering_id = ?").run(
          savedOffering.id,
        );
        for (const teacher of offering.teachers) {
          db.query(
            `INSERT INTO teachers (id, code, name, department, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(code) DO UPDATE SET name = excluded.name, department = excluded.department, active = 1, updated_at = excluded.updated_at`,
          ).run(
            randomUUID(),
            teacher.code,
            teacher.name,
            teacher.department,
            now,
            now,
          );
          const savedTeacher = db
            .query("SELECT id FROM teachers WHERE code = ?")
            .get(teacher.code) as { id: string };
          db.query(
            "INSERT OR IGNORE INTO offering_teachers (offering_id, teacher_id) VALUES (?, ?)",
          ).run(savedOffering.id, savedTeacher.id);
        }
      }
      db.query("DELETE FROM course_import_previews WHERE id = ?").run(
        previewId,
      );
    })();
    return c.json({
      ok: true,
      batchId,
      rows: payload.offerings.reduce(
        (sum, offering) => sum + offering.teachers.length,
        0,
      ),
    });
  });

  app.get("/api/teachers", (c) => {
    requireUser(c);
    const query = optionalText(c.req.query("q"), 120);
    const page = pagination(c);
    const where = ["t.active = 1"];
    const args: (string | number)[] = [];
    if (query) {
      where.push("(t.name LIKE ? OR t.code LIKE ? OR t.department LIKE ?)");
      const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(escaped, escaped, escaped);
    }
    const items = db
      .query(
        `SELECT t.id, t.code, t.name, t.department, COUNT(DISTINCT o.id) AS offeringCount,
      COUNT(DISTINCT r.id) AS reviewCount, ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating
      FROM teachers t LEFT JOIN offering_teachers ot ON ot.teacher_id = t.id
      LEFT JOIN course_offerings o ON o.id = ot.offering_id AND o.active = 1 AND EXISTS (SELECT 1 FROM courses ac WHERE ac.id = o.course_id AND ac.active = 1)
      LEFT JOIN course_reviews r ON r.offering_id = o.id AND r.status = 'approved' AND r.moderation_status = 'visible' AND r.deleted_at IS NULL
      WHERE ${where.join(" AND ")} GROUP BY t.id ORDER BY t.name, t.id LIMIT ? OFFSET ?`,
      )
      .all(...args, page.pageSize, page.offset) as Record<string, unknown>[];
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM teachers t WHERE ${where.join(" AND ")}`,
          )
          .get(...args) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.get("/api/teachers/:id", (c) => {
    requireUser(c);
    const teacher = db
      .query(
        "SELECT id, code, name, department, bio FROM teachers WHERE id = ? AND active = 1",
      )
      .get(c.req.param("id")) as Record<string, unknown> | null;
    if (!teacher) throw new HttpError(404, "NOT_FOUND", "教师不存在");
    const page = pagination(c);
    const offerings = db
      .query(
        `SELECT o.id AS offeringId, o.term, o.section, c.id AS courseId, c.code AS courseCode, c.title AS courseTitle
      FROM offering_teachers ot JOIN course_offerings o ON o.id = ot.offering_id JOIN courses c ON c.id = o.course_id
      WHERE ot.teacher_id = ? AND o.active = 1 AND c.active = 1 ORDER BY o.term DESC, c.code, o.section LIMIT ? OFFSET ?`,
      )
      .all(c.req.param("id"), page.pageSize, page.offset) as Record<
      string,
      unknown
    >[];
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM offering_teachers ot JOIN course_offerings o ON o.id = ot.offering_id JOIN courses c ON c.id = o.course_id WHERE ot.teacher_id = ? AND o.active = 1 AND c.active = 1",
          )
          .get(c.req.param("id")) as { count: number }
      ).count,
    );
    return c.json({
      ...teacher,
      offerings,
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  app.patch("/api/admin/courses/:id", async (c) => {
    requireAdmin(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.active !== "boolean")
      throw new HttpError(400, "INVALID_INPUT", "课程状态格式不正确");
    const result = db
      .query("UPDATE courses SET active = ? WHERE id = ?")
      .run(body.active ? 1 : 0, c.req.param("id"));
    if (!result.changes) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    return c.json({ ok: true, active: body.active });
  });

  app.patch("/api/admin/teachers/:id", async (c) => {
    requireAdmin(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "教师资料格式不正确");
    const name = requiredText(body.name, "教师姓名", 1, 80);
    const department = optionalText(body.department, 100);
    const bio = optionalText(body.bio, 1000);
    const active = typeof body.active === "boolean" ? body.active : true;
    const result = db
      .query(
        "UPDATE teachers SET name = ?, department = ?, bio = ?, active = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, department, bio, active ? 1 : 0, nowIso(), c.req.param("id"));
    if (!result.changes) throw new HttpError(404, "NOT_FOUND", "教师不存在");
    return c.json({ ok: true });
  });

  app.get("/api/courses", (c) => {
    requireUser(c);
    const query = optionalText(c.req.query("q"), 120);
    const department = optionalText(c.req.query("department"), 80);
    const courseType = optionalText(c.req.query("courseType"), 40);
    const enrollmentType = optionalText(c.req.query("enrollmentType"), 40);
    const term = optionalText(c.req.query("term"), 40);
    const assessment = optionalText(c.req.query("assessment"), 40);
    const where = ["c.active = 1"];
    const args: (string | number)[] = [];
    if (query) {
      where.push(
        "(c.code LIKE ? OR c.title LIKE ? OR c.english_title LIKE ? OR c.department LIKE ? OR EXISTS (SELECT 1 FROM course_offerings o JOIN offering_teachers ot ON ot.offering_id = o.id JOIN teachers t ON t.id = ot.teacher_id WHERE o.course_id = c.id AND o.active = 1 AND t.active = 1 AND t.name LIKE ?))",
      );
      const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(escaped, escaped, escaped, escaped, escaped);
    }
    for (const [column, value] of [
      ["department", department],
      ["course_type", courseType],
      ["enrollment_type", enrollmentType],
      ["term", term],
      ["assessment", assessment],
    ] as const) {
      if (value) {
        where.push(`c.${column} = ?`);
        args.push(value);
      }
    }
    const page = pagination(c);
    const rows = db
      .query(
        `SELECT c.id, c.code, c.title, c.english_title AS englishTitle,
           c.department, c.course_type AS courseType,
           c.enrollment_type AS enrollmentType, c.credits, c.term,
           c.assessment, ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating,
           ROUND(COALESCE(AVG(r.difficulty), c.difficulty), 1) AS difficulty,
           COUNT(r.id) AS reviewCount
         FROM courses c LEFT JOIN course_reviews r
           ON r.course_id = c.id AND r.status = 'approved'
             AND r.moderation_status = 'visible' AND r.deleted_at IS NULL
         WHERE ${where.join(" AND ")}
         GROUP BY c.id ORDER BY rating DESC, c.code ASC, c.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...args, page.pageSize, page.offset) as Record<string, unknown>[];
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM courses c WHERE ${where.join(" AND ")}`,
          )
          .get(...args) as { count: number } | null
      )?.count ?? 0,
    );
    return c.json({
      items: rows,
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  app.get("/api/courses/:id", (c) => {
    requireUser(c);
    const course = db
      .query(
        `SELECT c.id, c.code, c.title, c.english_title AS englishTitle, c.department,
      c.course_type AS courseType, c.enrollment_type AS enrollmentType, c.credits, c.term, c.assessment,
      ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating,
      ROUND(COALESCE(AVG(r.difficulty), c.difficulty), 1) AS difficulty, COUNT(r.id) AS reviewCount
      FROM courses c LEFT JOIN course_reviews r ON r.course_id = c.id AND r.status = 'approved' AND r.moderation_status = 'visible' AND r.deleted_at IS NULL
      WHERE (c.id = ? OR c.code = ?) AND c.active = 1 GROUP BY c.id`,
      )
      .get(c.req.param("id"), c.req.param("id")) as
      (Record<string, unknown> & { id: string }) | null;
    if (!course) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    const offerings = db
      .query(
        "SELECT id, term, section FROM course_offerings WHERE course_id = ? AND active = 1 ORDER BY term DESC, section",
      )
      .all(course.id) as { id: string; term: string; section: string }[];
    return c.json({
      ...course,
      offerings: offerings.map((offering) => ({
        ...offering,
        teachers: db
          .query(
            `SELECT t.id, t.name, t.department FROM offering_teachers ot JOIN teachers t ON t.id = ot.teacher_id WHERE ot.offering_id = ? AND t.active = 1 ORDER BY t.name, t.id`,
          )
          .all(offering.id),
      })),
    });
  });

  app.get("/api/courses/:id/reviews", (c) => {
    requireUser(c);
    const courseId = c.req.param("id");
    const course = db
      .query("SELECT id FROM courses WHERE (id = ? OR code = ?) AND active = 1")
      .get(courseId, courseId);
    if (!course) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    const page = pagination(c);
    const teacherId = optionalText(c.req.query("teacherId"), 80);
    const teacherFilter = teacherId
      ? "AND EXISTS (SELECT 1 FROM offering_teachers ot WHERE ot.offering_id = r.offering_id AND ot.teacher_id = ?)"
      : "";
    const reviewArgs: (string | number)[] = [(course as { id: string }).id];
    if (teacherId) reviewArgs.push(teacherId);
    const items = db
      .query(
        `SELECT r.id, r.author_label AS author, r.rating, r.difficulty, r.workload,
           r.content, r.tags_json AS tagsJson, r.term, r.offering_id AS offeringId, r.created_at AS createdAt
         FROM course_reviews r WHERE r.course_id = ? AND r.status = 'approved'
           AND r.moderation_status = 'visible' AND r.deleted_at IS NULL ${teacherFilter}
         ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...reviewArgs, page.pageSize, page.offset) as Record<
      string,
      unknown
    >[];
    const countArgs: (string | number)[] = [(course as { id: string }).id];
    if (teacherId) countArgs.push(teacherId);
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM course_reviews r WHERE r.course_id = ? AND r.status = 'approved' AND r.moderation_status = 'visible' AND r.deleted_at IS NULL ${teacherFilter}`,
          )
          .get(...countArgs) as { count: number }
      ).count,
    );
    return c.json({
      total,
      page: page.page,
      pageSize: page.pageSize,
      items: items.map((item) => ({
        ...item,
        tags: parseJsonArray(String(item.tagsJson)),
      })),
    });
  });

  app.post("/api/courses/:id/reviews", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "course-review", 3, 24 * 60 * 60 * 1000);
    const courseId = c.req.param("id");
    const course = db
      .query("SELECT id FROM courses WHERE (id = ? OR code = ?) AND active = 1")
      .get(courseId, courseId) as { id: string } | null;
    if (!course) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const rating = numberInRange(body.rating, "评分", 1, 10);
    const difficulty = numberInRange(body.difficulty, "难度", 1, 5);
    const workload = numberInRange(body.workload, "作业量", 1, 5);
    const content = requiredText(body.content, "评价内容", 10, 1200);
    const requestedOfferingId = optionalText(body.offeringId, 80);
    let offeringId: string | null = null;
    let term = requiredText(body.term, "学期", 3, 40);
    if (requestedOfferingId) {
      const offering = db
        .query(
          "SELECT id, term FROM course_offerings WHERE id = ? AND course_id = ? AND active = 1",
        )
        .get(requestedOfferingId, course.id) as {
        id: string;
        term: string;
      } | null;
      if (!offering)
        throw new HttpError(
          400,
          "INVALID_OFFERING",
          "所选开课记录不属于该课程或已停用",
        );
      offeringId = offering.id;
      term = offering.term;
    }
    const tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === "string")
          .slice(0, 8)
          .map((tag) => tag.trim().slice(0, 24))
      : [];
    const duplicate = db
      .query(
        "SELECT id FROM course_reviews WHERE course_id = ? AND user_id = ? AND term = ?",
      )
      .get(course.id, user.id, term);
    if (duplicate)
      throw new HttpError(
        409,
        "DUPLICATE_REVIEW",
        "你已提交过该课程本学期的评价",
      );
    const id = randomUUID();
    db.query(
      `INSERT INTO course_reviews
       (id, course_id, offering_id, user_id, author_label, rating, difficulty, workload, content, tags_json, term, status, created_at)
       VALUES (?, ?, ?, ?, '匿名同学', ?, ?, ?, ?, ?, ?, 'approved', ?)`,
    ).run(
      id,
      course.id,
      offeringId,
      user.id,
      rating,
      difficulty,
      workload,
      content,
      JSON.stringify(tags),
      term,
      nowIso(),
    );
    return c.json(
      {
        id,
        status: "approved",
        message: "评价已发布，你可随时在个人中心中修改或删除。",
      },
      201,
    );
  });

  app.get("/api/market/listings", (c) => {
    const user = requireUser(c);
    const category = optionalText(c.req.query("category"), 50);
    const query = optionalText(c.req.query("q"), 120);
    const where = [
      "l.status = 'active'",
      "l.moderation_status = 'visible'",
      "l.deleted_at IS NULL",
    ];
    const args: string[] = [];
    if (category && category !== "all") {
      where.push("l.category = ?");
      args.push(category);
    }
    if (query) {
      where.push("(l.title LIKE ? OR l.description LIKE ?)");
      args.push(`%${query}%`, `%${query}%`);
    }
    const rows = db
      .query(
        `SELECT l.*, '匿名狸友' AS seller_name FROM market_listings l
         WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pagination(c).pageSize, pagination(c).offset) as Record<
      string,
      unknown
    >[];
    const page = pagination(c);
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM market_listings l WHERE ${where.join(" AND ")}`,
          )
          .get(...args) as { count: number }
      ).count,
    );
    return c.json({
      items: rows.map((row) => mapListing(row, user?.id)),
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  app.post("/api/market/listings", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "market-listing", 5, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const title = requiredText(body.title, "商品标题", 2, 100);
    const category = requiredText(body.category, "分类", 1, 50);
    const price = numberInRange(body.price, "价格", 0, 1000000);
    const condition = requiredText(body.condition, "成色", 1, 30);
    const location = requiredText(body.location, "面交地点", 1, 100);
    const description = requiredText(body.description, "商品描述", 5, 1200);
    const images = Array.isArray(body.images)
      ? body.images
          .filter((value): value is string => typeof value === "string")
          .slice(0, 4)
      : [];
    if (
      images.some(
        (image) => !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(image),
      )
    ) {
      throw new HttpError(400, "INVALID_IMAGE", "图片地址不合法，请重新上传");
    }
    const id = randomUUID();
    const now = nowIso();
    db.query(
      `INSERT INTO market_listings
       (id, seller_id, title, category, price, condition, location, description, images_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      user.id,
      title,
      category,
      price,
      condition,
      location,
      description,
      JSON.stringify(images),
      now,
      now,
    );
    return c.json({ id, message: "闲置已发布" }, 201);
  });

  app.patch("/api/market/listings/:id", async (c) => {
    const user = requireActiveUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      !["reserved", "sold", "active"].includes(String(body.status))
    ) {
      throw new HttpError(400, "INVALID_INPUT", "商品状态不正确");
    }
    const result = db
      .query(
        "UPDATE market_listings SET status = ?, updated_at = ? WHERE id = ? AND seller_id = ?",
      )
      .run(String(body.status), nowIso(), c.req.param("id"), user.id);
    if (result.changes === 0)
      throw new HttpError(404, "NOT_FOUND", "找不到你发布的商品");
    return c.json({ ok: true });
  });

  app.post("/api/market/listings/:id/contact", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "contact-request", 20, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => ({}));
    const message = optionalText(
      isRecord(body) ? body.message : undefined,
      240,
    );
    const id = addContactRequest(
      db,
      user,
      "listing",
      c.req.param("id"),
      message,
    );
    const request = db
      .query("SELECT recipient_id FROM contact_requests WHERE id = ?")
      .get(id) as { recipient_id: string };
    addNotification(
      db,
      request.recipient_id,
      "contact",
      "收到新的联系请求",
      "登录后在个人中心查看请求并决定是否开启私信。",
      "./account.html#requests",
      `contact/${id}`,
    );
    return c.json(
      { id, message: "联系请求已发送；对方接受后，你们可以继续私信交流。" },
      201,
    );
  });

  app.get("/api/skills", (c) => {
    const user = requireUser(c);
    const kind = c.req.query("kind");
    const category = optionalText(c.req.query("category"), 50);
    const where = [
      "status = 'active'",
      "moderation_status = 'visible'",
      "deleted_at IS NULL",
    ];
    const args: string[] = [];
    if (kind === "offer" || kind === "request") {
      where.push("kind = ?");
      args.push(kind);
    }
    if (category && category !== "all") {
      where.push("category = ?");
      args.push(category);
    }
    const rows = db
      .query(
        `SELECT * FROM skill_posts WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pagination(c).pageSize, pagination(c).offset) as Record<
      string,
      unknown
    >[];
    const page = pagination(c);
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM skill_posts WHERE ${where.join(" AND ")}`,
          )
          .get(...args) as { count: number }
      ).count,
    );
    return c.json({
      items: rows.map((row) => mapSkill(row, user?.id)),
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  app.post("/api/skills", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "skill-post", 5, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || !["offer", "request"].includes(String(body.kind))) {
      throw new HttpError(400, "INVALID_INPUT", "发布类型不正确");
    }
    const title = requiredText(body.title, "标题", 3, 100);
    const category = requiredText(body.category, "领域", 2, 50);
    const description = requiredText(body.description, "详细描述", 10, 1000);
    const tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === "string")
          .slice(0, 10)
          .map((tag) => tag.trim().slice(0, 24))
      : [];
    const canOffer = optionalText(body.canOffer, 200);
    const wants = optionalText(body.wants, 200);
    const skillKind = body.kind as "offer" | "request";
    const id = randomUUID();
    db.query(
      `INSERT INTO skill_posts
       (id, user_id, kind, title, category, description, tags_json, can_offer, wants, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(
      id,
      user.id,
      skillKind,
      title,
      category,
      description,
      JSON.stringify(tags),
      canOffer,
      wants,
      nowIso(),
    );
    return c.json({ id, message: "技能互助内容已发布" }, 201);
  });

  app.get("/api/skills/stats", (c) => {
    requireUser(c);
    const start = shanghaiMonthStart();
    const pairs = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM skill_collaborations sc
             JOIN skill_posts rp ON rp.id = sc.request_post_id
             JOIN skill_posts op ON op.id = sc.offer_post_id
             WHERE sc.started_at >= ? AND sc.status IN ('active', 'completed')
               AND rp.status = 'active' AND rp.moderation_status = 'visible' AND rp.deleted_at IS NULL AND rp.is_demo = 0
               AND op.status = 'active' AND op.moderation_status = 'visible' AND op.deleted_at IS NULL AND op.is_demo = 0`,
          )
          .get(start) as { count: number }
      ).count,
    );
    const requests = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM skill_posts WHERE kind = 'request' AND created_at >= ? AND status = 'active' AND deleted_at IS NULL AND moderation_status = 'visible' AND is_demo = 0",
          )
          .get(start) as { count: number }
      ).count,
    );
    const resolved = Number(
      (
        db
          .query(
            `SELECT COUNT(DISTINCT sp.id) AS count FROM skill_posts sp
        JOIN skill_collaborations sc ON sc.request_post_id = sp.id AND sc.status = 'completed'
        JOIN skill_posts op ON op.id = sc.offer_post_id
        WHERE sp.kind = 'request' AND sp.created_at >= ? AND sp.status = 'active' AND sp.deleted_at IS NULL AND sp.moderation_status = 'visible' AND sp.is_demo = 0
          AND op.status = 'active' AND op.deleted_at IS NULL AND op.moderation_status = 'visible' AND op.is_demo = 0`,
          )
          .get(start) as { count: number }
      ).count,
    );
    const completed = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM skill_collaborations sc
             JOIN skill_posts rp ON rp.id = sc.request_post_id
             JOIN skill_posts op ON op.id = sc.offer_post_id
             WHERE sc.status = 'completed' AND sc.completed_at >= ?
               AND rp.status = 'active' AND rp.moderation_status = 'visible' AND rp.deleted_at IS NULL AND rp.is_demo = 0
               AND op.status = 'active' AND op.moderation_status = 'visible' AND op.deleted_at IS NULL AND op.is_demo = 0`,
          )
          .get(start) as { count: number }
      ).count,
    );
    return c.json({
      period: start.slice(0, 7),
      timeZone: "Asia/Shanghai",
      successfulPairs: pairs,
      completedCollaborations: completed,
      helpResolution: {
        numerator: Math.min(resolved, requests),
        denominator: requests,
        rate: requests
          ? Math.round((Math.min(resolved, requests) / requests) * 100)
          : null,
      },
    });
  });

  app.get("/api/skills/recommendations", (c) => {
    const user = requireUser(c);
    const requestId = requiredText(c.req.query("requestId"), "求助", 1, 80);
    const requestPost = db
      .query(
        "SELECT id, user_id, category, tags_json FROM skill_posts WHERE id = ? AND kind = 'request' AND status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
      )
      .get(requestId) as {
      id: string;
      user_id: string;
      category: string;
      tags_json: string;
    } | null;
    if (!requestPost || requestPost.user_id !== user.id)
      throw new HttpError(404, "NOT_FOUND", "找不到你发布的求助");
    const wantedTags = new Set(parseJsonArray(requestPost.tags_json));
    const offers = db
      .query(
        "SELECT id, user_id AS userId, title, category, tags_json AS tagsJson, created_at AS createdAt FROM skill_posts WHERE kind = 'offer' AND status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL AND user_id <> ? ORDER BY created_at DESC, id DESC LIMIT 200",
      )
      .all(user.id) as Record<string, unknown>[];
    const results = offers
      .map((offer) => {
        const tags = parseJsonArray(String(offer.tagsJson));
        const overlap = tags.filter((tag) => wantedTags.has(tag)).length;
        const sameCategory = offer.category === requestPost.category;
        return {
          id: offer.id,
          title: offer.title,
          category: offer.category,
          tags,
          score: overlap + (sameCategory ? 3 : 0),
          reasons: [
            ...(sameCategory ? ["同一领域"] : []),
            ...(overlap ? [`${overlap} 个标签相符`] : []),
          ],
          createdAt: offer.createdAt,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          String(b.createdAt).localeCompare(String(a.createdAt)) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, 20);
    return c.json({ requestId, items: results });
  });

  app.post("/api/skills/requests/:id/collaborations", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(
      db,
      user.id,
      "skill-collaboration",
      10,
      24 * 60 * 60 * 1000,
    );
    const requestId = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const offerId = requiredText(body.offerPostId, "技能分享", 1, 80);
    const scope = requiredText(body.scope, "合作内容", 5, 500);
    const requestPost = db
      .query(
        "SELECT id, user_id FROM skill_posts WHERE id = ? AND kind = 'request' AND status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
      )
      .get(requestId) as { id: string; user_id: string } | null;
    const offerPost = db
      .query(
        "SELECT id, user_id FROM skill_posts WHERE id = ? AND kind = 'offer' AND status = 'active' AND moderation_status = 'visible' AND deleted_at IS NULL",
      )
      .get(offerId) as { id: string; user_id: string } | null;
    if (!requestPost || !offerPost)
      throw new HttpError(404, "NOT_FOUND", "求助或技能分享不存在");
    if (offerPost.user_id !== user.id || requestPost.user_id === user.id)
      throw new HttpError(
        403,
        "NOT_ALLOWED",
        "请使用自己发布的技能分享申请其他同学的求助",
      );
    const id = randomUUID();
    const now = nowIso();
    try {
      db.query(
        "INSERT INTO skill_collaborations (id, request_post_id, offer_post_id, requester_id, provider_id, status, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?)",
      ).run(
        id,
        requestPost.id,
        offerPost.id,
        requestPost.user_id,
        user.id,
        scope,
        now,
        now,
      );
    } catch {
      throw new HttpError(
        409,
        "COLLABORATION_EXISTS",
        "该求助已有进行中的互助申请",
      );
    }
    addNotification(
      db,
      requestPost.user_id,
      "skill-collaboration",
      "收到互助申请",
      "一位同学希望帮助你完成求助。",
      "./account.html#collaborations",
      `collab-proposal/${id}`,
    );
    return c.json({ id, status: "proposed" }, 201);
  });

  app.get("/api/me/collaborations", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const items = db
      .query(
        `SELECT sc.id, sc.status, sc.scope, sc.created_at AS createdAt, sc.started_at AS startedAt, sc.requester_completed_at AS requesterCompletedAt, sc.provider_completed_at AS providerCompletedAt, rp.title AS requestTitle, op.title AS offerTitle, CASE WHEN sc.requester_id = ? THEN sc.provider_id ELSE sc.requester_id END AS otherUserId, CASE WHEN sc.requester_id = ? THEN 1 ELSE 0 END AS isRequester, (SELECT display_name FROM users u WHERE u.id = CASE WHEN sc.requester_id = ? THEN sc.provider_id ELSE sc.requester_id END) AS otherName FROM skill_collaborations sc JOIN skill_posts rp ON rp.id = sc.request_post_id JOIN skill_posts op ON op.id = sc.offer_post_id WHERE sc.requester_id = ? OR sc.provider_id = ? ORDER BY sc.created_at DESC, sc.id DESC LIMIT ? OFFSET ?`,
      )
      .all(
        user.id,
        user.id,
        user.id,
        user.id,
        user.id,
        page.pageSize,
        page.offset,
      );
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM skill_collaborations WHERE requester_id = ? OR provider_id = ?",
          )
          .get(user.id, user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.patch("/api/collaborations/:id", async (c) => {
    const user = requireActiveUser(c);
    const id = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    const action = isRecord(body) ? body.action : null;
    const row = db
      .query(
        "SELECT * FROM skill_collaborations WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
      )
      .get(id, user.id, user.id) as {
      requester_id: string;
      provider_id: string;
      status: string;
      requester_completed_at: string | null;
      provider_completed_at: string | null;
    } | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "互助记录不存在");
    const now = nowIso();
    if (
      action === "accept" &&
      row.status === "proposed" &&
      user.id === row.requester_id
    ) {
      db.query(
        "UPDATE skill_collaborations SET status = 'active', started_at = ?, updated_at = ? WHERE id = ? AND status = 'proposed'",
      ).run(now, now, id);
      addNotification(
        db,
        row.provider_id,
        "skill-collaboration",
        "互助申请已接受",
        "双方可以开始交流并进行互助。",
        "./account.html#collaborations",
        `collab-accept/${id}`,
      );
    } else if (
      action === "decline" &&
      row.status === "proposed" &&
      user.id === row.requester_id
    ) {
      db.query(
        "UPDATE skill_collaborations SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'proposed'",
      ).run(now, id);
    } else if (
      action === "cancel" &&
      ["proposed", "active"].includes(row.status)
    ) {
      db.query(
        "UPDATE skill_collaborations SET status = 'cancelled', updated_at = ? WHERE id = ?",
      ).run(now, id);
    } else if (action === "confirm-complete" && row.status === "active") {
      const side =
        user.id === row.requester_id
          ? "requester_completed_at"
          : "provider_completed_at";
      db.query(
        `UPDATE skill_collaborations SET ${side} = COALESCE(${side}, ?), updated_at = ? WHERE id = ? AND status = 'active'`,
      ).run(now, now, id);
      const current = db
        .query(
          "SELECT requester_completed_at, provider_completed_at FROM skill_collaborations WHERE id = ?",
        )
        .get(id) as {
        requester_completed_at: string | null;
        provider_completed_at: string | null;
      };
      if (current.requester_completed_at && current.provider_completed_at)
        db.query(
          "UPDATE skill_collaborations SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        ).run(now, now, id);
      addNotification(
        db,
        user.id === row.requester_id ? row.provider_id : row.requester_id,
        "skill-collaboration",
        "互助完成状态已更新",
        "请在个人中心确认互助是否完成。",
        "./account.html#collaborations",
        `collab-complete/${id}/${user.id}`,
      );
    } else if (action === "dispute" && row.status === "active") {
      db.transaction(() => {
        db.query(
          "UPDATE skill_collaborations SET status = 'disputed', updated_at = ? WHERE id = ? AND status = 'active'",
        ).run(now, id);
        const otherUserId =
          user.id === row.requester_id ? row.provider_id : row.requester_id;
        addNotification(
          db,
          otherUserId,
          "skill-collaboration-dispute",
          "对方对互助进度提出争议",
          "该记录已进入社区治理队列。",
          "./account.html#collaborations",
          `collaboration-disputed/${id}`,
        );
      })();
    } else {
      throw new HttpError(
        409,
        "INVALID_TRANSITION",
        "当前互助状态不能执行此操作",
      );
    }
    return c.json({ ok: true });
  });

  app.post("/api/collaborations/:id/feedback", async (c) => {
    const user = requireActiveUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const rating = numberInRange(body.rating, "评分", 1, 5);
    const content = optionalText(body.content, 500);
    const row = db
      .query(
        "SELECT status FROM skill_collaborations WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
      )
      .get(c.req.param("id"), user.id, user.id) as { status: string } | null;
    if (!row || row.status !== "completed")
      throw new HttpError(409, "NOT_COMPLETED", "双方确认完成后才能反馈");
    try {
      db.query(
        "INSERT INTO skill_feedback (id, collaboration_id, author_id, rating, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        randomUUID(),
        c.req.param("id"),
        user.id,
        rating,
        content,
        nowIso(),
      );
    } catch {
      throw new HttpError(409, "FEEDBACK_EXISTS", "你已提交过反馈");
    }
    return c.json({ ok: true }, 201);
  });

  app.post("/api/skills/:id/contact", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "contact-request", 20, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => ({}));
    const message = optionalText(
      isRecord(body) ? body.message : undefined,
      240,
    );
    const id = addContactRequest(db, user, "skill", c.req.param("id"), message);
    const request = db
      .query("SELECT recipient_id FROM contact_requests WHERE id = ?")
      .get(id) as { recipient_id: string };
    addNotification(
      db,
      request.recipient_id,
      "contact",
      "收到新的互助联系请求",
      "登录后在个人中心查看请求并决定是否开启私信。",
      "./account.html#requests",
      `contact/${id}`,
    );
    return c.json(
      { id, message: "互助联系请求已发送；对方接受后，你们可以继续私信交流。" },
      201,
    );
  });

  app.get("/api/tree-hole", (c) => {
    const user = requireUser(c);
    const topic = optionalText(c.req.query("topic"), 40);
    const sort = c.req.query("sort") === "popular" ? "popular" : "recent";
    const page = pagination(c);
    const limit = clampInt(c.req.query("limit"), page.pageSize, 100);
    const offset = Number.isInteger(Number(c.req.query("offset")))
      ? Math.max(0, Number(c.req.query("offset")))
      : page.offset;
    const where = [
      "p.status = 'approved'",
      "p.moderation_status = 'visible'",
      "p.deleted_at IS NULL",
    ];
    const args: (string | number)[] = [];
    if (topic && topic !== "all") {
      where.push("p.topic = ?");
      args.push(topic);
    }
    if (user) args.push(user.id);
    args.push(limit, offset);
    const rows = db
      .query(
        `SELECT p.id, p.content, p.topic, p.created_at AS createdAt,
           (SELECT COUNT(*) FROM tree_reactions tr WHERE tr.post_id = p.id) AS reactions,
           ${user ? "EXISTS (SELECT 1 FROM tree_reactions tr WHERE tr.post_id = p.id AND tr.user_id = ?) AS reacted" : "0 AS reacted"}
         FROM tree_posts p WHERE ${where.join(" AND ")}
         ORDER BY ${sort === "popular" ? "reactions DESC, p.created_at DESC" : "p.created_at DESC"}
         LIMIT ? OFFSET ?`,
      )
      .all(...args) as Record<string, unknown>[];
    const countArgs = topic && topic !== "all" ? [topic] : [];
    const count = db
      .query(
        `SELECT COUNT(*) AS count FROM tree_posts p WHERE ${where.join(" AND ")}`,
      )
      .get(...countArgs) as { count: number } | null;
    const total = Number(count?.count ?? 0);
    return c.json({
      items: rows.map((row) => ({
        ...row,
        reacted: Boolean(row.reacted),
        author: "匿名狸友",
      })),
      total,
      page: page.page,
      pageSize: limit,
      hasMore: offset + rows.length < total,
    });
  });

  app.post("/api/tree-hole", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "tree-post", 5, 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const content = requiredText(body.content, "树洞内容", 5, 1000);
    const topic = optionalText(body.topic, 40, "校园生活");
    const id = randomUUID();
    db.query(
      `INSERT INTO tree_posts (id, user_id, content, topic, status, created_at)
       VALUES (?, ?, ?, ?, 'approved', ?)`,
    ).run(id, user.id, content, topic, nowIso());
    return c.json(
      {
        id,
        status: "approved",
        message: "树洞已发布并以匿名方式展示。你可随时在个人中心中修改或删除。",
      },
      201,
    );
  });

  app.post("/api/tree-hole/:id/feel", (c) => {
    const user = requireActiveUser(c);
    const postId = c.req.param("id");
    const exists = db
      .query(
        "SELECT id FROM tree_posts WHERE id = ? AND status = 'approved' AND moderation_status = 'visible' AND deleted_at IS NULL",
      )
      .get(postId);
    if (!exists) throw new HttpError(404, "NOT_FOUND", "树洞内容不存在");
    const prior = db
      .query(
        "SELECT post_id FROM tree_reactions WHERE post_id = ? AND user_id = ?",
      )
      .get(postId, user.id);
    if (prior) {
      db.query(
        "DELETE FROM tree_reactions WHERE post_id = ? AND user_id = ?",
      ).run(postId, user.id);
      return c.json({ reacted: false });
    }
    db.query(
      "INSERT INTO tree_reactions (post_id, user_id, created_at) VALUES (?, ?, ?)",
    ).run(postId, user.id, nowIso());
    return c.json({ reacted: true });
  });

  app.post("/api/reports", async (c) => {
    const user = requireUser(c);
    consumeRateLimit(db, user.id, "report", 10, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      !["tree-hole", "review", "listing", "skill", "comment"].includes(
        String(body.targetType),
      )
    ) {
      throw new HttpError(400, "INVALID_INPUT", "举报对象类型不正确");
    }
    const targetType = String(body.targetType);
    const targetId = requiredText(body.targetId, "举报对象", 1, 80);
    const reason = requiredText(body.reason, "举报原因", 3, 300);
    const table =
      targetType === "tree-hole"
        ? "tree_posts"
        : targetType === "review"
          ? "course_reviews"
          : targetType === "listing"
            ? "market_listings"
            : targetType === "comment"
              ? "content_comments"
              : "skill_posts";
    const target = db
      .query(`SELECT * FROM ${table} WHERE id = ?`)
      .get(targetId) as Record<string, unknown> | null;
    if (
      !target ||
      (targetType === "comment" &&
        (target.deleted_at || target.status !== "visible"))
    ) {
      throw new HttpError(404, "NOT_FOUND", "举报对象不存在");
    }
    const targetOwner =
      targetType === "listing" ? target.seller_id : target.user_id;
    if (targetOwner === user.id)
      throw new HttpError(400, "SELF_REPORT", "不能举报自己发布的内容");
    const id = randomUUID();
    try {
      db.query(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      ).run(id, user.id, targetType, targetId, reason, nowIso());
    } catch {
      throw new HttpError(409, "DUPLICATE_REPORT", "你已举报过此内容");
    }
    db.query(
      "INSERT INTO moderation_evidence (report_id, target_type, target_id, snapshot_json, captured_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, targetType, targetId, JSON.stringify(target), nowIso());
    return c.json({ id, message: "举报已提交，感谢协助维护社区环境。" }, 201);
  });

  app.get("/api/me/contact-requests", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const items = db
      .query(
        `SELECT id, target_type AS targetType, target_id AS targetId,
           message, status, created_at AS createdAt,
           CASE WHEN recipient_id = ? THEN 'received' ELSE 'sent' END AS direction,
           CASE WHEN recipient_id = ? THEN (SELECT display_name FROM users WHERE id = sender_id)
             ELSE (SELECT display_name FROM users WHERE id = recipient_id) END AS otherName,
           (SELECT conversation_id FROM contact_conversation_links WHERE request_id = contact_requests.id) AS conversationId
         FROM contact_requests WHERE sender_id = ? OR recipient_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(user.id, user.id, user.id, user.id, page.pageSize, page.offset);
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM contact_requests WHERE sender_id = ? OR recipient_id = ?",
          )
          .get(user.id, user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.patch("/api/me/contact-requests/:id", async (c) => {
    const user = requireActiveUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      !["accepted", "declined", "cancelled"].includes(String(body.status))
    ) {
      throw new HttpError(400, "INVALID_INPUT", "联系请求状态不正确");
    }
    const requestStatus = String(body.status);
    const requestId = c.req.param("id");
    const request = db
      .query(
        "SELECT * FROM contact_requests WHERE id = ? AND status = 'pending'",
      )
      .get(requestId) as {
      id: string;
      sender_id: string;
      recipient_id: string;
      target_type: string;
      target_id: string;
    } | null;
    if (!request)
      throw new HttpError(404, "NOT_FOUND", "找不到待处理的联系请求");
    if (
      (requestStatus === "cancelled" && request.sender_id !== user.id) ||
      (requestStatus !== "cancelled" && request.recipient_id !== user.id)
    ) {
      throw new HttpError(
        403,
        "NOT_ALLOWED",
        "只有请求发起人可以撤回，接收人可以接受或拒绝",
      );
    }
    if (requestStatus !== "cancelled") {
      const blocked = db
        .query(
          `SELECT 1 FROM user_blocks
        WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
        )
        .get(
          request.sender_id,
          request.recipient_id,
          request.recipient_id,
          request.sender_id,
        );
      if (blocked)
        throw new HttpError(
          403,
          "USER_BLOCKED",
          "双方存在屏蔽关系，无法开启会话",
        );
    }
    let conversationId: string | null = null;
    const update = db.transaction(() => {
      const changed = db
        .query(
          "UPDATE contact_requests SET status = ? WHERE id = ? AND status = 'pending'",
        )
        .run(requestStatus, requestId);
      if (!changed.changes)
        throw new HttpError(409, "REQUEST_ALREADY_HANDLED", "联系请求已处理");
      if (requestStatus !== "accepted") return;
      const existing = db
        .query(
          `SELECT cp1.conversation_id AS id
        FROM conversation_participants cp1 JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
        WHERE cp1.user_id = ? AND cp2.user_id = ? LIMIT 1`,
        )
        .get(request.sender_id, request.recipient_id) as { id: string } | null;
      conversationId = existing?.id ?? randomUUID();
      if (!existing) {
        db.query(
          "INSERT INTO conversations (id, contact_request_id, created_at) VALUES (?, ?, ?)",
        ).run(conversationId, requestId, nowIso());
        db.query(
          "INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)",
        ).run(
          conversationId,
          request.sender_id,
          conversationId,
          request.recipient_id,
        );
      }
      db.query(
        "INSERT INTO contact_conversation_links (request_id, conversation_id, created_at) VALUES (?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET conversation_id = excluded.conversation_id",
      ).run(requestId, conversationId, nowIso());
    });
    update();
    if (requestStatus === "accepted")
      addNotification(
        db,
        request.sender_id,
        "contact-accepted",
        "联系请求已接受",
        "你可以在私信中继续交流。",
        `./account.html#messages`,
        `contact-accepted/${requestId}`,
      );
    return c.json({ ok: true, ...(conversationId ? { conversationId } : {}) });
  });

  app.get("/api/conversations", (c) => {
    const user = requireUser(c);
    const page = pagination(c);
    const items = db
      .query(
        `SELECT c.id, c.last_message_at AS lastMessageAt,
      COALESCE(c.last_message_at, c.created_at) AS updatedAt,
      (SELECT display_name FROM users u WHERE u.id = other.user_id) AS otherName,
      (SELECT COUNT(*) FROM messages m JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
        WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unreadCount,
      (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage
      FROM conversations c JOIN conversation_participants mine ON mine.conversation_id = c.id AND mine.user_id = ?
      JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC LIMIT ? OFFSET ?`,
      )
      .all(user.id, user.id, user.id, user.id, page.pageSize, page.offset);
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM conversation_participants WHERE user_id = ?",
          )
          .get(user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.get("/api/conversations/:id/messages", (c) => {
    const user = requireUser(c);
    const conversationId = c.req.param("id");
    const participant = db
      .query(
        "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
      )
      .get(conversationId, user.id);
    if (!participant) throw new HttpError(404, "NOT_FOUND", "会话不存在");
    const pageSize = clampInt(c.req.query("pageSize"), 20, 100);
    const before = optionalText(c.req.query("before"), 80);
    const after = optionalText(c.req.query("after"), 80);
    if (before && after)
      throw new HttpError(400, "INVALID_CURSOR", "消息游标不正确");
    const cursorId = before || after;
    const cursor = cursorId
      ? (db
          .query(
            "SELECT created_at AS createdAt FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL",
          )
          .get(cursorId, conversationId) as { createdAt: string } | null)
      : null;
    if (cursorId && !cursor)
      throw new HttpError(400, "INVALID_CURSOR", "消息游标已失效");
    const comparison = before
      ? "(m.created_at < ? OR (m.created_at = ? AND m.id < ?))"
      : after
        ? "(m.created_at > ? OR (m.created_at = ? AND m.id > ?))"
        : "1 = 1";
    const direction = after ? "ASC" : "DESC";
    const cursorArgs = cursor
      ? [cursor.createdAt, cursor.createdAt, cursorId!]
      : [];
    const rows = db
      .query(
        `SELECT m.id, m.client_id AS clientId, m.body, m.created_at AS createdAt,
      m.sender_id = ? AS isMine, u.display_name AS senderName
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND ${comparison}
      ORDER BY m.created_at ${direction}, m.id ${direction} LIMIT ?`,
      )
      .all(
        user.id,
        conversationId,
        ...cursorArgs,
        pageSize + (after ? 0 : 1),
      ) as {
      id: string;
      clientId: string;
      body: string;
      createdAt: string;
      isMine: number;
      senderName: string;
    }[];
    if (after) return c.json({ items: rows, nextCursor: null, hasMore: false });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    return c.json({
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      hasMore,
    });
  });

  app.post("/api/conversations/:id/messages", async (c) => {
    const user = requireActiveUser(c);
    const conversationId = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "消息内容格式不正确");
    const clientId = requiredText(body.clientId, "消息标识", 8, 100);
    const message = requiredText(body.body, "消息", 1, 2000);
    const participants = db
      .query(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = ?",
      )
      .all(conversationId) as { user_id: string }[];
    const other = participants.find(
      (participant) => participant.user_id !== user.id,
    )?.user_id;
    if (
      !other ||
      !participants.some((participant) => participant.user_id === user.id)
    )
      throw new HttpError(404, "NOT_FOUND", "会话不存在");
    const blocked = db
      .query(
        `SELECT 1 FROM user_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      )
      .get(user.id, other, other, user.id);
    if (blocked)
      throw new HttpError(
        403,
        "USER_BLOCKED",
        "双方存在屏蔽关系，无法发送消息",
      );
    const existing = db
      .query("SELECT id FROM messages WHERE sender_id = ? AND client_id = ?")
      .get(user.id, clientId) as { id: string } | null;
    if (existing) return c.json({ id: existing.id, duplicate: true }, 200);
    const id = randomUUID();
    const now = nowIso();
    try {
      db.transaction(() => {
        db.query(
          "INSERT INTO messages (id, conversation_id, sender_id, client_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, conversationId, user.id, clientId, message, now);
        db.query(
          "UPDATE conversations SET last_message_at = ? WHERE id = ?",
        ).run(now, conversationId);
      })();
    } catch (error) {
      const duplicate = db
        .query("SELECT id FROM messages WHERE sender_id = ? AND client_id = ?")
        .get(user.id, clientId) as { id: string } | null;
      if (!duplicate) throw error;
      return c.json({ id: duplicate.id, duplicate: true }, 200);
    }
    addNotification(
      db,
      other,
      "message",
      "收到一条私信",
      "登录后查看你的站内消息。",
      `./account.html#messages`,
      `message/${id}`,
    );
    return c.json({ id, createdAt: now }, 201);
  });

  app.post("/api/messages/:id/report", async (c) => {
    const user = requireUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    const reason = requiredText(
      isRecord(body) ? body.reason : null,
      "举报原因",
      3,
      300,
    );
    const message = db
      .query(
        `SELECT m.*, c.id AS conversationId FROM messages m JOIN conversations c ON c.id = m.conversation_id
      JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
      WHERE m.id = ? AND m.deleted_at IS NULL`,
      )
      .get(user.id, c.req.param("id")) as {
      id: string;
      sender_id: string;
      created_at: string;
      conversationId: string;
      [key: string]: unknown;
    } | null;
    if (!message)
      throw new HttpError(404, "NOT_FOUND", "消息不存在或你无权查看");
    if (message.sender_id === user.id)
      throw new HttpError(400, "SELF_REPORT", "不能举报自己发送的消息");
    const id = randomUUID();
    try {
      db.query(
        "INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, 'message', ?, ?, 'open', ?)",
      ).run(id, user.id, c.req.param("id"), reason, nowIso());
    } catch {
      throw new HttpError(409, "DUPLICATE_REPORT", "你已举报过这条消息");
    }
    const before = db
      .query(
        `SELECT id, sender_id AS senderId, body, created_at AS createdAt FROM messages
      WHERE conversation_id = ? AND deleted_at IS NULL AND
      (created_at < ? OR (created_at = ? AND id <= ?)) ORDER BY created_at DESC, id DESC LIMIT 4`,
      )
      .all(
        message.conversationId,
        message.created_at,
        message.created_at,
        c.req.param("id"),
      );
    const after = db
      .query(
        `SELECT id, sender_id AS senderId, body, created_at AS createdAt FROM messages
      WHERE conversation_id = ? AND deleted_at IS NULL AND
      (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT 3`,
      )
      .all(
        message.conversationId,
        message.created_at,
        message.created_at,
        c.req.param("id"),
      );
    const context = [...before, ...after];
    db.query(
      "INSERT INTO moderation_evidence (report_id, target_type, target_id, snapshot_json, captured_at) VALUES (?, 'message', ?, ?, ?)",
    ).run(
      id,
      c.req.param("id"),
      JSON.stringify({ message, context }),
      nowIso(),
    );
    return c.json(
      { id, message: "消息举报已提交，必要上下文仅供案件审核使用。" },
      201,
    );
  });

  app.post("/api/conversations/:id/read", async (c) => {
    const user = requireUser(c);
    const conversationId = c.req.param("id");
    const participant = db
      .query(
        "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
      )
      .get(conversationId, user.id);
    if (!participant) throw new HttpError(404, "NOT_FOUND", "会话不存在");
    db.query(
      "UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?",
    ).run(nowIso(), conversationId, user.id);
    return c.json({ ok: true });
  });

  app.get("/api/me/blocks", (c) => {
    const user = requireUser(c);
    const items = db
      .query(
        "SELECT b.blocked_id AS userId, u.display_name AS displayName, b.created_at AS createdAt FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC",
      )
      .all(user.id);
    return c.json({ items });
  });

  app.post("/api/me/blocks/:userId", (c) => {
    const user = requireActiveUser(c);
    const blockedId = c.req.param("userId");
    if (blockedId === user.id)
      throw new HttpError(400, "INVALID_INPUT", "不能屏蔽自己");
    const exists = db
      .query("SELECT 1 FROM users WHERE id = ? AND account_status = 'active'")
      .get(blockedId);
    if (!exists) throw new HttpError(404, "NOT_FOUND", "账号不存在");
    db.query(
      "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    ).run(user.id, blockedId, nowIso());
    return c.json({ ok: true });
  });

  app.delete("/api/me/blocks/:userId", (c) => {
    const user = requireActiveUser(c);
    db.query(
      "DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?",
    ).run(user.id, c.req.param("userId"));
    return c.json({ ok: true });
  });

  app.post("/api/uploads", async (c) => {
    const user = requireActiveUser(c);
    consumeRateLimit(db, user.id, "image-upload", 12, 24 * 60 * 60 * 1000);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      throw new HttpError(400, "INVALID_FILE", "请选择一张图片");
    if (file.size < 1 || file.size > 4 * 1024 * 1024) {
      throw new HttpError(413, "FILE_TOO_LARGE", "单张图片不能超过 4 MB");
    }
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const extension = extensions[file.type];
    if (!extension)
      throw new HttpError(
        415,
        "UNSUPPORTED_FILE",
        "仅支持 JPG、PNG 或 WebP 图片",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isValidSignature =
      (extension === "png" &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47) ||
      (extension === "jpg" &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) ||
      (extension === "webp" &&
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
    if (!isValidSignature)
      throw new HttpError(415, "INVALID_FILE", "图片内容与文件类型不匹配");
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(resolve(uploadsDir, filename), bytes, { flag: "wx" });
    return c.json({ url: `/uploads/${filename}` }, 201);
  });

  app.get("/uploads/:filename", async (c) => {
    requireUser(c);
    const filename = c.req.param("filename");
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(filename)) {
      throw new HttpError(404, "NOT_FOUND", "文件不存在");
    }
    const filepath = resolve(uploadsDir, filename);
    const fileExtension = extname(filename);
    const types: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    try {
      const contents = await readFile(filepath);
      c.header("Content-Type", types[fileExtension]);
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      c.header("Content-Security-Policy", "default-src 'none'; img-src 'self'");
      return c.body(contents);
    } catch {
      throw new HttpError(404, "NOT_FOUND", "文件不存在");
    }
  });

  app.get("/api/admin/queue", (c) => {
    const moderator = requireModerator(c);
    const page = pagination(c);
    const queueSql = `SELECT * FROM (
      SELECT r.id, r.course_id AS targetId, c.code AS context, r.content, r.rating, NULL AS reason, 'review' AS targetType, r.created_at AS createdAt, 'review' AS type
        FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE r.status = 'pending'
      UNION ALL
      SELECT t.id, t.id AS targetId, t.topic AS context, t.content, NULL AS rating, NULL AS reason, 'tree-hole' AS targetType, t.created_at AS createdAt, 'tree-hole' AS type
        FROM tree_posts t WHERE t.status = 'pending'
      UNION ALL
      SELECT rp.id, rp.target_id AS targetId, NULL AS context,
        CASE rp.target_type WHEN 'tree-hole' THEN (SELECT content FROM tree_posts WHERE id = rp.target_id)
          WHEN 'review' THEN (SELECT content FROM course_reviews WHERE id = rp.target_id)
          WHEN 'listing' THEN (SELECT title || ' — ' || description FROM market_listings WHERE id = rp.target_id)
          WHEN 'skill' THEN (SELECT title || ' — ' || description FROM skill_posts WHERE id = rp.target_id)
          WHEN 'comment' THEN (SELECT content FROM content_comments WHERE id = rp.target_id)
          WHEN 'message' THEN (SELECT body FROM messages WHERE id = rp.target_id) END AS content,
        NULL AS rating, rp.reason, rp.target_type AS targetType, rp.created_at AS createdAt, 'report' AS type
        FROM reports rp WHERE rp.status = 'open'
      UNION ALL
      SELECT sc.id, sc.id AS targetId, rp.title || ' ↔ ' || op.title AS context,
        sc.scope AS content, NULL AS rating, NULL AS reason, 'skill-collaboration' AS targetType,
        sc.created_at AS createdAt, 'collaboration' AS type
        FROM skill_collaborations sc
        JOIN skill_posts rp ON rp.id = sc.request_post_id
        JOIN skill_posts op ON op.id = sc.offer_post_id
        WHERE sc.status = 'disputed'
    ) ORDER BY createdAt ASC, id ASC LIMIT ? OFFSET ?`;
    const items = db.query(queueSql).all(page.pageSize, page.offset) as {
      id: string;
      targetId: string;
      targetType: string;
      type: string;
    }[];
    const total = Number(
      (
        db
          .query(
            `SELECT
      (SELECT COUNT(*) FROM course_reviews WHERE status = 'pending') +
      (SELECT COUNT(*) FROM tree_posts WHERE status = 'pending') +
      (SELECT COUNT(*) FROM reports WHERE status = 'open') +
      (SELECT COUNT(*) FROM skill_collaborations WHERE status = 'disputed') AS count`,
          )
          .get() as { count: number }
      ).count,
    );
    for (const item of items) {
      if (item.type === "report" && item.targetType === "message") {
        db.query(
          "INSERT INTO moderation_audit (id, moderator_id, target_type, target_id, action, reason, created_at) VALUES (?, ?, 'message', ?, 'view-reported-message', 'moderation queue inspection', ?)",
        ).run(randomUUID(), moderator.id, item.targetId, nowIso());
      }
    }
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.post("/api/admin/reports/:id/action", async (c) => {
    const moderator = requireModerator(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "处置内容格式不正确");
    const action = String(body.action ?? "");
    if (!["dismiss", "hide", "remove", "warn", "mute", "ban"].includes(action))
      throw new HttpError(400, "INVALID_INPUT", "举报处置方式不正确");
    const reason = requiredText(body.reason, "处置原因", 3, 300);
    const report = db
      .query("SELECT * FROM reports WHERE id = ? AND status = 'open'")
      .get(c.req.param("id")) as {
      id: string;
      reporter_id: string;
      target_type: string;
      target_id: string;
    } | null;
    if (!report) throw new HttpError(404, "NOT_FOUND", "举报不存在或已处理");
    const table =
      report.target_type === "tree-hole"
        ? "tree_posts"
        : report.target_type === "review"
          ? "course_reviews"
          : report.target_type === "listing"
            ? "market_listings"
            : report.target_type === "skill"
              ? "skill_posts"
              : report.target_type === "message"
                ? "messages"
                : "content_comments";
    const ownerColumn =
      report.target_type === "listing"
        ? "seller_id"
        : report.target_type === "message"
          ? "sender_id"
          : "user_id";
    const target = db
      .query(`SELECT * FROM ${table} WHERE id = ?`)
      .get(report.target_id) as Record<string, unknown> | null;
    if (!target) throw new HttpError(404, "NOT_FOUND", "被举报内容已不存在");
    const ownerId =
      typeof target[ownerColumn] === "string"
        ? String(target[ownerColumn])
        : null;
    const caseId = randomUUID();
    const now = nowIso();
    const reportStatus = action === "dismiss" ? "dismissed" : "resolved";
    const caseStatus = action === "dismiss" ? "dismissed" : "actioned";
    const days =
      action === "mute"
        ? numberInRange(body.durationDays ?? 7, "禁言天数", 1, 30)
        : null;
    const endsAt = days
      ? new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
      : null;
    db.transaction(() => {
      const changed = db
        .query("UPDATE reports SET status = ? WHERE id = ? AND status = 'open'")
        .run(reportStatus, report.id);
      if (!changed.changes)
        throw new HttpError(409, "REPORT_ALREADY_HANDLED", "举报已处理");
      db.query(
        `INSERT INTO moderation_cases
        (id, target_type, target_id, reporter_id, assigned_moderator_id, status, action, reason, report_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        caseId,
        report.target_type,
        report.target_id,
        report.reporter_id,
        moderator.id,
        caseStatus,
        action,
        reason,
        report.id,
        now,
        now,
      );
      if (action === "hide") {
        if (report.target_type === "comment")
          db.query(
            "UPDATE content_comments SET status = 'hidden', updated_at = ? WHERE id = ? AND deleted_at IS NULL",
          ).run(now, report.target_id);
        else if (report.target_type === "message")
          db.query(
            "UPDATE messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
          ).run(now, report.target_id);
        else
          db.query(
            `UPDATE ${table} SET moderation_status = 'hidden' WHERE id = ? AND deleted_at IS NULL`,
          ).run(report.target_id);
      } else if (action === "remove") {
        if (report.target_type === "comment")
          db.query(
            "UPDATE content_comments SET status = 'removed', deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?",
          ).run(now, now, report.target_id);
        else if (report.target_type === "message")
          db.query(
            "UPDATE messages SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?",
          ).run(now, report.target_id);
        else
          db.query(
            `UPDATE ${table} SET moderation_status = 'removed', deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`,
          ).run(now, report.target_id);
      }
      if (["warn", "mute", "ban"].includes(action) && ownerId) {
        db.query(
          "INSERT INTO user_penalties (id, user_id, case_id, penalty_type, starts_at, ends_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          randomUUID(),
          ownerId,
          caseId,
          action === "warn" ? "warning" : action,
          now,
          endsAt,
          reason,
          now,
        );
        if (action === "mute")
          db.query(
            "UPDATE users SET account_status = 'suspended', suspended_until = ?, updated_at = ? WHERE id = ? AND account_status <> 'banned'",
          ).run(endsAt, now, ownerId);
        if (action === "ban") {
          db.query(
            "UPDATE users SET account_status = 'banned', suspended_until = NULL, updated_at = ? WHERE id = ?",
          ).run(now, ownerId);
          db.query("DELETE FROM sessions WHERE user_id = ?").run(ownerId);
          db.query("DELETE FROM auth_sessions WHERE userId = ?").run(ownerId);
        }
      }
      db.query(
        "INSERT INTO moderation_audit (id, moderator_id, target_type, target_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        randomUUID(),
        moderator.id,
        report.target_type,
        report.target_id,
        action,
        reason,
        now,
      );
      db.query(
        "UPDATE moderation_evidence SET expires_at = ? WHERE report_id = ?",
      ).run(
        new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString(),
        report.id,
      );
      if (ownerId && action !== "dismiss")
        addNotification(
          db,
          ownerId,
          "moderation-action",
          "社区内容处置已完成",
          `处置方式：${action}。可在个人中心查看并申请复核。`,
          "./account.html#appeals",
          `moderation/${caseId}`,
        );
      addNotification(
        db,
        report.reporter_id,
        "report-result",
        "举报已有处理结果",
        "登录后查看社区治理通知。",
        "./account.html#notifications",
        `report-result/${report.id}`,
      );
    })();
    return c.json({ ok: true, caseId, status: caseStatus, action });
  });

  app.post("/api/admin/collaborations/:id/resolve", async (c) => {
    const moderator = requireModerator(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || !["resume", "cancel"].includes(String(body.outcome)))
      throw new HttpError(400, "INVALID_INPUT", "争议处理方式不正确");
    const reason = requiredText(body.reason, "处理原因", 3, 300);
    const id = c.req.param("id");
    const row = db
      .query(
        "SELECT requester_id, provider_id FROM skill_collaborations WHERE id = ? AND status = 'disputed'",
      )
      .get(id) as { requester_id: string; provider_id: string } | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "找不到待处理的互助争议");
    const now = nowIso();
    const outcome = String(body.outcome);
    db.transaction(() => {
      const result = db
        .query(
          `UPDATE skill_collaborations
           SET status = ?, requester_completed_at = NULL, provider_completed_at = NULL,
               completed_at = NULL, updated_at = ?
           WHERE id = ? AND status = 'disputed'`,
        )
        .run(outcome === "resume" ? "active" : "cancelled", now, id);
      if (!result.changes)
        throw new HttpError(409, "ALREADY_HANDLED", "这条互助争议已被处理");
      db.query(
        `INSERT INTO moderation_audit
         (id, moderator_id, target_type, target_id, action, reason, created_at)
         VALUES (?, ?, 'skill-collaboration', ?, ?, ?, ?)`,
      ).run(randomUUID(), moderator.id, id, `dispute-${outcome}`, reason, now);
      const detail =
        outcome === "resume"
          ? "互助争议已处理，合作已恢复；双方需要重新确认完成。"
          : "互助争议已处理，合作已取消。";
      for (const userId of [row.requester_id, row.provider_id])
        addNotification(
          db,
          userId,
          "skill-collaboration-dispute",
          "互助争议处理完成",
          detail,
          "./account.html#collaborations",
          `collaboration-dispute/${id}/${outcome}/${userId}`,
        );
    })();
    return c.json({ ok: true, outcome });
  });

  app.get("/api/me/appeals", (c) => {
    const user = requireSessionUser(c);
    const page = pagination(c);
    const ownerPredicate = `CASE mc.target_type
      WHEN 'comment' THEN (SELECT user_id FROM content_comments WHERE id = mc.target_id)
      WHEN 'message' THEN (SELECT sender_id FROM messages WHERE id = mc.target_id)
      WHEN 'tree-hole' THEN (SELECT user_id FROM tree_posts WHERE id = mc.target_id)
      WHEN 'review' THEN (SELECT user_id FROM course_reviews WHERE id = mc.target_id)
      WHEN 'listing' THEN (SELECT seller_id FROM market_listings WHERE id = mc.target_id)
      WHEN 'skill' THEN (SELECT user_id FROM skill_posts WHERE id = mc.target_id) END = ?
      AND mc.status IN ('actioned', 'appealed', 'reinstated')`;
    const items = db
      .query(
        `SELECT mc.id, mc.target_type AS targetType, mc.target_id AS targetId,
      mc.status, mc.action, mc.reason, mc.appeal_reason AS appealReason, mc.appeal_outcome AS appealOutcome,
      mc.created_at AS createdAt, mc.updated_at AS updatedAt,
      CASE mc.target_type WHEN 'comment' THEN (SELECT content FROM content_comments WHERE id = mc.target_id)
        WHEN 'message' THEN (SELECT body FROM messages WHERE id = mc.target_id)
        WHEN 'tree-hole' THEN (SELECT content FROM tree_posts WHERE id = mc.target_id)
        WHEN 'review' THEN (SELECT content FROM course_reviews WHERE id = mc.target_id)
        WHEN 'listing' THEN (SELECT title || ' — ' || description FROM market_listings WHERE id = mc.target_id)
        WHEN 'skill' THEN (SELECT title || ' — ' || description FROM skill_posts WHERE id = mc.target_id) END AS content
      FROM moderation_cases mc WHERE ${ownerPredicate}
      ORDER BY mc.updated_at DESC, mc.id DESC LIMIT ? OFFSET ?`,
      )
      .all(user.id, page.pageSize, page.offset);
    const total = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS count FROM moderation_cases mc WHERE ${ownerPredicate}`,
          )
          .get(user.id) as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.post("/api/me/appeals", async (c) => {
    const user = requireSessionUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "申诉内容格式不正确");
    const caseId = requiredText(body.caseId, "治理记录", 1, 80);
    const appealReason = requiredText(body.reason, "申诉理由", 10, 1000);
    const row = db
      .query(
        `SELECT mc.id, mc.status, mc.report_id,
      CASE mc.target_type WHEN 'comment' THEN (SELECT user_id FROM content_comments WHERE id = mc.target_id)
        WHEN 'message' THEN (SELECT sender_id FROM messages WHERE id = mc.target_id)
        WHEN 'tree-hole' THEN (SELECT user_id FROM tree_posts WHERE id = mc.target_id)
        WHEN 'review' THEN (SELECT user_id FROM course_reviews WHERE id = mc.target_id)
        WHEN 'listing' THEN (SELECT seller_id FROM market_listings WHERE id = mc.target_id)
        WHEN 'skill' THEN (SELECT user_id FROM skill_posts WHERE id = mc.target_id) END AS ownerId
      FROM moderation_cases mc WHERE mc.id = ?`,
      )
      .get(caseId) as {
      id: string;
      status: string;
      report_id: string | null;
      ownerId: string | null;
    } | null;
    if (!row || row.ownerId !== user.id || row.status !== "actioned")
      throw new HttpError(404, "NOT_FOUND", "找不到可申诉的处置记录");
    if (row.report_id) {
      const evidence = db
        .query("SELECT expires_at FROM moderation_evidence WHERE report_id = ?")
        .get(row.report_id) as { expires_at: string | null } | null;
      if (evidence?.expires_at && evidence.expires_at < nowIso())
        throw new HttpError(
          410,
          "APPEAL_WINDOW_CLOSED",
          "该申诉记录已超过复核期限",
        );
    }
    db.query(
      "UPDATE moderation_cases SET status = 'appealed', appellant_id = ?, appeal_reason = ?, updated_at = ? WHERE id = ? AND status = 'actioned'",
    ).run(user.id, appealReason, nowIso(), caseId);
    return c.json(
      { ok: true, message: "申诉已提交，将由非原处理人复核。" },
      201,
    );
  });

  app.get("/api/admin/appeals", (c) => {
    requireModerator(c);
    const page = pagination(c);
    const items = db
      .query(
        `SELECT mc.id, mc.target_type AS targetType, mc.target_id AS targetId,
      mc.action, mc.reason, mc.appeal_reason AS appealReason, mc.assigned_moderator_id AS originalModeratorId,
      mc.appellant_id AS appellantId, u.display_name AS appellantName, mc.created_at AS createdAt,
      CASE mc.target_type WHEN 'comment' THEN (SELECT content FROM content_comments WHERE id = mc.target_id)
        WHEN 'message' THEN (SELECT body FROM messages WHERE id = mc.target_id)
        WHEN 'tree-hole' THEN (SELECT content FROM tree_posts WHERE id = mc.target_id)
        WHEN 'review' THEN (SELECT content FROM course_reviews WHERE id = mc.target_id)
        WHEN 'listing' THEN (SELECT title || ' — ' || description FROM market_listings WHERE id = mc.target_id)
        WHEN 'skill' THEN (SELECT title || ' — ' || description FROM skill_posts WHERE id = mc.target_id) END AS content
      FROM moderation_cases mc LEFT JOIN users u ON u.id = mc.appellant_id WHERE mc.status = 'appealed'
      ORDER BY mc.updated_at ASC, mc.id ASC LIMIT ? OFFSET ?`,
      )
      .all(page.pageSize, page.offset);
    const total = Number(
      (
        db
          .query(
            "SELECT COUNT(*) AS count FROM moderation_cases WHERE status = 'appealed'",
          )
          .get() as { count: number }
      ).count,
    );
    return c.json({ items, total, page: page.page, pageSize: page.pageSize });
  });

  app.patch("/api/admin/appeals/:id", async (c) => {
    const reviewer = requireModerator(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      !["restore", "uphold"].includes(String(body.outcome))
    )
      throw new HttpError(400, "INVALID_INPUT", "复核结果不正确");
    const reason = requiredText(body.reason, "复核理由", 3, 300);
    const caseId = c.req.param("id");
    const row = db
      .query(
        "SELECT * FROM moderation_cases WHERE id = ? AND status = 'appealed'",
      )
      .get(caseId) as {
      target_type: string;
      target_id: string;
      assigned_moderator_id: string | null;
      appellant_id: string | null;
    } | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "申诉记录不存在或已复核");
    if (row.assigned_moderator_id === reviewer.id)
      throw new HttpError(403, "ORIGINAL_REVIEWER", "原处理人不能复核这条申诉");
    const outcome = String(body.outcome);
    const now = nowIso();
    const table =
      row.target_type === "comment"
        ? "content_comments"
        : row.target_type === "message"
          ? "messages"
          : row.target_type === "tree-hole"
            ? "tree_posts"
            : row.target_type === "review"
              ? "course_reviews"
              : row.target_type === "listing"
                ? "market_listings"
                : "skill_posts";
    db.transaction(() => {
      if (outcome === "restore") {
        if (row.target_type === "comment")
          db.query(
            "UPDATE content_comments SET status = 'visible', updated_at = ? WHERE id = ? AND deleted_at IS NULL AND status = 'hidden'",
          ).run(now, row.target_id);
        else if (row.target_type === "message")
          db.query(
            "UPDATE messages SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL",
          ).run(row.target_id);
        else
          db.query(
            `UPDATE ${table} SET moderation_status = 'visible' WHERE id = ? AND deleted_at IS NULL AND moderation_status = 'hidden'`,
          ).run(row.target_id);
        db.query(
          "UPDATE user_penalties SET revoked_at = ? WHERE case_id = ? AND revoked_at IS NULL",
        ).run(now, caseId);
        if (row.appellant_id) {
          const active = db
            .query(
              "SELECT penalty_type FROM user_penalties WHERE user_id = ? AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at > ?) ORDER BY CASE penalty_type WHEN 'ban' THEN 3 WHEN 'mute' THEN 2 ELSE 1 END DESC LIMIT 1",
            )
            .get(row.appellant_id, now) as { penalty_type: string } | null;
          const status =
            active?.penalty_type === "ban"
              ? "banned"
              : active?.penalty_type === "mute"
                ? "suspended"
                : "active";
          const suspendedUntil =
            status === "suspended"
              ? (
                  db
                    .query(
                      "SELECT MAX(ends_at) AS endsAt FROM user_penalties WHERE user_id = ? AND penalty_type = 'mute' AND revoked_at IS NULL AND ends_at > ?",
                    )
                    .get(row.appellant_id, now) as { endsAt: string | null }
                ).endsAt
              : null;
          db.query(
            "UPDATE users SET account_status = ?, suspended_until = ?, updated_at = ? WHERE id = ?",
          ).run(status, suspendedUntil, now, row.appellant_id);
        }
      }
      db.query(
        "UPDATE moderation_cases SET status = ?, appeal_reviewer_id = ?, appeal_outcome = ?, updated_at = ? WHERE id = ? AND status = 'appealed'",
      ).run(
        outcome === "restore" ? "reinstated" : "actioned",
        reviewer.id,
        `${outcome}: ${reason}`,
        now,
        caseId,
      );
      db.query(
        "INSERT INTO moderation_audit (id, moderator_id, target_type, target_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        randomUUID(),
        reviewer.id,
        row.target_type,
        row.target_id,
        `appeal-${outcome}`,
        reason,
        now,
      );
      if (row.appellant_id)
        addNotification(
          db,
          row.appellant_id,
          "appeal-result",
          outcome === "restore" ? "申诉通过，处置已复核" : "申诉复核已完成",
          "登录后查看申诉结果。",
          "./account.html#appeals",
          `appeal-result/${caseId}`,
        );
    })();
    return c.json({ ok: true, outcome });
  });

  app.patch("/api/admin/:type/:id", async (c) => {
    const moderator = requireModerator(c);
    const type = c.req.param("type");
    const id = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const reason = optionalText(body.reason, 300);
    const createdAt = nowIso();
    let action = "";
    if (type === "reviews" || type === "tree-hole") {
      if (!["approved", "rejected"].includes(String(body.status))) {
        throw new HttpError(400, "INVALID_INPUT", "审核状态不正确");
      }
      const table = type === "reviews" ? "course_reviews" : "tree_posts";
      const moderationStatus = String(body.status);
      const result = db
        .query(
          `UPDATE ${table} SET status = ?, moderation_status = ? WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`,
        )
        .run(
          moderationStatus,
          moderationStatus === "approved" ? "visible" : "removed",
          id,
        );
      if (result.changes === 0)
        throw new HttpError(404, "NOT_FOUND", "内容不存在或已处理");
      action = moderationStatus;
    } else {
      throw new HttpError(404, "NOT_FOUND", "审核类型不存在");
    }
    db.query(
      `INSERT INTO moderation_audit (id, moderator_id, target_type, target_id, action, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), moderator.id, type, id, action, reason, createdAt);
    return c.json({ ok: true });
  });

  app.all("/api/auth/*", async (c) => {
    const auth = c.get("auth");
    if (
      c.req.method === "POST" &&
      c.req.path === "/api/auth/sign-in/email-otp"
    ) {
      const body: unknown = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      const email =
        isRecord(body) && typeof body.email === "string"
          ? normalizeCampusEmail(body.email)
          : null;
      if (email) {
        const deleting = db
          .query(
            "SELECT 1 FROM users WHERE email = ? AND account_status = 'deleting'",
          )
          .get(email);
        if (deleting)
          throw new HttpError(
            410,
            "ACCOUNT_DELETION_PENDING",
            "该账号正在注销流程中，30 天清理完成后可重新注册。",
          );
      }
    }
    if (
      c.req.method === "POST" &&
      c.req.path === "/api/auth/email-otp/send-verification-otp"
    ) {
      const body: unknown = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      const email =
        isRecord(body) && typeof body.email === "string"
          ? normalizeCampusEmail(body.email)
          : null;
      if (!email)
        throw new HttpError(
          400,
          "CAMPUS_EMAIL_REQUIRED",
          "仅支持 @stu.suat-sz.edu.cn、@suat-sz.edu.cn 校园邮箱",
        );
      const deleting = db
        .query(
          "SELECT 1 FROM users WHERE email = ? AND account_status = 'deleting'",
        )
        .get(email);
      if (deleting)
        throw new HttpError(
          410,
          "ACCOUNT_DELETION_PENDING",
          "该账号正在注销流程中，30 天清理完成后可重新注册。",
        );
      const emailHash = createHash("sha256").update(email).digest("hex");
      const now = Math.floor(Date.now() / 1000);
      const claimed = db
        .query(
          `INSERT INTO auth_email_cooldowns (email_hash, last_sent_at) VALUES (?, ?)
        ON CONFLICT(email_hash) DO UPDATE SET last_sent_at = excluded.last_sent_at
        WHERE auth_email_cooldowns.last_sent_at <= ?`,
        )
        .run(emailHash, now, now - 60);
      if (!claimed.changes)
        throw new HttpError(
          429,
          "OTP_COOLDOWN",
          "请等待 60 秒后再申请新的验证码",
        );
      const normalizedRequest = new Request(c.req.raw, {
        body: JSON.stringify({ ...(isRecord(body) ? body : {}), email }),
      });
      const response = await auth.handler(normalizedRequest);
      if (!response.ok)
        db.query(
          "DELETE FROM auth_email_cooldowns WHERE email_hash = ? AND last_sent_at = ?",
        ).run(emailHash, now);
      return response;
    }
    if (
      c.req.method === "POST" &&
      [
        "/api/auth/email-otp/request-email-change",
        "/api/auth/email-otp/change-email",
      ].includes(c.req.path)
    ) {
      const body: unknown = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      const newEmail =
        isRecord(body) && typeof body.newEmail === "string"
          ? normalizeCampusEmail(body.newEmail)
          : null;
      if (!newEmail)
        throw new HttpError(
          400,
          "CAMPUS_EMAIL_REQUIRED",
          "新邮箱仅支持 @stu.suat-sz.edu.cn、@suat-sz.edu.cn",
        );
    }
    return auth.handler(c.req.raw);
  });
  return app;
}
