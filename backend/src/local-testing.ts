import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { seedDatabase, type AppDatabase } from "./db";
import { deliverCampusEmail, type EmailSender } from "./email";

export const TEST_IDENTITIES = [
  {
    id: "local-test-user-a",
    name: "测试同学 A",
    email: "test.user.a@stu.suat-sz.edu.cn",
    role: "student",
  },
  {
    id: "local-test-user-b",
    name: "测试同学 B",
    email: "test.user.b@suat-sz.edu.cn",
    role: "student",
  },
  {
    id: "local-test-moderator-a",
    name: "测试审核员 A",
    email: "test.moderator.a@suat-sz.edu.cn",
    role: "moderator",
  },
  {
    id: "local-test-moderator-b",
    name: "测试审核员 B",
    email: "test.moderator.b@suat-sz.edu.cn",
    role: "moderator",
  },
  {
    id: "local-test-admin-a",
    name: "测试管理员",
    email: "test.admin.a@suat-sz.edu.cn",
    role: "admin",
  },
] as const;

export function initializeLocalTesting(db: AppDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS test_mail_inbox (
    id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL,
    text_body TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS test_runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const identity of TEST_IDENTITIES) {
      db.query(
        "INSERT OR IGNORE INTO auth_users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      ).run(identity.id, identity.name, identity.email, Date.now(), Date.now());
      db.query(
        "INSERT OR IGNORE INTO users (id, display_name, email, email_verified, department, role, is_admin, created_at, updated_at) VALUES (?, ?, ?, 1, '本地合成测试身份', ?, ?, ?, ?)",
      ).run(
        identity.id,
        identity.name,
        identity.email,
        identity.role === "moderator" ? "moderator" : "student",
        identity.role === "admin" ? 1 : 0,
        now,
        now,
      );
    }
  })();
}

export const isSyntheticTestEmail = (email: string): boolean =>
  /^test\.(user|moderator|admin)\.[a-z0-9.-]+@(stu\.suat-sz\.edu\.cn|suat-sz\.edu\.cn|example\.test)$/.test(
    email,
  );

export function localTestEmailSender(
  db: AppDatabase,
  sendRealEmail: EmailSender = deliverCampusEmail,
): EmailSender {
  return async (message) => {
    if (!isSyntheticTestEmail(message.to)) return sendRealEmail(message);
    const id = `local-${randomUUID()}`;
    db.query(
      "INSERT OR IGNORE INTO test_mail_inbox (id, recipient, subject, text_body, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      message.to,
      message.subject,
      message.text,
      message.idempotencyKey,
      new Date().toISOString(),
    );
    return (
      db
        .query("SELECT id FROM test_mail_inbox WHERE idempotency_key = ?")
        .get(message.idempotencyKey) as { id: string }
    ).id;
  };
}

export function localTestRouter(
  db: AppDatabase,
  afterReset: () => void | Promise<void>,
): Hono {
  const router = new Hono();
  router.use("*", async (c, next) => {
    const isLoopback = (url: string) => {
      try {
        return ["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(url).hostname,
        );
      } catch {
        return false;
      }
    };
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    const origin = c.req.header("origin");
    if (
      !isLoopback(`http://${host}`) ||
      (origin && !isLoopback(origin)) ||
      c.req.header("sec-fetch-site") === "cross-site"
    )
      return c.json({ error: { message: "测试工具仅允许本机访问" } }, 403);
    c.header("Cache-Control", "no-store");
    return next();
  });
  router.get("/status", (c) =>
    c.json({
      localTestMode: true,
      identities: TEST_IDENTITIES,
      workerHeartbeat:
        (
          db
            .query(
              "SELECT value FROM test_runtime_state WHERE key = 'worker-heartbeat'",
            )
            .get() as { value: string } | null
        )?.value ?? null,
    }),
  );
  router.get("/inbox", (c) => {
    const recipient = c.req.query("recipient");
    const rows = recipient
      ? db
          .query(
            "SELECT id, recipient, subject, text_body AS text, created_at AS createdAt FROM test_mail_inbox WHERE recipient = ? ORDER BY rowid DESC LIMIT 100",
          )
          .all(recipient)
      : db
          .query(
            "SELECT id, recipient, subject, text_body AS text, created_at AS createdAt FROM test_mail_inbox ORDER BY rowid DESC LIMIT 100",
          )
          .all();
    return c.json({ items: rows });
  });
  router.post("/reset", async (c) => {
    const input: unknown = await c.req.json().catch(() => null);
    if (
      !input ||
      typeof input !== "object" ||
      !("confirmation" in input) ||
      input.confirmation !== "RESET_LOCAL_TEST_DATABASE"
    )
      return c.json(
        { error: { message: "需要明确确认清空本地测试数据库" } },
        400,
      );
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
      )
      .all() as { name: string }[];
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.transaction(() => {
        for (const table of tables)
          db.exec(`DELETE FROM "${table.name.replaceAll('"', '""')}"`);
      })();
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    seedDatabase(db, true);
    initializeLocalTesting(db);
    await afterReset();
    return c.json({ ok: true });
  });
  return router;
}
