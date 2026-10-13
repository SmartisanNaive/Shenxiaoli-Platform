import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import type { AppDatabase } from "./db";

const nowIso = (): string => new Date().toISOString();

export function enqueueEmail(
  db: AppDatabase,
  input: {
    userId: string;
    kind: string;
    subject: string;
    text: string;
    dedupeKey: string;
    runAfter?: string;
  },
): void {
  const user = db
    .query(
      "SELECT email, email_verified FROM users WHERE id = ? AND account_status = 'active'",
    )
    .get(input.userId) as {
    email: string | null;
    email_verified: number;
  } | null;
  if (!user?.email || !user.email_verified) return;
  const social =
    input.kind === "message" ||
    input.kind === "contact" ||
    input.kind === "contact-accepted";
  if (social) {
    const preference = db
      .query(
        "SELECT social_email_enabled FROM notification_preferences WHERE user_id = ?",
      )
      .get(input.userId) as { social_email_enabled: number } | null;
    if (preference?.social_email_enabled === 0) return;
  }
  let runAfter = input.runAfter ?? nowIso();
  if (social) {
    const nextDigest = new Date(Date.now() + 30 * 60_000);
    const lastSent = db
      .query(
        "SELECT MAX(sent_at) AS sentAt FROM email_outbox WHERE user_id = ? AND kind IN ('message', 'contact') AND status = 'sent'",
      )
      .get(input.userId) as { sentAt: string | null };
    if (lastSent.sentAt)
      nextDigest.setTime(
        Math.max(
          nextDigest.getTime(),
          new Date(lastSent.sentAt).getTime() + 60 * 60_000,
        ),
      );
    runAfter = nextDigest.toISOString();
  }
  const dedupeKey = social
    ? `social-digest/${input.userId}/${Math.floor(Date.now() / 3_600_000)}`
    : input.dedupeKey;
  db.query(
    `INSERT OR IGNORE INTO email_outbox
    (id, user_id, recipient, kind, subject, text_body, dedupe_key, status, run_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    randomUUID(),
    input.userId,
    user.email,
    input.kind,
    input.subject,
    input.text,
    dedupeKey,
    runAfter,
    nowIso(),
  );
}

export function startEmailWorker(database: AppDatabase): () => void {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.info("Email worker idle: configure RESEND_API_KEY and RESEND_FROM");
    return () => undefined;
  }
  const resend = new Resend(apiKey);
  database
    .query(
      "UPDATE email_outbox SET status = 'pending' WHERE status = 'sending'",
    )
    .run();
  let running = false;
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const job of database
        .query(
          `SELECT * FROM email_outbox
          WHERE status = 'pending' AND run_after <= ? ORDER BY run_after, created_at LIMIT 10`,
        )
        .all(nowIso()) as {
        id: string;
        user_id: string | null;
        recipient: string;
        kind: string;
        subject: string;
        text_body: string;
        dedupe_key: string;
        attempts: number;
      }[]) {
        if ((job.kind === "message" || job.kind === "contact") && job.user_id) {
          const unread = Number(
            (
              database
                .query(
                  "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL AND kind IN ('message', 'contact', 'contact-accepted') AND created_at >= ?",
                )
                .get(
                  job.user_id,
                  new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
                ) as { count: number }
            ).count,
          );
          if (!unread) {
            database
              .query(
                "UPDATE email_outbox SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'pending'",
              )
              .run(nowIso(), job.id);
            continue;
          }
        }
        const claimed = database
          .query(
            "UPDATE email_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'",
          )
          .run(job.id);
        if (!claimed.changes) continue;
        try {
          const result = await resend.emails.send(
            {
              from,
              to: [job.recipient],
              subject: job.subject,
              text: job.text_body,
            },
            { idempotencyKey: job.dedupe_key.slice(0, 256) },
          );
          if (result.error) throw new Error(result.error.message);
          database
            .query(
              "UPDATE email_outbox SET status = 'sent', sent_at = ?, resend_id = ?, last_error = '' WHERE id = ?",
            )
            .run(nowIso(), result.data?.id ?? null, job.id);
        } catch (error) {
          const attempts = job.attempts + 1;
          const wait = Math.min(
            6 * 60 * 60_000,
            30_000 * 2 ** Math.min(attempts, 10),
          );
          database
            .query(
              `UPDATE email_outbox SET status = ?, attempts = ?, run_after = ?, last_error = ? WHERE id = ?`,
            )
            .run(
              attempts >= 8 ? "failed" : "pending",
              attempts,
              new Date(Date.now() + wait).toISOString(),
              error instanceof Error
                ? error.message.slice(0, 300)
                : "email delivery failed",
              job.id,
            );
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void drain(), 1_000);
  void drain();
  return () => clearInterval(timer);
}
