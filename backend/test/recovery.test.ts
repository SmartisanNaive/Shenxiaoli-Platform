import { describe, expect, test } from "bun:test";
import { fixture } from "./fixtures";

const campus = "test.user.a@stu.suat-sz.edu.cn";
const auxiliary = "test.user.a@example.test";
const base = "/api/auth/recovery-email";
type Issued = { challengeId: string; expiresIn: number };

async function bind(
  f: ReturnType<typeof fixture>,
  c: ReturnType<ReturnType<typeof fixture>["client"]>,
  email = auxiliary,
  method = "campus",
) {
  const response = await c.request(`${base}/change/request`, "POST", {
    email,
    method,
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as Issued;
  const previous =
    method === "campus"
      ? campus
      : (
          f.db.query("SELECT email FROM recovery_emails").get() as {
            email: string;
          }
        ).email;
  return {
    challengeId: data.challengeId,
    currentOtp: f.code(previous),
    newOtp: f.code(email),
  };
}

describe("verified auxiliary email recovery", () => {
  test("binding verifies both inboxes, revokes sessions, and recovery keeps the original account and admin grant", async () => {
    const f = fixture();
    const original = f.client();
    const user = await original.signIn(campus);
    f.db.query("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
    expect(await (await original.request(base)).json()).toEqual({
      email: null,
      verifiedAt: null,
    });
    const proof = await bind(f, original);
    const stored = f.db
      .query(
        "SELECT code_hash, new_code_hash FROM recovery_challenges WHERE id = ?",
      )
      .get(proof.challengeId) as Record<string, string>;
    expect(stored.code_hash).toHaveLength(64);
    expect(stored.code_hash).not.toBe(proof.currentOtp);
    expect(stored.new_code_hash).not.toBe(proof.newOtp);
    expect(
      (await original.request(`${base}/change/confirm`, "POST", proof)).status,
    ).toBe(200);
    expect(await (await original.request("/api/session")).json()).toMatchObject(
      { authenticated: false },
    );
    const recovered = f.client();
    const requested = await recovered.request(`${base}/login/request`, "POST", {
      email: campus,
    });
    expect(requested.status).toBe(200);
    const { challengeId } = (await requested.json()) as Issued;
    const body = { email: campus, challengeId, otp: f.code(auxiliary) };
    const confirmed = await recovered.request(
      `${base}/login/confirm`,
      "POST",
      body,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get("set-cookie")).toContain("HttpOnly");
    recovered.capture(confirmed);
    expect(
      await (await recovered.request("/api/session")).json(),
    ).toMatchObject({
      authenticated: true,
      campusEmailVerified: true,
      user: { id: user.id, email: campus, role: "admin" },
    });
    expect(
      (await recovered.request("/api/admin/courses/import-template")).status,
    ).toBe(200);
    expect(
      (await f.client().request(`${base}/login/confirm`, "POST", body)).status,
    ).toBe(400);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM auth_users").get(),
    ).toEqual({ count: 1 });
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM recovery_challenges").get(),
    ).toEqual({ count: 0 });
  });

  test("first binding cannot use auxiliary proof; wrong codes, cross-user and cross-purpose attempts are rejected", async () => {
    const f = fixture();
    const c = f.client();
    await c.signIn(campus);
    expect(
      (
        await c.request(`${base}/change/request`, "POST", {
          email: auxiliary,
          method: "auxiliary",
        })
      ).status,
    ).toBe(400);
    const proof = await bind(f, c);
    expect(
      (
        await c.request(`${base}/login/confirm`, "POST", {
          email: campus,
          challengeId: proof.challengeId,
          otp: proof.currentOtp,
        })
      ).status,
    ).toBe(400);
    const other = f.client();
    await other.signIn("test.user.b@suat-sz.edu.cn");
    expect(
      (await other.request(`${base}/change/confirm`, "POST", proof)).status,
    ).toBe(400);
    expect(
      (
        await c.request(`${base}/change/confirm`, "POST", {
          ...proof,
          newOtp: "000000",
        })
      ).status,
    ).toBe(400);
    expect(
      (await c.request(`${base}/change/confirm`, "POST", proof)).status,
    ).toBe(200);
  });

  test("expiry and the five-attempt budget invalidate otherwise correct codes", async () => {
    for (const mode of ["expired", "attempts"]) {
      const f = fixture();
      const c = f.client();
      await c.signIn(campus);
      const proof = await bind(f, c);
      if (mode === "expired")
        f.db
          .query("UPDATE recovery_challenges SET expires_at = ?")
          .run(Date.now() - 1);
      else
        for (let attempt = 0; attempt < 5; attempt++)
          expect(
            (
              await c.request(`${base}/change/confirm`, "POST", {
                ...proof,
                currentOtp: "000000",
              })
            ).status,
          ).toBe(400);
      expect(
        (await c.request(`${base}/change/confirm`, "POST", proof)).status,
      ).toBe(400);
      expect(
        f.db.query("SELECT COUNT(*) AS count FROM recovery_emails").get(),
      ).toEqual({ count: 0 });
    }
  });

  test("changing and removing the auxiliary email can use the existing auxiliary inbox and invalidate pending recovery", async () => {
    const f = fixture();
    const initial = f.client();
    await initial.signIn(campus);
    const proof = await bind(f, initial);
    expect(
      (await initial.request(`${base}/change/confirm`, "POST", proof)).status,
    ).toBe(200);
    const active = f.client();
    await active.signIn(campus);
    expect(await (await active.request(base)).json()).toMatchObject({
      email: auxiliary,
    });
    const pending = (await (
      await f
        .client()
        .request(`${base}/login/request`, "POST", { email: campus })
    ).json()) as Issued;
    const pendingCode = f.code(auxiliary);
    f.db.query("DELETE FROM recovery_email_cooldowns").run();
    const next = "test.user.a.new@example.test";
    const changed = await bind(f, active, next, "auxiliary");
    expect(
      (await active.request(`${base}/change/confirm`, "POST", changed)).status,
    ).toBe(200);
    expect(
      (
        await f.client().request(`${base}/login/confirm`, "POST", {
          email: campus,
          challengeId: pending.challengeId,
          otp: pendingCode,
        })
      ).status,
    ).toBe(400);
    const remove = f.client();
    await remove.signIn(campus);
    f.db.query("DELETE FROM recovery_email_cooldowns").run();
    const issued = await remove.request(`${base}/remove/request`, "POST", {
      method: "auxiliary",
    });
    expect(issued.status).toBe(200);
    const removal = (await issued.json()) as Issued;
    expect(
      (
        await remove.request(`${base}/remove/confirm`, "POST", {
          challengeId: removal.challengeId,
          otp: f.code(next),
        })
      ).status,
    ).toBe(200);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM recovery_emails").get(),
    ).toEqual({ count: 0 });
    expect(await (await remove.request("/api/session")).json()).toMatchObject({
      authenticated: false,
    });
  });

  test("recovery sends nothing for unknown, unbound, banned and deleting accounts and cannot use arbitrary destinations", async () => {
    for (const status of ["unknown", "unbound", "banned", "deleting"]) {
      const f = fixture();
      if (status !== "unknown") {
        const c = f.client();
        const user = await c.signIn(campus);
        if (status !== "unbound")
          f.db
            .query("INSERT INTO recovery_emails VALUES (?, ?, ?)")
            .run(user.id, auxiliary, new Date().toISOString());
        if (["banned", "deleting"].includes(status))
          f.db
            .query("UPDATE users SET account_status = ? WHERE id = ?")
            .run(status, user.id);
      }
      f.mail.length = 0;
      const c = f.client();
      const response = await c.request(`${base}/login/request`, "POST", {
        email: campus,
        destination: "attacker@example.test",
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as Issued;
      expect(data.expiresIn).toBe(300);
      expect(f.mail).toHaveLength(0);
      expect(
        (
          await c.request(`${base}/login/confirm`, "POST", {
            email: campus,
            challengeId: data.challengeId,
            otp: "123456",
          })
        ).status,
      ).toBe(400);
    }
  });

  test("recovery login rejects wrong, expired and exhausted proofs without creating accounts", async () => {
    for (const mode of ["wrong", "expired", "attempts"]) {
      const f = fixture();
      const c = f.client();
      const user = await c.signIn(campus);
      const proof = await bind(f, c);
      expect(
        (await c.request(`${base}/change/confirm`, "POST", proof)).status,
      ).toBe(200);
      const requested = await c.request(`${base}/login/request`, "POST", {
        email: campus,
      });
      const issued = (await requested.json()) as Issued;
      const input = {
        email: campus,
        challengeId: issued.challengeId,
        otp: f.code(auxiliary),
      };
      if (mode === "expired")
        f.db
          .query("UPDATE recovery_challenges SET expires_at = ?")
          .run(Date.now() - 1);
      if (mode === "attempts") {
        for (let attempt = 0; attempt < 5; attempt++)
          expect(
            (
              await c.request(`${base}/login/confirm`, "POST", {
                ...input,
                otp: "000000",
              })
            ).status,
          ).toBe(400);
      }
      expect(
        (
          await f
            .client()
            .request(
              `${base}/login/confirm`,
              "POST",
              mode === "wrong" ? { ...input, otp: "000000" } : input,
            )
        ).status,
      ).toBe(400);
      expect(await (await c.request("/api/session")).json()).toMatchObject({
        authenticated: false,
      });
      expect(f.db.query("SELECT id FROM auth_users").all()).toEqual([
        { id: user.id },
      ]);
    }
  });

  test("resending is throttled, delivery failure leaves no usable challenge, and primary-email changes invalidate proofs", async () => {
    const f = fixture();
    const c = f.client();
    await c.signIn(campus);
    f.failMail();
    expect(
      (await c.request(`${base}/change/request`, "POST", { email: auxiliary }))
        .status,
    ).toBe(503);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM recovery_challenges").get(),
    ).toEqual({ count: 0 });
    expect(
      (await c.request(`${base}/change/request`, "POST", { email: auxiliary }))
        .status,
    ).toBe(429);
    f.failMail(false);
    f.db.query("DELETE FROM recovery_email_cooldowns").run();
    const proof = await bind(f, c);
    expect(
      (
        await c.request(`${base}/change/request`, "POST", {
          email: "test.user.other@example.test",
        })
      ).status,
    ).toBe(429);
    f.db
      .query("UPDATE auth_users SET email = 'test.user.changed@suat-sz.edu.cn'")
      .run();
    expect(
      (await c.request(`${base}/change/confirm`, "POST", proof)).status,
    ).toBe(400);
  });
});
