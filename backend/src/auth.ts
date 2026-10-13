import { Resend } from "resend";
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import type { AppDatabase } from "./db";

export const CAMPUS_EMAIL_DOMAINS = [
  "stu.suat-sz.edu.cn",
  "suat-sz.edu.cn",
] as const;

export function normalizeCampusEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email);
  if (!match) return null;
  return CAMPUS_EMAIL_DOMAINS.some((domain) => match[1] === domain)
    ? email
    : null;
}

export async function deliverCampusEmail(
  message: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  },
  override?: AuthOptions["sendEmail"],
): Promise<void> {
  if (override) return override(message);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from)
    throw new Error("邮件服务未配置 RESEND_API_KEY 和 RESEND_FROM");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send(
    { from, to: [message.to], subject: message.subject, text: message.text },
    { idempotencyKey: message.idempotencyKey },
  );
  if (error) throw new Error("邮件发送失败");
}

interface AuthOptions {
  database: AppDatabase;
  production?: boolean;
  secret?: string;
  trustedOrigins?: string[];
  sendEmail?: (message: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<void>;
}

export function createAuth(options: AuthOptions) {
  const origin = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8787";
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
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = normalizeCampusEmail(user.email);
            if (!email) throw new Error("仅支持 SUAT 校园邮箱注册");
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
