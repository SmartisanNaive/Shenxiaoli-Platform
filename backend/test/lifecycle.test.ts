import { describe, expect, test } from "bun:test";
import { cleanupExpiredDeletedAccounts } from "../src/maintenance";
import { fixture } from "./fixtures";

describe("account lifecycle and catalog boundaries", () => {
  test("campus email changes verify both addresses and reject external primary addresses", async () => {
    const f = fixture();
    const c = f.client();
    const previous = "test.user.previous@stu.suat-sz.edu.cn";
    const next = "test.user.next@suat-sz.edu.cn";
    const user = await c.signIn(previous);
    expect(
      (
        await c.request("/api/auth/email-otp/request-email-change", "POST", {
          newEmail: "external@example.test",
          otp: "123456",
        })
      ).status,
    ).toBe(400);
    f.db.query("DELETE FROM auth_email_cooldowns").run();
    expect(
      (
        await c.request("/api/auth/email-otp/send-verification-otp", "POST", {
          email: previous,
          type: "email-verification",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await c.request("/api/auth/email-otp/request-email-change", "POST", {
          newEmail: next,
          otp: f.code(previous),
        })
      ).status,
    ).toBe(200);
    const change = await c.request("/api/auth/email-otp/change-email", "POST", {
      newEmail: next,
      otp: f.code(next),
    });
    expect(change.status).toBe(200);
    expect(await (await c.request("/api/session")).json()).toMatchObject({
      user: { id: user.id, email: next, emailVerified: true },
    });
    expect(
      (
        await c.request("/api/auth/email-otp/change-email", "POST", {
          newEmail: next,
          otp: f.code(next),
        })
      ).status,
    ).toBe(400);
  });

  test("deletion removes auxiliary bindings, revokes recovery proofs and clears identifying data after retention", async () => {
    const f = fixture();
    const c = f.client();
    const email = "test.user.deleting@suat-sz.edu.cn";
    const user = await c.signIn(email);
    f.db
      .query(
        "INSERT INTO recovery_emails VALUES (?, 'test.user.deleting@example.test', ?)",
      )
      .run(user.id, new Date().toISOString());
    const recover = await f
      .client()
      .request("/api/auth/recovery-email/login/request", "POST", { email });
    const challenge = (await recover.json()) as { challengeId: string };
    const recoveryOtp = f.code("test.user.deleting@example.test");
    expect(
      (await c.request("/api/me/account/deletion-code", "POST")).status,
    ).toBe(200);
    expect(
      (await c.request("/api/me/account/delete", "POST", { otp: "000000" }))
        .status,
    ).toBe(400);
    expect(
      (
        await c.request("/api/me/account/delete", "POST", {
          otp: f.code(email),
        })
      ).status,
    ).toBe(200);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM recovery_emails").get(),
    ).toEqual({ count: 0 });
    expect(
      (
        await f
          .client()
          .request("/api/auth/recovery-email/login/confirm", "POST", {
            email,
            challengeId: challenge.challengeId,
            otp: recoveryOtp,
          })
      ).status,
    ).toBe(400);
    expect(cleanupExpiredDeletedAccounts(f.db)).toBe(0);
    f.db
      .query("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 31 * 86_400_000).toISOString(), user.id);
    expect(cleanupExpiredDeletedAccounts(f.db)).toBe(1);
    expect(
      f.db
        .query("SELECT email, email_verified FROM users WHERE id = ?")
        .get(user.id),
    ).toEqual({ email: null, email_verified: 0 });
  });

  test("favorites paginate visible content and stop counting removed targets", async () => {
    const f = fixture();
    const c = f.client();
    await c.signIn("test.user.favorites@suat-sz.edu.cn");
    const ids: string[] = [];
    for (let n = 0; n < 3; n++) {
      const post = await c.request("/api/tree-hole", "POST", {
        content: `测试收藏分页的树洞内容 ${n}`,
      });
      expect(post.status).toBe(201);
      const { id } = (await post.json()) as { id: string };
      ids.push(id);
      expect(
        (await c.request(`/api/favorites/tree-hole/${id}`, "POST")).status,
      ).toBe(200);
    }
    for (const id of ids.slice(0, 2))
      expect(
        (await c.request(`/api/publications/tree-hole/${id}`, "DELETE")).status,
      ).toBe(200);
    const result = (await (
      await c.request("/api/favorites?pageSize=1")
    ).json()) as { items: { id: string }[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(ids[2]);
    expect(
      await (await c.request("/api/favorites?pageSize=1&page=2")).json(),
    ).toMatchObject({ items: [], total: 1 });
  });

  test("legacy moderation approvals and independent appeal uphold remain available", async () => {
    const f = fixture(true);
    const author = f.client();
    const reporter = f.client();
    const first = f.client();
    const second = f.client();
    const owner = await author.signIn("test.user.appeal@suat-sz.edu.cn");
    await reporter.signIn("test.user.reporter@suat-sz.edu.cn");
    const a = await first.signIn("test.moderator.a@suat-sz.edu.cn");
    const b = await second.signIn("test.moderator.b@suat-sz.edu.cn");
    f.db
      .query("UPDATE users SET role = 'moderator' WHERE id IN (?, ?)")
      .run(a.id, b.id);
    f.db
      .query(
        "INSERT INTO tree_posts (id, user_id, content, topic, status, created_at) VALUES ('legacy-pending', ?, '旧版待审内容用于验证审核入口。', '科研', 'pending', ?)",
      )
      .run(owner.id, new Date().toISOString());
    expect(
      (
        await first.request("/api/admin/tree-hole/legacy-pending", "PATCH", {
          status: "approved",
          reason: "符合社区规则",
        })
      ).status,
    ).toBe(200);
    const report = await reporter.request("/api/reports", "POST", {
      targetType: "tree-hole",
      targetId: "legacy-pending",
      reason: "检查申诉维持处置",
    });
    const { id } = (await report.json()) as { id: string };
    const handled = (await (
      await first.request(`/api/admin/reports/${id}/action`, "POST", {
        action: "hide",
        reason: "测试下架理由",
      })
    ).json()) as { caseId: string };
    expect(
      (
        await author.request("/api/me/appeals", "POST", {
          caseId: handled.caseId,
          reason: "这是一条用于验证独立复核的申诉理由。",
        })
      ).status,
    ).toBe(201);
    expect(
      await (await second.request("/api/admin/appeals")).json(),
    ).toMatchObject({ items: [{ id: handled.caseId }], total: 1 });
    expect(
      (
        await first.request(`/api/admin/appeals/${handled.caseId}`, "PATCH", {
          outcome: "uphold",
          reason: "原处理人不可复核",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await second.request(`/api/admin/appeals/${handled.caseId}`, "PATCH", {
          outcome: "uphold",
          reason: "复核后维持原处置",
        })
      ).status,
    ).toBe(200);
    expect(
      await (await author.request("/api/me/appeals")).json(),
    ).toMatchObject({ items: [{ appealOutcome: "uphold: 复核后维持原处置" }] });
    expect(
      f.db
        .query(
          "SELECT moderation_status FROM tree_posts WHERE id = 'legacy-pending'",
        )
        .get(),
    ).toEqual({ moderation_status: "hidden" });
  });
});
