import { createHash, createHmac, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { User } from "./app";
import type { AppDatabase } from "./db";
import {
  AcademicError,
  isObject,
  SuatAcademicClient,
  textValue,
  type AcademicClient,
  type AcademicConfig,
  type AcademicCourse,
  type Semester,
} from "./academic-client";

type Env = { Variables: { user: User | null } };
type ImportState = "login" | "second-factor" | "authenticated" | "preview";
interface Session {
  id: string;
  userId: string;
  client: AcademicClient;
  state: ImportState;
  config: AcademicConfig;
  expiresAt: number;
  busy: boolean;
  cancelled: boolean;
  semesters: Semester[];
  nextSendAt: number;
  preview: { id: string; semester: Semester; courses: AcademicCourse[] } | null;
}
interface Candidate {
  id: string;
  code: string;
  title: string;
  active: number;
}
const TTL = 180_000;
const cleanTitle = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim();
function requireUser(c: Context<Env>): User {
  const user = c.get("user");
  if (!user) throw new AcademicError("AUTH_REQUIRED", "请先登录深小狸", 401);
  if (user.accountStatus && user.accountStatus !== "active")
    throw new AcademicError(
      "ACCOUNT_RESTRICTED",
      "当前账号暂时无法导入课程",
      403,
    );
  return user;
}
const inputText = (value: unknown, max = 100) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AcademicError("INVALID_INPUT", "输入内容格式不正确");
  return value.trim();
};
async function input(c: Context<Env>): Promise<Record<string, unknown>> {
  if (Number(c.req.header("content-length") || 0) > 32000)
    throw new AcademicError("INVALID_INPUT", "请求内容过长", 413);
  const body: unknown = await c.req.json().catch(() => null);
  if (!isObject(body) || JSON.stringify(body).length > 32000)
    throw new AcademicError("INVALID_INPUT", "请求内容格式不正确");
  return body;
}

export function createCourseImports(options: {
  db: AppDatabase;
  secret: string;
  factory?: () => AcademicClient;
  rateLimit: (
    userId: string,
    action: string,
    limit: number,
    windowMs: number,
  ) => void;
  now?: () => number;
}) {
  const { db } = options;
  const now = options.now || Date.now;
  const sessions = new Map<string, Session>();
  const dispose = (session: Session) => {
    session.cancelled = true;
    session.client.dispose();
    session.preview = null;
    sessions.delete(session.id);
  };
  const clear = (userId?: string) => {
    for (const s of sessions.values())
      if (!userId || s.userId === userId) dispose(s);
  };
  const cleanup = () => {
    for (const s of sessions.values()) if (s.expiresAt <= now()) dispose(s);
  };
  const timer = setInterval(cleanup, 30000);
  timer.unref();
  const assertLive = (s: Session) => {
    if (s.cancelled || s.expiresAt <= now()) {
      dispose(s);
      throw new AcademicError(
        "IMPORT_EXPIRED",
        "教务导入会话已过期，请重新登录",
        410,
      );
    }
  };
  const publicState = (s: Session) => ({
    id: s.id,
    state: s.state,
    config: s.config,
    expiresAt: s.expiresAt,
    nextSendAt: s.nextSendAt,
    semesters: s.semesters,
    defaultSemesterId:
      s.semesters.find((v) => v.current)?.id || s.semesters[0]?.id,
  });
  const get = (c: Context<Env>) => {
    cleanup();
    const user = requireUser(c),
      s = sessions.get(c.req.param("id") || "");
    if (!s || s.userId !== user.id)
      throw new AcademicError(
        "IMPORT_EXPIRED",
        "教务导入会话不存在或已过期，请重新登录",
        410,
      );
    assertLive(s);
    return s;
  };
  const run = async <T>(s: Session, fn: () => Promise<T>): Promise<T> => {
    if (s.busy)
      throw new AcademicError(
        "IMPORT_BUSY",
        "上一步操作正在处理中，请稍候",
        409,
      );
    s.busy = true;
    s.expiresAt = now() + TTL;
    try {
      const value = await fn();
      assertLive(s);
      s.expiresAt = now() + TTL;
      return value;
    } finally {
      s.busy = false;
    }
  };
  const requireState = (s: Session, states: ImportState[]) => {
    if (!states.includes(s.state))
      throw new AcademicError(
        "INVALID_IMPORT_STATE",
        "请先完成当前教务验证步骤",
        409,
      );
  };
  const candidates = (course: AcademicCourse) =>
    db
      .query(
        "SELECT id, code, title, active FROM courses WHERE title = ? AND (? = '' OR code_pending = 1) ORDER BY code LIMIT 100",
      )
      .all(cleanTitle(course.title), course.courseCode) as Candidate[];
  const source = (key: string) =>
    db
      .query(
        "SELECT course_id AS courseId, offering_id AS offeringId FROM academic_course_sources WHERE source_key = ?",
      )
      .get(key) as { courseId: string; offeringId: string } | null;
  const byCode = (code: string) =>
    code
      ? (db
          .query("SELECT id, code, title, active FROM courses WHERE code = ?")
          .get(code) as Candidate | null)
      : null;

  const router = new Hono<Env>();
  router.onError((error, c) => {
    if (error instanceof AcademicError) {
      if (error.status >= 500)
        console.warn(
          `[course-import] ${c.req.method} ${c.req.routePath} ${error.code}: ${error.message}`,
        );
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    throw error;
  });
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  router.post("/course-imports", async (c) => {
    const user = requireUser(c);
    cleanup();
    options.rateLimit(user.id, "academic-start", 20, 3600000);
    clear(user.id);
    if (sessions.size >= 100)
      throw new AcademicError(
        "IMPORT_CAPACITY",
        "当前导入人数较多，请稍后重试",
        503,
      );
    const client = (options.factory || (() => new SuatAcademicClient()))();
    const s: Session = {
      id: randomUUID(),
      userId: user.id,
      client,
      config: {
        passwordEnabled: false,
        smsEnabled: false,
        captchaStyle: null,
        smsInterval: 60,
      },
      state: "login",
      expiresAt: now() + TTL,
      busy: false,
      cancelled: false,
      semesters: [],
      nextSendAt: 0,
      preview: null,
    };
    sessions.set(s.id, s);
    try {
      await run(s, async () => {
        s.config = await client.initialize();
      });
    } catch (error) {
      dispose(s);
      throw error;
    }
    return c.json(publicState(s), 201);
  });
  router.get("/course-imports/:id", (c) => {
    const s = get(c);
    s.expiresAt = now() + TTL;
    return c.json(publicState(s));
  });
  router.delete("/course-imports/:id", (c) => {
    const s = get(c);
    dispose(s);
    return c.json({ ok: true });
  });
  router.post("/course-imports/:id/captcha", async (c) => {
    const s = get(c);
    requireState(s, ["login"]);
    options.rateLimit(s.userId, "academic-captcha", 60, 3600000);
    return c.json(await run(s, () => s.client.captcha()));
  });
  router.post("/course-imports/:id/captcha/verify", async (c) => {
    const s = get(c);
    requireState(s, ["login"]);
    const body = await input(c);
    if (
      !Array.isArray(body.points) ||
      !body.points.length ||
      body.points.length > 10 ||
      body.points.some(
        (p) =>
          !isObject(p) ||
          typeof p.x !== "number" ||
          typeof p.y !== "number" ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.x > 310 ||
          p.y < 0 ||
          p.y > 155,
      )
    )
      throw new AcademicError("INVALID_INPUT", "人机验证坐标不正确");
    options.rateLimit(s.userId, "academic-captcha-verify", 60, 3600000);
    await run(s, () =>
      s.client.verifyCaptcha(body.points as { x: number; y: number }[]),
    );
    return c.json({ ok: true });
  });
  const send = async (
    s: Session,
    subject: string,
    action: () => Promise<void>,
  ) => {
    const timestamp = now();
    const key = createHmac("sha256", options.secret)
      .update(`academic-sms:${subject}`)
      .digest("hex");
    options.rateLimit(s.userId, "academic-sms", 10, 3600000);
    const interval = s.config.smsInterval * 1000;
    db.transaction(() => {
      const old = db
        .query(
          "SELECT last_sent_at AS lastSentAt, window_start AS windowStart, count FROM academic_sms_limits WHERE subject_hash = ?",
        )
        .get(key) as {
        lastSentAt: number;
        windowStart: number;
        count: number;
      } | null;
      const start = Math.floor(timestamp / 3600000) * 3600000;
      if (
        old &&
        (timestamp - old.lastSentAt < interval ||
          (old.windowStart === start && old.count >= 5))
      ) {
        s.nextSendAt = Math.max(
          old.lastSentAt + interval,
          old.windowStart === start && old.count >= 5 ? start + 3600000 : 0,
        );
        throw new AcademicError(
          "SMS_RATE_LIMITED",
          "验证码发送过于频繁，请等待倒计时结束后重试",
          429,
        );
      }
      db.query(
        `INSERT INTO academic_sms_limits VALUES (?, ?, ?, 1) ON CONFLICT(subject_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at, window_start=excluded.window_start, count=CASE WHEN academic_sms_limits.window_start=excluded.window_start THEN academic_sms_limits.count+1 ELSE 1 END`,
      ).run(key, timestamp, start);
      db.query("DELETE FROM academic_sms_limits WHERE last_sent_at < ?").run(
        timestamp - 86400000,
      );
    })();
    s.nextSendAt = timestamp + interval;
    await action();
  };
  router.post("/course-imports/:id/sms", async (c) => {
    const s = get(c);
    requireState(s, ["login"]);
    const body = await input(c);
    const mobile = inputText(body.mobile, 11);
    if (!/^1[3-9]\d{9}$/.test(mobile))
      throw new AcademicError("INVALID_INPUT", "请输入学校绑定的十一位手机号");
    await run(s, () => send(s, mobile, () => s.client.sendSms(mobile)));
    return c.json(publicState(s));
  });
  router.post("/course-imports/:id/login", async (c) => {
    const s = get(c);
    requireState(s, ["login"]);
    const body = await input(c);
    if (body.method !== "password" && body.method !== "sms")
      throw new AcademicError("INVALID_INPUT", "请选择登录方式");
    const account = inputText(body.account);
    const method = body.method;
    const password =
      method === "password" ? inputText(body.password, 256) : undefined;
    // Password whitespace is significant; do not apply text normalization to it.
    const mobileCode =
      method === "sms" ? inputText(body.mobileCode, 8) : undefined;
    if (
      method === "sms" &&
      (!/^1[3-9]\d{9}$/.test(account) || !/^\d{4,8}$/.test(mobileCode || ""))
    )
      throw new AcademicError("INVALID_INPUT", "手机号或短信验证码格式不正确");
    options.rateLimit(s.userId, "academic-login", 20, 3600000);
    await run(s, async () => {
      const result = await s.client.login({
        method,
        account,
        password: password ? String(body.password) : undefined,
        mobileCode,
        captcha:
          typeof body.captcha === "string"
            ? body.captcha.slice(0, 20)
            : undefined,
      });
      assertLive(s);
      s.state = result.state;
      if (s.state === "authenticated") {
        try {
          s.semesters = await s.client.semesters();
        } catch (error) {
          if (error instanceof AcademicError && error.status >= 500)
            throw new AcademicError(
              error.code,
              `登录成功，但获取学期失败：${error.message}。请重试获取学期`,
              error.status,
            );
          throw error;
        }
      }
    });
    return c.json(publicState(s));
  });
  router.post("/course-imports/:id/second-factor/send", async (c) => {
    const s = get(c);
    requireState(s, ["second-factor"]);
    await run(s, () =>
      send(s, `factor:${s.userId}`, () => s.client.sendFactor()),
    );
    return c.json(publicState(s));
  });
  router.post("/course-imports/:id/second-factor/verify", async (c) => {
    const s = get(c);
    requireState(s, ["second-factor"]);
    const body = await input(c);
    const code = inputText(body.code, 8);
    if (!/^\d{4,8}$/.test(code))
      throw new AcademicError("INVALID_INPUT", "请输入短信验证码");
    options.rateLimit(s.userId, "academic-login", 20, 3600000);
    await run(s, async () => {
      await s.client.verifyFactor(code);
      assertLive(s);
      s.state = "authenticated";
      s.semesters = await s.client.semesters();
    });
    return c.json(publicState(s));
  });
  router.get("/course-imports/:id/semesters", async (c) => {
    const s = get(c);
    requireState(s, ["authenticated", "preview"]);
    s.semesters = await run(s, () => s.client.semesters());
    return c.json(publicState(s));
  });
  router.post("/course-imports/:id/preview", async (c) => {
    const s = get(c);
    requireState(s, ["authenticated", "preview"]);
    const body = await input(c);
    const semester = s.semesters.find((v) => v.id === body.semesterId);
    if (!semester)
      throw new AcademicError("INVALID_SEMESTER", "请选择学校提供的学期");
    const courses = await run(s, () => s.client.courses(semester));
    const previewId = randomUUID();
    s.preview = { id: previewId, semester, courses };
    s.state = "preview";
    return c.json({
      previewId,
      term: semester.name,
      items: courses.map((course) => {
        const mapped = source(course.sourceKey),
          coded = byCode(course.courseCode);
        const exact = mapped
          ? (db
              .query("SELECT id, code, title, active FROM courses WHERE id = ?")
              .get(mapped.courseId) as Candidate)
          : coded;
        return {
          ...course,
          candidates: exact ? [exact] : candidates(course),
          matchedCourseId: exact?.id || null,
          requiresChoice: !exact && candidates(course).length > 0,
        };
      }),
    });
  });
  router.post("/course-imports/:id/confirm", async (c) => {
    const user = requireUser(c),
      body = await input(c),
      previewId = inputText(body.previewId, 80);
    // Durable receipt permits retries after the temporary upstream session is destroyed.
    const receipt = db
      .query(
        "SELECT term, course_count AS courseCount, new_course_count AS newCourseCount FROM academic_import_batches WHERE id = ? AND user_id = ?",
      )
      .get(previewId, user.id);
    if (receipt) return c.json({ ...receipt, duplicate: true });
    const s = get(c);
    requireState(s, ["preview"]);
    if (s.busy) throw new AcademicError("IMPORT_BUSY", "导入正在处理中", 409);
    const preview = s.preview;
    if (!preview || preview.id !== previewId)
      throw new AcademicError(
        "INVALID_PREVIEW",
        "导入预览已失效，请重新获取",
        409,
      );
    if (!preview.courses.length)
      throw new AcademicError("EMPTY_TIMETABLE", "该学期没有可导入的课程");
    if (body.matches !== undefined && !isObject(body.matches))
      throw new AcademicError("INVALID_INPUT", "课程匹配格式不正确");
    const matches = isObject(body.matches) ? body.matches : {};
    assertLive(s);
    const result = db.transaction(() => {
      let newCourseCount = 0;
      const createdIds = new Set<string>();
      const actor = db
        .query("SELECT account_status FROM users WHERE id=?")
        .get(user.id) as { account_status: string } | null;
      if (actor?.account_status !== "active")
        throw new AcademicError(
          "ACCOUNT_RESTRICTED",
          "当前账号暂时无法导入课程",
          403,
        );
      const createdAt = new Date(now()).toISOString();
      for (const course of preview.courses) {
        const mapped = source(course.sourceKey),
          coded = byCode(course.courseCode);
        if (mapped && coded && mapped.courseId !== coded.id)
          throw new AcademicError(
            "COURSE_CODE_CONFLICT",
            "教务来源与课程代码的关联存在冲突，请联系课程管理员",
            409,
          );
        let courseId = mapped?.courseId || coded?.id;
        if (!courseId) {
          const available = candidates(course).filter(
              (candidate) => !createdIds.has(candidate.id),
            ),
            choice = matches[course.sourceKey];
          if (available.length && choice === undefined)
            throw new AcademicError(
              "COURSE_MATCH_REQUIRED",
              "存在同名课程，请确认关联或选择新增",
              409,
            );
          if (choice !== undefined && choice !== "new") {
            const candidate = available.find((v) => v.id === choice);
            if (!candidate)
              throw new AcademicError(
                "INVALID_COURSE_MATCH",
                "课程关联已变化，请重新获取预览",
                409,
              );
            courseId = candidate.id;
          }
        }
        if (!courseId) {
          courseId = randomUUID();
          newCourseCount++;
          createdIds.add(courseId);
          const code =
            course.courseCode ||
            `SUAT-IMPORTED-${createHash("sha256").update(course.sourceKey).digest("hex").slice(0, 24)}`;
          db.query(
            `INSERT INTO courses(id,code,title,department,course_type,credits,term,code_pending,credits_known,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            courseId,
            code,
            cleanTitle(course.title),
            course.department,
            course.courseType,
            course.credits ?? 0,
            preview.semester.name,
            course.courseCode ? 0 : 1,
            course.credits === null ? 0 : 1,
            createdAt,
          );
        }
        const target = db
          .query("SELECT active FROM courses WHERE id = ?")
          .get(courseId) as { active: number };
        if (!target?.active)
          throw new AcademicError(
            "COURSE_INACTIVE",
            "课表包含管理员已停用的课程，本次导入未保存",
            409,
          );
        if (course.courseCode)
          db.query(
            "UPDATE courses SET code=?, code_pending=0 WHERE id=? AND code_pending=1",
          ).run(course.courseCode, courseId);
        // Imported records may fill blanks, never overwrite maintained catalogue values.
        db.query(
          `UPDATE courses SET department=CASE WHEN department='' THEN ? ELSE department END, course_type=CASE WHEN course_type='' THEN ? ELSE course_type END, term=CASE WHEN term='' THEN ? ELSE term END, credits=CASE WHEN credits_known=0 AND ? IS NOT NULL THEN ? ELSE credits END, credits_known=CASE WHEN ? IS NOT NULL THEN 1 ELSE credits_known END WHERE id=?`,
        ).run(
          course.department,
          course.courseType,
          preview.semester.name,
          course.credits,
          course.credits,
          course.credits,
          courseId,
        );
        let offeringId = mapped?.offeringId;
        if (!offeringId) {
          const section =
            course.section ||
            `教务-${createHash("sha256").update(course.sourceKey).digest("hex").slice(0, 16)}`;
          const existing = db
            .query(
              "SELECT id, active FROM course_offerings WHERE course_id=? AND term=? AND section=?",
            )
            .get(courseId, preview.semester.name, section) as {
            id: string;
            active: number;
          } | null;
          if (existing && !existing.active)
            throw new AcademicError(
              "COURSE_INACTIVE",
              "对应开课记录已停用，本次导入未保存",
              409,
            );
          offeringId = existing?.id || randomUUID();
          if (!existing)
            db.query(
              "INSERT INTO course_offerings(id,course_id,term,section,source,import_batch_id,imported_teachers_json,created_at) VALUES(?,?,?,?, 'suat', ?,?,?)",
            ).run(
              offeringId,
              courseId,
              preview.semester.name,
              section,
              previewId,
              JSON.stringify(course.teachers),
              createdAt,
            );
          else
            db.query(
              "UPDATE course_offerings SET imported_teachers_json=? WHERE id=? AND imported_teachers_json='[]'",
            ).run(JSON.stringify(course.teachers), offeringId);
          db.query("INSERT INTO academic_course_sources VALUES(?,?,?)").run(
            course.sourceKey,
            courseId,
            offeringId,
          );
        }
        const offering = db
          .query("SELECT active FROM course_offerings WHERE id=?")
          .get(offeringId) as { active: number };
        if (!offering.active)
          throw new AcademicError(
            "COURSE_INACTIVE",
            "对应开课记录已停用，本次导入未保存",
            409,
          );
        db.query("INSERT OR IGNORE INTO user_courses VALUES(?,?,?)").run(
          user.id,
          offeringId,
          createdAt,
        );
      }
      db.query("INSERT INTO academic_import_batches VALUES(?,?,?,?,?,?)").run(
        previewId,
        user.id,
        preview.semester.name,
        preview.courses.length,
        newCourseCount,
        createdAt,
      );
      return {
        term: preview.semester.name,
        courseCount: preview.courses.length,
        newCourseCount,
      };
    })();
    dispose(s);
    return c.json(result);
  });
  router.get("/courses", (c) => {
    const user = requireUser(c),
      term = textValue(c.req.query("term"));
    const terms = db
      .query(
        "SELECT DISTINCT o.term FROM user_courses u JOIN course_offerings o ON o.id=u.offering_id WHERE u.user_id=? ORDER BY o.term DESC",
      )
      .all(user.id) as { term: string }[];
    const items = db
      .query(
        `SELECT c.id, c.code, c.code_pending AS codePending, c.credits_known AS creditsKnown, c.title,c.english_title AS englishTitle,c.department,c.course_type AS courseType,c.enrollment_type AS enrollmentType,c.credits,o.term,c.assessment,c.difficulty,o.id AS offeringId,o.section,o.active AS offeringActive,c.active,o.imported_teachers_json AS teachersJson, (SELECT COUNT(*) FROM course_reviews r WHERE r.course_id=c.id AND r.status='approved' AND r.moderation_status='visible' AND r.deleted_at IS NULL) AS reviewCount, COALESCE((SELECT ROUND(AVG(r.rating),1) FROM course_reviews r WHERE r.course_id=c.id AND r.status='approved' AND r.moderation_status='visible' AND r.deleted_at IS NULL),0) AS rating FROM user_courses u JOIN course_offerings o ON o.id=u.offering_id JOIN courses c ON c.id=o.course_id WHERE u.user_id=? AND (?='' OR o.term=?) ORDER BY o.term DESC,c.title,o.id`,
      )
      .all(user.id, term, term) as (Record<string, unknown> & {
      teachersJson: string;
    })[];
    return c.json({
      items: items.map(({ teachersJson, ...v }) => ({
        ...v,
        teacherNames: JSON.parse(teachersJson) as string[],
      })),
      terms: terms.map((v) => v.term),
      total: items.length,
    });
  });
  return {
    router,
    clear,
    close: () => {
      clear();
      clearInterval(timer);
    },
  };
}
