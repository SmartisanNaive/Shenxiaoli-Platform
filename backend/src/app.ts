import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppDatabase } from "./db";

export interface User {
  id: string;
  displayName: string;
  department: string;
  role: "student" | "moderator";
}

interface AppConfig {
  database: AppDatabase;
  demoAuthEnabled?: boolean;
  production?: boolean;
  sessionSecret?: string;
  allowedOrigins?: string[];
  uploadsDir?: string;
}

interface Variables {
  user: User | null;
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

function requireUser(c: RouteContext): User {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "AUTH_REQUIRED", "请先登录后再操作");
  return user;
}

function requireModerator(c: RouteContext): User {
  const user = requireUser(c);
  if (user.role !== "moderator") {
    throw new HttpError(403, "MODERATOR_REQUIRED", "此操作仅限内容管理员");
  }
  return user;
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
    path: "/api",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function readUser(db: AppDatabase, userId: string): User | null {
  const row = db
    .query("SELECT id, display_name, department, role FROM users WHERE id = ?")
    .get(userId) as {
    id: string;
    display_name: string;
    department: string;
    role: User["role"];
  } | null;
  return row
    ? {
        id: row.id,
        displayName: row.display_name,
        department: row.department,
        role: row.role,
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
  if (target.owner_id === user.id) {
    throw new HttpError(400, "SELF_CONTACT", "不能联系自己发布的内容");
  }
  const id = randomUUID();
  db.query(
    `INSERT INTO contact_requests
     (id, target_type, target_id, sender_id, recipient_id, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, targetType, targetId, user.id, target.owner_id, message, nowIso());
  return id;
}

export function createApp(config: AppConfig): Hono<AppContext> {
  const { database: db } = config;
  const production = config.production ?? process.env.NODE_ENV === "production";
  const demoAuthEnabled = Boolean(config.demoAuthEnabled) && !production;
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

  const app = new Hono<AppContext>();

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const origin = c.req.header("origin");
      if (origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(origin).origin === new URL(c.req.url).origin;
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

  app.get("/api/health", (c) =>
    c.json({ status: "ok", service: "shenxiaoli-api" }),
  );

  app.get("/api/session", (c) => {
    const user = c.get("user");
    return c.json({
      authenticated: Boolean(user),
      user,
      demoAuthAvailable: demoAuthEnabled,
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
    return c.json({ ok: true });
  });

  app.get("/api/home", (c) => {
    const user = c.get("user");
    const counts = {
      courses: Number(
        (
          db.query("SELECT COUNT(*) AS count FROM courses").get() as {
            count: number;
          } | null
        )?.count ?? 0,
      ),
      listings: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM market_listings WHERE status = 'active'",
            )
            .get() as { count: number } | null
        )?.count ?? 0,
      ),
      skills: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM skill_posts WHERE status = 'active'",
            )
            .get() as { count: number } | null
        )?.count ?? 0,
      ),
      treePosts: Number(
        (
          db
            .query(
              "SELECT COUNT(*) AS count FROM tree_posts WHERE status = 'approved'",
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
         GROUP BY c.id ORDER BY rating DESC, review_count DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const listings = db
      .query(
        `SELECT l.*, '匿名同学' AS seller_name FROM market_listings l
         WHERE l.status = 'active' ORDER BY l.created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const skills = db
      .query(
        `SELECT * FROM skill_posts WHERE status = 'active'
         ORDER BY created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    const posts = db
      .query(
        `SELECT id, content, topic, created_at FROM tree_posts
         WHERE status = 'approved' ORDER BY created_at DESC LIMIT 3`,
      )
      .all() as Record<string, unknown>[];
    return c.json({
      counts,
      featuredCourses: courses,
      latestListings: listings.map((row) => mapListing(row, user?.id)),
      latestSkills: skills.map((row) => mapSkill(row, user?.id)),
      latestTreePosts: posts.map((row) => ({ ...row, author: "匿名狸友" })),
      demoData: demoAuthEnabled,
    });
  });

  app.get("/api/search", (c) => {
    const query = optionalText(c.req.query("q"), 120).slice(0, 120);
    if (!query) return c.json({ query, results: [] });
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const courses = db
      .query(
        `SELECT id, code AS identifier, title, department AS detail, 'course' AS type
         FROM courses WHERE code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
           OR english_title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\' LIMIT 5`,
      )
      .all(like, like, like, like) as Record<string, unknown>[];
    const listings = db
      .query(
        `SELECT id, '' AS identifier, title, category AS detail, 'listing' AS type
         FROM market_listings WHERE status = 'active' AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') LIMIT 5`,
      )
      .all(like, like) as Record<string, unknown>[];
    const skills = db
      .query(
        `SELECT id, '' AS identifier, title, category AS detail, 'skill' AS type
         FROM skill_posts WHERE status = 'active' AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') LIMIT 5`,
      )
      .all(like, like) as Record<string, unknown>[];
    const treePosts = db
      .query(
        `SELECT id, '' AS identifier, substr(content, 1, 80) AS title,
           topic AS detail, 'tree-hole' AS type
         FROM tree_posts WHERE status = 'approved' AND content LIKE ? ESCAPE '\\' LIMIT 5`,
      )
      .all(like) as Record<string, unknown>[];
    return c.json({
      query,
      results: [...courses, ...listings, ...skills, ...treePosts].slice(0, 12),
    });
  });

  app.get("/api/courses", (c) => {
    const query = optionalText(c.req.query("q"), 120);
    const department = optionalText(c.req.query("department"), 80);
    const courseType = optionalText(c.req.query("courseType"), 40);
    const enrollmentType = optionalText(c.req.query("enrollmentType"), 40);
    const term = optionalText(c.req.query("term"), 40);
    const assessment = optionalText(c.req.query("assessment"), 40);
    const where = ["1 = 1"];
    const args: (string | number)[] = [];
    if (query) {
      where.push(
        "(c.code LIKE ? OR c.title LIKE ? OR c.english_title LIKE ? OR c.department LIKE ?)",
      );
      const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(escaped, escaped, escaped, escaped);
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
         WHERE ${where.join(" AND ")}
         GROUP BY c.id ORDER BY rating DESC, c.code ASC LIMIT 100`,
      )
      .all(...args) as Record<string, unknown>[];
    return c.json({ items: rows, total: rows.length });
  });

  app.get("/api/courses/:id/reviews", (c) => {
    const courseId = c.req.param("id");
    const course = db
      .query("SELECT id FROM courses WHERE id = ? OR code = ?")
      .get(courseId, courseId);
    if (!course) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    const items = db
      .query(
        `SELECT id, author_label AS author, rating, difficulty, workload,
           content, tags_json AS tagsJson, term, created_at AS createdAt
         FROM course_reviews WHERE course_id = ? AND status = 'approved'
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all((course as { id: string }).id) as Record<string, unknown>[];
    return c.json({
      items: items.map((item) => ({
        ...item,
        tags: parseJsonArray(String(item.tagsJson)),
      })),
    });
  });

  app.post("/api/courses/:id/reviews", async (c) => {
    const user = requireUser(c);
    consumeRateLimit(db, user.id, "course-review", 3, 24 * 60 * 60 * 1000);
    const courseId = c.req.param("id");
    const course = db
      .query("SELECT id FROM courses WHERE id = ? OR code = ?")
      .get(courseId, courseId) as { id: string } | null;
    if (!course) throw new HttpError(404, "NOT_FOUND", "课程不存在");
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const rating = numberInRange(body.rating, "评分", 1, 10);
    const difficulty = numberInRange(body.difficulty, "难度", 1, 5);
    const workload = numberInRange(body.workload, "作业量", 1, 5);
    const content = requiredText(body.content, "评价内容", 10, 1200);
    const term = requiredText(body.term, "学期", 3, 40);
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
       (id, course_id, user_id, author_label, rating, difficulty, workload, content, tags_json, term, status, created_at)
       VALUES (?, ?, ?, '匿名同学', ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      course.id,
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
      { id, status: "pending", message: "评价已提交，审核通过后会公开展示。" },
      201,
    );
  });

  app.get("/api/market/listings", (c) => {
    const user = c.get("user");
    const category = optionalText(c.req.query("category"), 50);
    const query = optionalText(c.req.query("q"), 120);
    const where = ["l.status = 'active'"];
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
         WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC LIMIT 60`,
      )
      .all(...args) as Record<string, unknown>[];
    return c.json({
      items: rows.map((row) => mapListing(row, user?.id)),
      total: rows.length,
    });
  });

  app.post("/api/market/listings", async (c) => {
    const user = requireUser(c);
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
    const user = requireUser(c);
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
    const user = requireUser(c);
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
    return c.json(
      { id, message: "联系请求已发送，当前版本暂不提供站内私信。" },
      201,
    );
  });

  app.get("/api/skills", (c) => {
    const user = c.get("user");
    const kind = c.req.query("kind");
    const category = optionalText(c.req.query("category"), 50);
    const where = ["status = 'active'"];
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
        `SELECT * FROM skill_posts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 80`,
      )
      .all(...args) as Record<string, unknown>[];
    return c.json({
      items: rows.map((row) => mapSkill(row, user?.id)),
      total: rows.length,
    });
  });

  app.post("/api/skills", async (c) => {
    const user = requireUser(c);
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

  app.post("/api/skills/:id/contact", async (c) => {
    const user = requireUser(c);
    consumeRateLimit(db, user.id, "contact-request", 20, 24 * 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => ({}));
    const message = optionalText(
      isRecord(body) ? body.message : undefined,
      240,
    );
    const id = addContactRequest(db, user, "skill", c.req.param("id"), message);
    return c.json(
      { id, message: "互助联系请求已发送，当前版本暂不提供站内私信。" },
      201,
    );
  });

  app.get("/api/tree-hole", (c) => {
    const user = c.get("user");
    const topic = optionalText(c.req.query("topic"), 40);
    const sort = c.req.query("sort") === "popular" ? "popular" : "recent";
    const limit = clampInt(c.req.query("limit"), 20, 50);
    const offset = Number.isInteger(Number(c.req.query("offset")))
      ? Math.max(0, Number(c.req.query("offset")))
      : 0;
    const where = ["p.status = 'approved'"];
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
      items: rows.map((row) => ({ ...row, author: "匿名狸友" })),
      total,
      hasMore: offset + rows.length < total,
    });
  });

  app.post("/api/tree-hole", async (c) => {
    const user = requireUser(c);
    consumeRateLimit(db, user.id, "tree-post", 5, 60 * 60 * 1000);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body))
      throw new HttpError(400, "INVALID_INPUT", "请求内容格式不正确");
    const content = requiredText(body.content, "树洞内容", 5, 1000);
    const topic = optionalText(body.topic, 40, "校园生活");
    const id = randomUUID();
    db.query(
      `INSERT INTO tree_posts (id, user_id, content, topic, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(id, user.id, content, topic, nowIso());
    return c.json(
      {
        id,
        status: "pending",
        message: "内容已进入审核队列，通过后会以匿名方式公开。",
      },
      201,
    );
  });

  app.post("/api/tree-hole/:id/feel", (c) => {
    const user = requireUser(c);
    const postId = c.req.param("id");
    const exists = db
      .query("SELECT id FROM tree_posts WHERE id = ? AND status = 'approved'")
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
      !["tree-hole", "review", "listing", "skill"].includes(
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
            : "skill_posts";
    if (!db.query(`SELECT id FROM ${table} WHERE id = ?`).get(targetId)) {
      throw new HttpError(404, "NOT_FOUND", "举报对象不存在");
    }
    const id = randomUUID();
    try {
      db.query(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      ).run(id, user.id, targetType, targetId, reason, nowIso());
    } catch {
      throw new HttpError(409, "DUPLICATE_REPORT", "你已举报过此内容");
    }
    return c.json({ id, message: "举报已提交，感谢协助维护社区环境。" }, 201);
  });

  app.get("/api/me/contact-requests", (c) => {
    const user = requireUser(c);
    const items = db
      .query(
        `SELECT id, target_type AS targetType, target_id AS targetId,
           message, status, created_at AS createdAt,
           CASE WHEN recipient_id = ? THEN 'received' ELSE 'sent' END AS direction
         FROM contact_requests WHERE sender_id = ? OR recipient_id = ?
         ORDER BY created_at DESC LIMIT 100`,
      )
      .all(user.id, user.id, user.id);
    return c.json({ items });
  });

  app.patch("/api/me/contact-requests/:id", async (c) => {
    const user = requireUser(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      !["accepted", "declined"].includes(String(body.status))
    ) {
      throw new HttpError(400, "INVALID_INPUT", "联系请求状态不正确");
    }
    const requestStatus = String(body.status);
    const result = db
      .query(
        "UPDATE contact_requests SET status = ? WHERE id = ? AND recipient_id = ? AND status = 'pending'",
      )
      .run(requestStatus, c.req.param("id"), user.id);
    if (result.changes === 0)
      throw new HttpError(404, "NOT_FOUND", "找不到待处理的联系请求");
    return c.json({ ok: true });
  });

  app.post("/api/uploads", async (c) => {
    const user = requireUser(c);
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
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      c.header("Content-Security-Policy", "default-src 'none'; img-src 'self'");
      return c.body(contents);
    } catch {
      throw new HttpError(404, "NOT_FOUND", "文件不存在");
    }
  });

  app.get("/api/admin/queue", (c) => {
    requireModerator(c);
    const reviews = db
      .query(
        `SELECT r.id, r.course_id AS targetId, c.code AS context,
           r.content, r.rating, r.created_at AS createdAt, 'review' AS type
         FROM course_reviews r JOIN courses c ON c.id = r.course_id
         WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 100`,
      )
      .all();
    const posts = db
      .query(
        `SELECT id, content, topic AS context, created_at AS createdAt, 'tree-hole' AS type
         FROM tree_posts WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`,
      )
      .all();
    const reports = db
      .query(
        `SELECT id, target_type AS targetType, target_id AS targetId,
           reason,
           CASE target_type
             WHEN 'tree-hole' THEN (SELECT content FROM tree_posts WHERE id = target_id)
             WHEN 'review' THEN (SELECT content FROM course_reviews WHERE id = target_id)
             WHEN 'listing' THEN (SELECT title || ' — ' || description FROM market_listings WHERE id = target_id)
             WHEN 'skill' THEN (SELECT title || ' — ' || description FROM skill_posts WHERE id = target_id)
           END AS content,
           created_at AS createdAt, 'report' AS type
         FROM reports WHERE status = 'open' ORDER BY created_at ASC LIMIT 100`,
      )
      .all();
    return c.json({ items: [...reviews, ...posts, ...reports] });
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
          `UPDATE ${table} SET status = ? WHERE id = ? AND status = 'pending'`,
        )
        .run(moderationStatus, id);
      if (result.changes === 0)
        throw new HttpError(404, "NOT_FOUND", "内容不存在或已处理");
      action = moderationStatus;
    } else if (type === "reports") {
      if (!["resolved", "dismissed"].includes(String(body.status))) {
        throw new HttpError(400, "INVALID_INPUT", "举报处理状态不正确");
      }
      const reportStatus = String(body.status);
      const result = db
        .query("UPDATE reports SET status = ? WHERE id = ? AND status = 'open'")
        .run(reportStatus, id);
      if (result.changes === 0)
        throw new HttpError(404, "NOT_FOUND", "举报不存在或已处理");
      action = reportStatus;
    } else {
      throw new HttpError(404, "NOT_FOUND", "审核类型不存在");
    }
    db.query(
      `INSERT INTO moderation_audit (id, moderator_id, target_type, target_id, action, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), moderator.id, type, id, action, reason, createdAt);
    return c.json({ ok: true });
  });

  return app;
}
