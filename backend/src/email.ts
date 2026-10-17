import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}
export type EmailSender = (message: EmailMessage) => Promise<string | void>;

export const CAMPUS_EMAIL_DOMAINS = [
  "stu.suat-sz.edu.cn",
  "suat-sz.edu.cn",
] as const;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

export function normalizeCampusEmail(value: string): string | null {
  const email = normalizeEmail(value);
  return email &&
    CAMPUS_EMAIL_DOMAINS.some((domain) => email.split("@")[1] === domain)
    ? email
    : null;
}

export async function deliverCampusEmail(
  message: EmailMessage,
  override?: EmailSender,
): Promise<string | undefined> {
  if (override) return (await override(message)) || undefined;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from)
    throw new Error("邮件服务未配置 RESEND_API_KEY 和 RESEND_FROM");
  const { data, error } = await new Resend(apiKey).emails.send(
    { from, to: [message.to], subject: message.subject, text: message.text },
    { idempotencyKey: message.idempotencyKey },
  );
  if (error) throw new Error(`邮件发送失败（${error.name}）：${error.message}`);
  return data?.id;
}
