import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { AppDatabase } from "./db";
import {
  deliverCampusEmail,
  normalizeLoginEmail,
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
  qqEmailLoginEnabled?: boolean;
}

export function createAuth(options: AuthOptions) {
  const normalizeAllowedEmail = (value: string) =>
    normalizeLoginEmail(value, options.qqEmailLoginEnabled);
  const emailRequirement = "请填写有效的邮箱地址";
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
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
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
        "/sign-in/email": { window: 60, max: 5 },
        "/email-otp/request-password-reset": { window: 60, max: 3 },
        "/email-otp/reset-password": { window: 60, max: 5 },
        "/recovery-email/login/request": { window: 60, max: 3 },
        "/recovery-email/login/confirm": { window: 60, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email =
          typeof ctx.body?.email === "string"
            ? normalizeAllowedEmail(ctx.body.email)
            : null;
        const account = email
          ? (options.database
              .query(
                "SELECT a.emailVerified, u.account_status FROM auth_users a LEFT JOIN users u ON u.id = a.id WHERE a.email = ? COLLATE NOCASE",
              )
              .get(email) as {
              emailVerified: number;
              account_status: string | null;
            } | null)
          : null;
        if (
          account &&
          (!account.emailVerified ||
            ["banned", "deleting"].includes(account.account_status ?? ""))
        ) {
          // Match the hashing work done for an unknown account or a wrong password.
          await ctx.context.password.hash("invalid-credential-timing");
          throw new APIError("UNAUTHORIZED", {
            code: "INVALID_CREDENTIALS",
            message: "邮箱或密码不正确，或账号暂不可用。",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = normalizeAllowedEmail(user.email);
            if (!email) throw new Error(emailRequirement);
            if (user.emailVerified !== true) {
              throw new Error("请先完成邮箱验证");
            }
            return { data: { ...user, email } };
          },
        },
        update: {
          before: async (user) => {
            if (typeof user.email === "string") {
              const email = normalizeAllowedEmail(user.email);
              if (!email) throw new Error(emailRequirement);
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
        qqEmailLoginEnabled: options.qqEmailLoginEnabled,
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
          const email = normalizeAllowedEmail(value);
          if (!email) throw new Error(emailRequirement);
          const subject =
            type === "change-email"
              ? "深小狸：确认新的邮箱"
              : type === "email-verification"
                ? "深小狸：确认当前邮箱"
                : type === "forget-password"
                  ? "深小狸：设置登录密码验证码"
                  : "深小狸：邮箱登录验证码";
          const text = `你的验证码是 ${otp}，5 分钟内有效。${type === "sign-in" ? `本次验证将进入 ${email} 对应的账号；首次验证将自动创建账号。` : type === "forget-password" ? `你正在为 ${email} 对应的账号设置或重设登录密码。设置成功后，所有设备上的登录会话将失效，请重新登录。` : ""}请勿将验证码转发给他人。若非本人操作，请忽略此邮件。`;
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
