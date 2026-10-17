import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import type { AppDatabase } from "./db";
import {
  deliverCampusEmail,
  normalizeCampusEmail,
  type EmailSender,
} from "./email";
import { recoveryEmailPlugin } from "./recovery";
export { deliverCampusEmail, normalizeCampusEmail } from "./email";

interface AuthOptions {
  database: AppDatabase;
  baseURL?: string;
  production?: boolean;
  secret?: string;
  trustedOrigins?: string[];
  sendEmail?: EmailSender;
}

export function createAuth(options: AuthOptions) {
  const origin =
    options.baseURL ??
    (process.env.BETTER_AUTH_URL?.trim() || "http://127.0.0.1:8787");
  return betterAuth({
    database: options.database,
    baseURL: origin,
    secret: options.secret ?? process.env.SESSION_SECRET ?? undefined,
    trustedOrigins: options.trustedOrigins ?? [],
    user: { modelName: "auth_users" },
    session: { modelName: "auth_sessions" },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    emailAndPassword: { enabled: false },
    advanced: {
      useSecureCookies: Boolean(options.production),
      cookiePrefix: "shenxiaoli",
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
        "/recovery-email/login/request": { window: 60, max: 3 },
        "/recovery-email/login/confirm": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = normalizeCampusEmail(user.email);
            if (!email) throw new Error("仅支持 SUAT 校园邮箱");
            if (user.emailVerified !== true) {
              throw new Error("请先完成校园邮箱验证");
            }
            return { data: { ...user, email } };
          },
        },
        update: {
          before: async (user) => {
            if (typeof user.email === "string") {
              const email = normalizeCampusEmail(user.email);
              if (!email) throw new Error("仅支持 SUAT 校园邮箱");
              return { data: { ...user, email } };
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      recoveryEmailPlugin({
        database: options.database,
        secret:
          options.secret ??
          process.env.SESSION_SECRET ??
          "local-development-only-secret",
        sendEmail: async (message) =>
          deliverCampusEmail(message, options.sendEmail),
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        changeEmail: { enabled: true, verifyCurrentEmail: true },
        sendVerificationOTP: async ({ email: value, otp, type }) => {
          const email = normalizeCampusEmail(value);
          if (!email) throw new Error("仅支持 SUAT 校园邮箱");
          const subject =
            type === "change-email"
              ? "深小狸校园：确认新的校园邮箱"
              : "深小狸校园：校园邮箱验证码";
          const text = `你的验证码是 ${otp}，5 分钟内有效。请勿将验证码转发给他人。若非本人操作，请忽略此邮件。`;
          const codeHash = createHash("sha256")
            .update(`${email}:${otp}`)
            .digest("hex");
          const key = `email-otp/${type}/${codeHash}`;
          await deliverCampusEmail(
            { to: email, subject, text, idempotencyKey: key },
            options.sendEmail,
          );
        },
      }),
    ],
  });
}
