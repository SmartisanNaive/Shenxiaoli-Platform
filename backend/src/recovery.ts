import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import type { AppDatabase } from "./db";
import { normalizeLoginEmail, normalizeEmail, type EmailSender } from "./email";

interface Account {
  id: string;
  email: string;
  emailVerified: number;
  account_status: string;
}
interface Binding {
  email: string;
  verified_at: string;
}
interface Challenge {
  id: string;
  user_id: string;
  purpose: "bind" | "unbind" | "login";
  campus_email: string;
  proof_method: "campus" | "auxiliary";
  proof_email: string;
  new_email: string | null;
  code_hash: string;
  new_code_hash: string | null;
  attempts: number;
  expires_at: number;
}

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_INPUT",
      message: "请求格式不正确",
    });
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function invalidCode(): never {
  throw new APIError("BAD_REQUEST", {
    code: "INVALID_OTP",
    message: "验证码无效、已过期或尝试次数过多",
  });
}

export function recoveryEmailPlugin(options: {
  database: AppDatabase;
  secret: string;
  sendEmail: EmailSender;
  qqEmailLoginEnabled?: boolean;
}): BetterAuthPlugin {
  const db = options.database;
  const normalizeAllowedEmail = (value: string) =>
    normalizeLoginEmail(value, options.qqEmailLoginEnabled);
  const binding = (id: string) =>
    db
      .query("SELECT email, verified_at FROM recovery_emails WHERE user_id = ?")
      .get(id) as Binding | null;
  const account = (id?: string) =>
    id
      ? (db
          .query(
            "SELECT a.id, a.email, a.emailVerified, u.account_status FROM auth_users a JOIN users u ON u.id = a.id WHERE a.id = ?",
          )
          .get(id) as Account | null)
      : null;
  const usable = (value: Account | null): value is Account =>
    Boolean(
      value?.emailVerified &&
      normalizeAllowedEmail(value.email) &&
      !["banned", "deleting"].includes(value.account_status),
    );
  const requireAccount = (id?: string): Account => {
    const value = account(id);
    if (!usable(value))
      throw new APIError("UNAUTHORIZED", {
        code: "VERIFIED_ACCOUNT_REQUIRED",
        message: "请使用已验证且可用的校园账号登录",
      });
    return value;
  };
  const hash = (
    challenge: Pick<Challenge, "id" | "purpose">,
    target: string,
    otp: string,
  ) =>
    createHmac("sha256", options.secret)
      .update(`${challenge.id}:${challenge.purpose}:${target}:${otp}`)
      .digest("hex");
  const matches = (expected: string, actual: string) =>
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  const cooldown = (subject: string) => {
    const key = createHmac("sha256", options.secret)
      .update(subject)
      .digest("hex");
    const changed = db
      .query(
        "INSERT INTO recovery_email_cooldowns (subject_hash, last_sent_at) VALUES (?, ?) ON CONFLICT(subject_hash) DO UPDATE SET last_sent_at = excluded.last_sent_at WHERE recovery_email_cooldowns.last_sent_at <= ?",
      )
      .run(key, Date.now(), Date.now() - 60_000);
    if (!changed.changes)
      throw new APIError("TOO_MANY_REQUESTS", {
        code: "OTP_COOLDOWN",
        message: "请等待 60 秒后再申请验证码",
      });
    return key;
  };
  const issue = async (
    value: Account,
    purpose: Challenge["purpose"],
    method: Challenge["proof_method"],
    newEmail: string | null,
    id: string,
  ) => {
    const proofEmail =
      method === "campus" ? value.email : binding(value.id)?.email;
    if (!proofEmail)
      throw new APIError("BAD_REQUEST", {
        code: "AUXILIARY_EMAIL_REQUIRED",
        message: "尚未绑定辅助邮箱，请验证校园邮箱",
      });
    const otp = String(randomInt(100000, 1_000_000));
    const newOtp = newEmail ? String(randomInt(100000, 1_000_000)) : null;
    const challenge = { id, purpose };
    const now = Date.now();
    db.query(
      "DELETE FROM recovery_challenges WHERE user_id = ? AND purpose = ?",
    ).run(value.id, purpose);
    db.query(
      "INSERT INTO recovery_challenges (id, user_id, purpose, campus_email, proof_method, proof_email, new_email, code_hash, new_code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run(
      id,
      value.id,
      purpose,
      value.email,
      method,
      proofEmail,
      newEmail,
      hash(challenge, proofEmail, otp),
      newEmail && newOtp ? hash(challenge, newEmail, newOtp) : null,
      now + 300_000,
      now,
    );
    try {
      await options.sendEmail({
        to: proofEmail,
        subject:
          purpose === "login"
            ? "深小狸：账号找回验证码"
            : "深小狸：确认辅助邮箱设置",
        text: `原账号：${value.email}\n你的${purpose === "login" ? "登录" : "当前邮箱"}验证码是 ${otp}，5 分钟内有效。${purpose === "login" ? "你正在通过事先绑定的辅助邮箱找回该账号。验证后将进入上述原账号，不会创建辅助邮箱对应的账号。" : "本次操作将更新辅助邮箱设置，并使已有登录会话失效。"}若非本人操作，请忽略此邮件。`,
        idempotencyKey: `recovery/${id}/current`,
      });
      if (newEmail && newOtp)
        await options.sendEmail({
          to: newEmail,
          subject: "深小狸：验证新的辅助邮箱",
          text: `校园账号：${value.email}\n你的新辅助邮箱验证码是 ${newOtp}，5 分钟内有效。若非本人操作，请忽略此邮件。`,
          idempotencyKey: `recovery/${id}/new`,
        });
    } catch {
      db.query("DELETE FROM recovery_challenges WHERE id = ?").run(id);
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "EMAIL_UNAVAILABLE",
        message: "邮件发送失败，请检查邮箱地址或稍后重试",
      });
    }
  };
  const revoke = (id: string) => {
    db.query("DELETE FROM recovery_challenges WHERE user_id = ?").run(id);
    db.query("DELETE FROM auth_sessions WHERE userId = ?").run(id);
    db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
  };
  const consume = (
    id: string,
    purpose: Challenge["purpose"],
    userId: string | null,
    campusEmail: string | null,
    otp: string,
    newOtp?: string,
  ): Account => {
    const result = db.transaction(() => {
      const row = db
        .query("SELECT * FROM recovery_challenges WHERE id = ? AND purpose = ?")
        .get(id, purpose) as Challenge | null;
      if (
        !row ||
        (userId && row.user_id !== userId) ||
        (campusEmail && row.campus_email !== campusEmail)
      )
        return null;
      const value = account(row.user_id);
      if (
        row.expires_at <= Date.now() ||
        row.attempts >= 5 ||
        !usable(value) ||
        row.campus_email !== value.email ||
        (row.proof_method === "auxiliary" &&
          binding(row.user_id)?.email !== row.proof_email)
      ) {
        db.query("DELETE FROM recovery_challenges WHERE id = ?").run(id);
        return null;
      }
      if (
        !/^\d{6}$/.test(otp) ||
        !matches(row.code_hash, hash(row, row.proof_email, otp)) ||
        (row.new_email &&
          (!newOtp ||
            !/^\d{6}$/.test(newOtp) ||
            !row.new_code_hash ||
            !matches(row.new_code_hash, hash(row, row.new_email, newOtp))))
      ) {
        db.query(
          "UPDATE recovery_challenges SET attempts = attempts + 1 WHERE id = ?",
        ).run(id);
        return null;
      }
      db.query("DELETE FROM recovery_challenges WHERE id = ?").run(id);
      if (purpose === "bind" && row.new_email) {
        db.query(
          "INSERT INTO recovery_emails (user_id, email, verified_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at",
        ).run(value.id, row.new_email, new Date().toISOString());
        revoke(value.id);
      } else if (purpose === "unbind") {
        db.query("DELETE FROM recovery_emails WHERE user_id = ?").run(value.id);
        revoke(value.id);
      }
      return value;
    })();
    if (!result) invalidCode();
    return result;
  };
  return {
    id: "recovery-email",
    endpoints: {
      recoveryEmailStatus: createAuthEndpoint(
        "/recovery-email",
        { method: "GET" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const value = requireAccount(session?.user.id);
          const saved = binding(value.id);
          return ctx.json({
            email: saved?.email ?? null,
            verifiedAt: saved?.verified_at ?? null,
          });
        },
      ),
      requestRecoveryEmailChange: createAuthEndpoint(
        "/recovery-email/change/request",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const value = requireAccount(session?.user.id);
          const input = body(ctx.body);
          const newEmail = normalizeEmail(text(input.email));
          if (
            !newEmail ||
            newEmail === value.email ||
            newEmail === binding(value.id)?.email
          )
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_EMAIL",
              message: "请填写与当前邮箱不同的有效辅助邮箱",
            });
          const method = input.method === "auxiliary" ? "auxiliary" : "campus";
          if (method === "auxiliary" && !binding(value.id))
            throw new APIError("BAD_REQUEST", {
              message: "首次绑定需验证校园邮箱",
            });
          cooldown(`manage:${value.id}`);
          const challengeId = randomUUID();
          await issue(value, "bind", method, newEmail, challengeId);
          return ctx.json({ challengeId, expiresIn: 300 });
        },
      ),
      confirmRecoveryEmailChange: createAuthEndpoint(
        "/recovery-email/change/confirm",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const value = requireAccount(session?.user.id);
          const input = body(ctx.body);
          consume(
            text(input.challengeId),
            "bind",
            value.id,
            null,
            text(input.currentOtp),
            text(input.newOtp),
          );
          deleteSessionCookie(ctx);
          return ctx.json({ ok: true, signInRequired: true });
        },
      ),
      requestRecoveryEmailRemoval: createAuthEndpoint(
        "/recovery-email/remove/request",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const value = requireAccount(session?.user.id);
          if (!binding(value.id))
            throw new APIError("BAD_REQUEST", { message: "尚未绑定辅助邮箱" });
          const input = body(ctx.body);
          cooldown(`manage:${value.id}`);
          const challengeId = randomUUID();
          await issue(
            value,
            "unbind",
            input.method === "auxiliary" ? "auxiliary" : "campus",
            null,
            challengeId,
          );
          return ctx.json({ challengeId, expiresIn: 300 });
        },
      ),
      confirmRecoveryEmailRemoval: createAuthEndpoint(
        "/recovery-email/remove/confirm",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const value = requireAccount(session?.user.id);
          const input = body(ctx.body);
          consume(
            text(input.challengeId),
            "unbind",
            value.id,
            null,
            text(input.otp),
          );
          deleteSessionCookie(ctx);
          return ctx.json({ ok: true, signInRequired: true });
        },
      ),
      requestRecoveryLogin: createAuthEndpoint(
        "/recovery-email/login/request",
        { method: "POST" },
        async (ctx) => {
          const input = body(ctx.body);
          const email = normalizeAllowedEmail(text(input.email));
          if (!email)
            throw new APIError("BAD_REQUEST", {
              code: "CAMPUS_EMAIL_REQUIRED",
              message: "请填写注册时的账号邮箱",
            });
          cooldown(`login:${email}`);
          const challengeId = randomUUID();
          const row = db
            .query("SELECT id FROM auth_users WHERE email = ? COLLATE NOCASE")
            .get(email) as { id: string } | null;
          const value = account(row?.id);
          if (usable(value) && binding(value.id))
            await issue(value, "login", "auxiliary", null, challengeId);
          // Keep unknown, unbound and restricted accounts indistinguishable.
          return ctx.json({ challengeId, expiresIn: 300 });
        },
      ),
      confirmRecoveryLogin: createAuthEndpoint(
        "/recovery-email/login/confirm",
        { method: "POST" },
        async (ctx) => {
          const input = body(ctx.body);
          const email = normalizeAllowedEmail(text(input.email));
          if (!email) invalidCode();
          const value = consume(
            text(input.challengeId),
            "login",
            null,
            email,
            text(input.otp),
          );
          const user = await ctx.context.internalAdapter.findUserByEmail(
            value.email,
          );
          if (!user?.user.emailVerified) invalidCode();
          const session = await ctx.context.internalAdapter.createSession(
            value.id,
          );
          if (!session)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "无法建立登录会话",
            });
          await setSessionCookie(ctx, { session, user: user.user });
          return ctx.json({ ok: true });
        },
      ),
    },
  };
}
