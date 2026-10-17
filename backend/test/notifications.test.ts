import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { createHmac } from "node:crypto";
import {
  drainEmailOutbox,
  enqueueEmail,
  startEmailWorker,
} from "../src/notifications";
import { fixture } from "./fixtures";

describe("email queue and signed delivery receipts", () => {
  test("an expired mute allows notifications again and the worker runs its initial drain", async () => {
    const f = fixture();
    const c = f.client();
    const user = await c.signIn("test.user.expired@suat-sz.edu.cn");
    f.db
      .query(
        "UPDATE users SET account_status = 'suspended', suspended_until = ? WHERE id = ?",
      )
      .run(new Date(Date.now() - 1000).toISOString(), user.id);
    enqueueEmail(f.db, {
      userId: user.id,
      kind: "report-result",
      subject: "通知",
      text: "请查看结果",
      dedupeKey: "expired-mute",
    });
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM email_outbox").get(),
    ).toEqual({ count: 1 });
    let calls = 0;
    let ticks = 0;
    const stop = startEmailWorker(f.db, {
      sendEmail: async () => {
        calls++;
        return "worker-provider-id";
      },
      onTick: () => {
        ticks++;
      },
    });
    try {
      await sleep(10);
      expect(calls).toBe(1);
      expect(ticks).toBe(1);
      expect(f.db.query("SELECT status FROM email_outbox").get()).toEqual({
        status: "sent",
      });
    } finally {
      stop();
    }
  });
  test("queue deduplicates, retries with backoff, records provider acceptance and stops after eight failures", async () => {
    const f = fixture();
    const c = f.client();
    const user = await c.signIn("test.user.queue@suat-sz.edu.cn");
    const input = {
      userId: user.id,
      kind: "moderation-action",
      subject: "通知",
      text: "登录后查看详情。",
      dedupeKey: "queue-test",
    };
    enqueueEmail(f.db, input);
    enqueueEmail(f.db, input);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM email_outbox").get(),
    ).toEqual({ count: 1 });
    await drainEmailOutbox(f.db, async () => {
      throw new Error("temporary provider outage");
    });
    expect(
      f.db.query("SELECT status, attempts FROM email_outbox").get(),
    ).toEqual({ status: "pending", attempts: 1 });
    const scheduled = f.db
      .query("SELECT run_after FROM email_outbox")
      .get() as { run_after: string };
    expect(Date.parse(scheduled.run_after)).toBeGreaterThan(
      Date.now() + 50_000,
    );
    f.db.query("UPDATE email_outbox SET run_after = '2000-01-01'").run();
    let calls = 0;
    await drainEmailOutbox(f.db, async () => {
      calls++;
      return "provider-accepted-id";
    });
    await drainEmailOutbox(f.db, async () => {
      calls++;
    });
    expect(calls).toBe(1);
    expect(
      f.db
        .query("SELECT status, resend_id, delivery_status FROM email_outbox")
        .get(),
    ).toEqual({
      status: "sent",
      resend_id: "provider-accepted-id",
      delivery_status: "unknown",
    });
    enqueueEmail(f.db, { ...input, dedupeKey: "failure-budget" });
    f.db
      .query(
        "UPDATE email_outbox SET attempts = 7 WHERE dedupe_key = 'failure-budget'",
      )
      .run();
    await drainEmailOutbox(f.db, async () => {
      throw new Error("permanent provider outage");
    });
    expect(
      f.db
        .query(
          "SELECT status, attempts FROM email_outbox WHERE dedupe_key = 'failure-budget'",
        )
        .get(),
    ).toEqual({ status: "failed", attempts: 8 });
  });

  test("social mail respects changed preferences, current verified recipient, account status and unread state at send time", async () => {
    for (const scenario of [
      "opt-out",
      "changed-email",
      "deleting",
      "read",
      "unread",
    ]) {
      const f = fixture();
      const c = f.client();
      const user = await c.signIn(`test.user.${scenario}@suat-sz.edu.cn`);
      f.db
        .query(
          "INSERT INTO notifications (id, user_id, kind, title, dedupe_key, created_at) VALUES ('n', ?, 'contact-accepted', '联系请求已接受', 'notice', ?)",
        )
        .run(user.id, new Date().toISOString());
      enqueueEmail(f.db, {
        userId: user.id,
        kind: "contact-accepted",
        subject: "未读通知摘要",
        text: "请登录查看站内通知。",
        dedupeKey: "social",
      });
      f.db.query("UPDATE email_outbox SET run_after = '2000-01-01'").run();
      if (scenario === "opt-out")
        f.db
          .query("INSERT INTO notification_preferences VALUES (?, 0)")
          .run(user.id);
      if (scenario === "changed-email")
        f.db
          .query(
            "UPDATE users SET email = 'changed@suat-sz.edu.cn' WHERE id = ?",
          )
          .run(user.id);
      if (scenario === "deleting")
        f.db
          .query("UPDATE users SET account_status = 'deleting' WHERE id = ?")
          .run(user.id);
      if (scenario === "read")
        f.db
          .query("UPDATE notifications SET read_at = ?")
          .run(new Date().toISOString());
      let sent = 0;
      await drainEmailOutbox(f.db, async () => {
        sent++;
        return "accepted";
      });
      expect(sent, scenario).toBe(scenario === "unread" ? 1 : 0);
    }
  });

  test("webhook signatures are required and duplicate receipts update delivery only once", async () => {
    const f = fixture();
    const c = f.client();
    const user = await c.signIn("test.user.webhook@suat-sz.edu.cn");
    enqueueEmail(f.db, {
      userId: user.id,
      kind: "report-result",
      subject: "通知",
      text: "查看结果",
      dedupeKey: "webhook-test",
    });
    await drainEmailOutbox(f.db, async () => "provider-message-id");
    const previous = process.env.RESEND_WEBHOOK_SECRET;
    const key = Buffer.from("integration-test-webhook-secret");
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString("base64")}`;
    try {
      const payload = JSON.stringify({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: { email_id: "provider-message-id" },
      });
      const id = "event-integration-test";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", key)
        .update(`${id}.${timestamp}.${payload}`)
        .digest("base64");
      const send = (signatureValue: string) =>
        f.app.request("/api/webhooks/resend", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "svix-id": id,
            "svix-timestamp": timestamp,
            "svix-signature": signatureValue,
          },
          body: payload,
        });
      expect((await send("v1,invalid")).status).toBe(400);
      expect((await send(`v1,${signature}`)).status).toBe(200);
      expect((await send(`v1,${signature}`)).status).toBe(200);
      expect(
        f.db.query("SELECT delivery_status FROM email_outbox").get(),
      ).toEqual({ delivery_status: "delivered" });
      expect(
        f.db.query("SELECT COUNT(*) AS count FROM email_webhook_events").get(),
      ).toEqual({ count: 1 });
    } finally {
      if (previous === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = previous;
    }
  });
});
