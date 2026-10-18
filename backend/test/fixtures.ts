import { afterEach, expect } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import type { EmailMessage } from "../src/email";

let clientNumber = 50;
const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

export function fixture(
  seed = false,
  qqEmailLoginEnabled = false,
  academic: Pick<
    Parameters<typeof createApp>[0],
    "academicClientFactory" | "academicNow"
  > = {},
) {
  const db = createDatabase({ path: ":memory:", seedDemoUsers: seed });
  databases.push(db);
  const mail: EmailMessage[] = [];
  let mailFailure = false;
  const app = createApp({
    database: db,
    ...academic,
    demoAuthEnabled: seed,
    qqEmailLoginEnabled,
    sessionSecret: "integration-tests-secret-at-least-32-characters",
    allowedOrigins: ["http://localhost:5173"],
    sendEmail: async (message) => {
      if (mailFailure) throw new Error("simulated email failure");
      mail.push(message);
    },
  });
  const code = (email: string) => {
    const message = [...mail].reverse().find((item) => item.to === email);
    const otp = /验证码是 (\d{6})/.exec(message?.text ?? "")?.[1];
    if (!otp) throw new Error(`No captured OTP for ${email}`);
    return otp;
  };
  const client = () => {
    const ip = `198.51.100.${clientNumber++}`;
    let cookie = "";
    const request = async (path: string, method = "GET", data?: unknown) =>
      app.request(path, {
        method,
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
          "x-forwarded-for": ip,
          cookie,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const capture = (response: Response) => {
      cookie = response.headers
        .getSetCookie()
        .filter((value) => !value.includes("Max-Age=0"))
        .map((value) => value.split(";")[0])
        .join("; ");
    };
    const signIn = async (email: string) => {
      db.query("DELETE FROM auth_email_cooldowns").run();
      const send = await request(
        "/api/auth/email-otp/send-verification-otp",
        "POST",
        { email, type: "sign-in" },
      );
      expect(send.status).toBe(200);
      const response = await request("/api/auth/sign-in/email-otp", "POST", {
        email,
        otp: code(email),
        name: email.split("@")[0],
      });
      expect(response.status).toBe(200);
      capture(response);
      const state = (await (await request("/api/session")).json()) as {
        user: { id: string; role: string };
      };
      return state.user;
    };
    return { request, signIn, capture, cookie: () => cookie };
  };
  return {
    db,
    app,
    mail,
    code,
    client,
    failMail: (enabled = true) => {
      mailFailure = enabled;
    },
  };
}
