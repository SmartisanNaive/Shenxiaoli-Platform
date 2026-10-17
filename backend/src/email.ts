import { Resend } from "resend";
import { renderEmailHtml } from "./email-template";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
  const subject = message.subject.replace(
    /^深小狸(?:校园|平台)?[：:]\s*/,
    "深小狸：",
  );
  const text = message.text.replace(/深小狸(?:校园|平台)/g, "深小狸");
  const formatted = {
    ...message,
    subject,
    text,
    html: renderEmailHtml({ subject, text }),
  };
  if (override) return (await override(formatted)) || undefined;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from)
    throw new Error("邮件服务未配置 RESEND_API_KEY 和 RESEND_FROM");
  const { data, error } = await new Resend(apiKey).emails.send(
    {
      from: brandedEmailSender(from),
      to: [formatted.to],
      subject: formatted.subject,
      text: formatted.text,
      html: formatted.html,
    },
    { idempotencyKey: message.idempotencyKey },
  );
  if (error) throw new Error(`邮件发送失败（${error.name}）：${error.message}`);
  return data?.id;
}

export function brandedEmailSender(from: string): string {
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from.trim();
  return `深小狸 <${address}>`;
}
