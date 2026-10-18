import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { fixture } from "./fixtures";

const email = "test.user.password@stu.suat-sz.edu.cn";
const password = "My-custom-password-123";
const replacement = "My-replacement-password-456";
const requestReset = "/api/auth/email-otp/request-password-reset";
const resetPassword = "/api/auth/email-otp/reset-password";
const signInPassword = "/api/auth/sign-in/email";
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

async function setPassword(
  f: ReturnType<typeof fixture>,
  target = email,
  nextPassword = password,
) {
  const c = f.client();
  f.db.query("DELETE FROM auth_email_cooldowns").run();
  expect(
    (await c.request(requestReset, "POST", { email: target })).status,
  ).toBe(200);
  const otp = f.code(target);
  const response = await c.request(resetPassword, "POST", {
    email: target,
    otp,
    password: nextPassword,
  });
  expect(response.status).toBe(200);
  return { otp, c };
}

test("an existing OTP account sets a hashed password and signs into the same account without changing its identity", async () => {
  const f = fixture();
  const original = f.client();
  const user = await original.signIn(email);
  f.db.query("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
  const c = f.client();
  expect(
    (
      await c.request(resetPassword, "POST", {
        email,
        otp: f.code(email),
        password,
      })
    ).status,
  ).toBe(400);
  expect((await c.request(requestReset, "POST", { email })).status).toBe(200);
  const otp = f.code(email);
  expect(f.mail.at(-1)!.subject).toBe("深小狸：设置登录密码验证码");
  expect(f.mail.at(-1)!.html).toContain("此验证码不能用于登录");
  expect(
    (
      await c.request(resetPassword, "POST", {
        email,
        otp: wrongCode(otp),
        password,
      })
    ).status,
  ).toBe(400);
  expect(
    (await c.request(resetPassword, "POST", { email, otp, password: "short" }))
      .status,
  ).toBe(400);
  expect(
    (
      await c.request(resetPassword, "POST", {
        email,
        otp,
        password: "x".repeat(129),
      })
    ).status,
  ).toBe(400);
  expect(
    (await c.request(resetPassword, "POST", { email, otp, password })).status,
  ).toBe(200);
  expect(await (await original.request("/api/session")).json()).toMatchObject({
    authenticated: false,
  });
  const stored = f.db
    .query(
      "SELECT password FROM auth_accounts WHERE userId = ? AND providerId = 'credential'",
    )
    .get(user.id) as { password: string };
  expect(stored.password).not.toBe(password);
  expect(stored.password.length).toBeGreaterThan(64);
  const signedIn = await c.request(signInPassword, "POST", {
    email: `  ${email.toUpperCase()}  `,
    password,
  });
  expect(signedIn.status).toBe(200);
  c.capture(signedIn);
  expect(await (await c.request("/api/session")).json()).toMatchObject({
    authenticated: true,
    user: { id: user.id, displayName: email.split("@")[0], role: "admin" },
  });
  expect(f.db.query("SELECT COUNT(*) AS count FROM auth_users").get()).toEqual({
    count: 1,
  });
  expect(
    (
      await f
        .client()
        .request(resetPassword, "POST", { email, otp, password: replacement })
    ).status,
  ).toBe(400);
});

test("password reset replaces the old password, revokes all sessions and keeps OTP login available", async () => {
  const f = fixture();
  const c = f.client();
  const original = await c.signIn(email);
  await setPassword(f);
  const loggedIn = await c.request(signInPassword, "POST", { email, password });
  expect(loggedIn.status).toBe(200);
  c.capture(loggedIn);
  await setPassword(f, email, replacement);
  expect(await (await c.request("/api/session")).json()).toMatchObject({
    authenticated: false,
  });
  const other = f.client();
  expect(
    (await other.request(signInPassword, "POST", { email, password })).status,
  ).toBe(401);
  const signedIn = await other.request(signInPassword, "POST", {
    email,
    password: replacement,
  });
  expect(signedIn.status).toBe(200);
  other.capture(signedIn);
  expect(await (await other.request("/api/session")).json()).toMatchObject({
    user: { id: original.id },
  });
  expect((await f.client().signIn(email)).id).toBe(original.id);
});

test("password endpoints cannot create accounts, reset unknown accounts, use expired codes or bypass cooldowns", async () => {
  const f = fixture();
  const c = f.client();
  expect(
    (
      await c.request("/api/auth/sign-up/email", "POST", {
        email,
        password,
        name: "Unverified",
      })
    ).ok,
  ).toBe(false);
  expect(
    (await c.request(signInPassword, "POST", { email, password })).status,
  ).toBe(401);
  expect((await c.request(requestReset, "POST", { email })).status).toBe(200);
  expect(f.mail).toHaveLength(0);
  expect(f.db.query("SELECT COUNT(*) AS count FROM auth_users").get()).toEqual({
    count: 0,
  });
  expect((await c.request(requestReset, "POST", { email })).status).toBe(429);
  await c.signIn(email);
  f.db.query("DELETE FROM auth_email_cooldowns").run();
  expect((await c.request(requestReset, "POST", { email })).status).toBe(200);
  const otp = f.code(email);
  f.db.query("UPDATE auth_verifications SET expiresAt = ?").run(Date.now() - 1);
  expect(
    (await c.request(resetPassword, "POST", { email, otp, password })).status,
  ).toBe(400);
  expect(
    f.db
      .query(
        "SELECT COUNT(*) AS count FROM auth_accounts WHERE providerId = 'credential'",
      )
      .get(),
  ).toEqual({ count: 0 });
});

test("restricted and unverified accounts cannot use or reset passwords and reset requests do not reveal their status", async () => {
  for (const status of ["banned", "deleting", "unverified"]) {
    const f = fixture();
    const c = f.client();
    const user = await c.signIn(email);
    await setPassword(f);
    f.db.query("DELETE FROM auth_email_cooldowns").run();
    const proofClient = f.client();
    expect(
      (await proofClient.request(requestReset, "POST", { email })).status,
    ).toBe(200);
    const otp = f.code(email);
    if (status === "unverified")
      f.db
        .query("UPDATE auth_users SET emailVerified = 0 WHERE id = ?")
        .run(user.id);
    else
      f.db
        .query("UPDATE users SET account_status = ? WHERE id = ?")
        .run(status, user.id);
    const attempts = f.client();
    expect(
      (await attempts.request(signInPassword, "POST", { email, password }))
        .status,
    ).toBe(401);
    expect(
      (
        await attempts.request(resetPassword, "POST", {
          email,
          otp,
          password: replacement,
        })
      ).status,
    ).toBe(400);
    f.db.query("DELETE FROM auth_email_cooldowns").run();
    const before = f.mail.length;
    expect(
      await (await attempts.request(requestReset, "POST", { email })).json(),
    ).toEqual({ success: true });
    expect(f.mail).toHaveLength(before);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM auth_sessions").get(),
    ).toEqual({ count: 0 });
  }
});

test("QQ password login follows the QQ feature switch and password guessing is limited", async () => {
  const qq = "123456789@qq.com";
  const f = fixture(false, true);
  const c = f.client();
  const user = await c.signIn(qq);
  await setPassword(f, qq);
  const signedIn = await c.request(signInPassword, "POST", {
    email: qq,
    password,
  });
  expect(signedIn.status).toBe(200);
  c.capture(signedIn);
  expect(await (await c.request("/api/session")).json()).toMatchObject({
    campusEmailVerified: false,
    user: { id: user.id },
  });
  const closed = createApp({
    database: f.db,
    qqEmailLoginEnabled: false,
    sessionSecret: "integration-tests-secret-at-least-32-characters",
  });
  for (const path of [signInPassword, requestReset, resetPassword]) {
    expect(
      (
        await closed.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: qq, password, otp: "123456" }),
        })
      ).ok,
    ).toBe(false);
  }
  const attacker = f.client();
  for (let attempt = 0; attempt < 5; attempt++)
    expect(
      (
        await attacker.request(signInPassword, "POST", {
          email: qq,
          password: "incorrect-password",
        })
      ).status,
    ).toBe(401);
  expect(
    (await attacker.request(signInPassword, "POST", { email: qq, password }))
      .status,
  ).toBe(429);
});
