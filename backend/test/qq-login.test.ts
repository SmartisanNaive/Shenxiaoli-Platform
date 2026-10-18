import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { normalizeCampusEmail, normalizeLoginEmail } from "../src/email";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("QQ login is opt-in and accepts only the exact qq.com domain", () => {
  expect(normalizeLoginEmail("123456@qq.com")).toBeNull();
  expect(normalizeLoginEmail(" 123456@QQ.COM ", true)).toBe("123456@qq.com");
  expect(normalizeCampusEmail("123456@qq.com")).toBeNull();
  for (const email of [
    "a@vip.qq.com",
    "a@qq.com.evil.test",
    "a@gmail.com",
    "a@@qq.com",
    "invalid",
  ])
    expect(normalizeLoginEmail(email, true)).toBeNull();
  for (const enabled of [false, true]) {
    expect(normalizeLoginEmail("student@stu.suat-sz.edu.cn", enabled)).toBe(
      "student@stu.suat-sz.edu.cn",
    );
  }
});

test("QQ accounts require an OTP, can access member pages, and lose access when the switch closes", async () => {
  const db = createDatabase({ path: ":memory:" });
  databases.push(db);
  const messages: { to: string; text: string }[] = [];
  const config = {
    database: db,
    sessionSecret: "qq-login-tests-secret-at-least-32-characters",
    sendEmail: async (message: { to: string; text: string }) => {
      messages.push(message);
    },
  };
  const app = createApp({ ...config, qqEmailLoginEnabled: true });
  const headers = {
    "content-type": "application/json",
    "x-forwarded-for": "192.0.2.181",
  };
  const email = "123456789@qq.com";
  const post = (path: string, data: unknown) =>
    app.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
  expect((await app.request("/api/home")).status).toBe(401);
  const send = await post("/api/auth/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  expect(send.status).toBe(200);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.to).toBe(email);
  const otp = /验证码是 (\d{6})/.exec(messages[0]!.text)![1];
  const wrong = otp === "000000" ? "111111" : "000000";
  expect(
    (await post("/api/auth/sign-in/email-otp", { email, otp: wrong })).status,
  ).toBe(400);
  const login = await post("/api/auth/sign-in/email-otp", {
    email,
    otp,
    name: "QQ 测试同学",
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const request = (path: string) =>
    app.request(path, { headers: { ...headers, cookie } });
  expect(await (await request("/api/session")).json()).toMatchObject({
    authenticated: true,
    qqEmailLoginEnabled: true,
    campusEmailVerified: false,
    user: { email, emailVerified: true, role: "student" },
  });
  expect((await request("/api/home")).status).toBe(200);
  expect((await request("/api/admin/courses/import-template")).status).toBe(
    403,
  );

  const closed = createApp({ ...config, qqEmailLoginEnabled: false });
  expect(
    await (
      await closed.request("/api/session", { headers: { ...headers, cookie } })
    ).json(),
  ).toMatchObject({
    authenticated: false,
    qqEmailLoginEnabled: false,
    campusEmailVerified: false,
  });
  expect(
    (await closed.request("/api/home", { headers: { ...headers, cookie } }))
      .status,
  ).toBe(401);
  expect(
    (
      await closed.request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, type: "sign-in" }),
      })
    ).status,
  ).toBe(400);
  // Closing the switch preserves campus login and the QQ account's saved data.
  expect(
    (
      await closed.request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: "student@suat-sz.edu.cn",
          type: "sign-in",
        }),
      })
    ).status,
  ).toBe(200);
  expect(
    db.query("SELECT email FROM users WHERE email = ?").get(email),
  ).toEqual({ email });
});

test("QQ login remains disabled when no switch is provided", async () => {
  const db = createDatabase({ path: ":memory:" });
  databases.push(db);
  let deliveries = 0;
  const app = createApp({
    database: db,
    sendEmail: async () => {
      deliveries++;
    },
  });
  expect(
    (
      await app.request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "123456789@qq.com", type: "sign-in" }),
      })
    ).status,
  ).toBe(400);
  expect(deliveries).toBe(0);
});

test("a QQ inbox can own a separate account and recover the campus account even with QQ login disabled", async () => {
  const db = createDatabase({ path: ":memory:" });
  databases.push(db);
  const messages: { to: string; subject: string; text: string }[] = [];
  const config = {
    database: db,
    sessionSecret: "qq-recovery-tests-secret-at-least-32-characters",
    sendEmail: async (message: {
      to: string;
      subject: string;
      text: string;
    }) => {
      messages.push(message);
    },
  };
  const enabled = createApp({ ...config, qqEmailLoginEnabled: true });
  const post = (
    app: typeof enabled,
    path: string,
    body: unknown,
    cookie = "",
  ) =>
    app.request(`/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.183",
        cookie,
      },
      body: JSON.stringify(body),
    });
  const code = (email: string) =>
    /验证码是 (\d{6})/.exec(
      [...messages].reverse().find((message) => message.to === email)!.text,
    )![1]!;
  const cookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const session = async (app: typeof enabled, cookie: string) =>
    (
      await app.request("/api/session", { headers: { cookie } })
    ).json() as Promise<{
      user: { id: string; email: string; displayName: string; role: string };
    }>;
  const login = async (email: string, name: string) => {
    db.query("DELETE FROM auth_email_cooldowns").run();
    expect(
      (
        await post(enabled, "email-otp/send-verification-otp", {
          email,
          type: "sign-in",
        })
      ).status,
    ).toBe(200);
    expect(messages.at(-1)!.subject).toBe("深小狸：邮箱登录验证码");
    expect(messages.at(-1)!.text).toContain("首次验证将自动创建账号");
    const response = await post(enabled, "sign-in/email-otp", {
      email,
      name,
      otp: code(email),
    });
    expect(response.status).toBe(200);
    return cookies(response);
  };
  const campus = "owner@stu.suat-sz.edu.cn";
  const qq = "123456789@qq.com";
  const campusCookie = await login(campus, "校园原昵称");
  const original = (await session(enabled, campusCookie)).user;
  db.query("UPDATE users SET is_admin = 1 WHERE id = ?").run(original.id);
  const binding = await post(
    enabled,
    "recovery-email/change/request",
    { email: qq, method: "campus" },
    campusCookie,
  );
  expect(binding.status).toBe(200);
  const proof = (await binding.json()) as { challengeId: string };
  expect(
    (
      await post(
        enabled,
        "recovery-email/change/confirm",
        {
          challengeId: proof.challengeId,
          currentOtp: code(campus),
          newOtp: code(qq),
        },
        campusCookie,
      )
    ).status,
  ).toBe(200);
  const qqCookie = await login(qq, "QQ 独立昵称");
  const separate = (await session(enabled, qqCookie)).user;
  expect(separate.id).not.toBe(original.id);
  expect(separate.email).toBe(qq);
  expect(separate.role).toBe("student");

  for (const qqEmailLoginEnabled of [true, false]) {
    db.query("DELETE FROM recovery_email_cooldowns").run();
    const app = createApp({ ...config, qqEmailLoginEnabled });
    const response = await post(app, "recovery-email/login/request", {
      email: campus,
    });
    expect(response.status).toBe(200);
    const issued = (await response.json()) as { challengeId: string };
    expect(messages.at(-1)!.to).toBe(qq);
    expect(messages.at(-1)!.subject).toBe("深小狸：账号找回验证码");
    expect(messages.at(-1)!.text).toContain(`原账号：${campus}`);
    expect(messages.at(-1)!.text).toContain("不会创建辅助邮箱对应的账号");
    const recovered = await post(app, "recovery-email/login/confirm", {
      email: campus,
      challengeId: issued.challengeId,
      otp: code(qq),
    });
    expect(recovered.status).toBe(200);
    expect((await session(app, cookies(recovered))).user).toMatchObject({
      id: original.id,
      email: campus,
      displayName: "校园原昵称",
      role: "admin",
    });
    expect(db.query("SELECT COUNT(*) AS count FROM auth_users").get()).toEqual({
      count: 2,
    });
  }
  const again = await login(qq, "不应覆盖已有昵称");
  expect((await session(enabled, again)).user).toMatchObject({
    id: separate.id,
    displayName: "QQ 独立昵称",
  });
});
