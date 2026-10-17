import { randomUUID } from "node:crypto";
import { normalizeEmail, deliverCampusEmail } from "./email";

const email = normalizeEmail(process.env.MAIL_TEST_TO ?? "");
if (!email)
  throw new Error("Configure MAIL_TEST_TO before testing email delivery");

const id = await deliverCampusEmail({
  to: email,
  subject: "深小狸校园：Resend 发信测试",
  text: "这是一封深小狸校园服务的测试邮件，用于确认 Resend 发件配置可以向管理员邮箱发送邮件。若你收到此邮件，说明本次测试邮件已到达。此邮件不包含登录验证码，无需回复。",
  idempotencyKey: `mail-test/${randomUUID()}`,
});
if (!id) throw new Error("Resend did not return a message ID");
console.info(JSON.stringify({ status: "accepted", id, to: email }));
