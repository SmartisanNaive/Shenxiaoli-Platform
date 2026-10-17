import { randomUUID } from "node:crypto";
import { normalizeEmail, deliverCampusEmail } from "./email";

const email = normalizeEmail(process.env.MAIL_TEST_TO ?? "");
if (!email)
  throw new Error("Configure MAIL_TEST_TO before testing email delivery");

const id = await deliverCampusEmail({
  to: email,
  subject: "深小狸：Resend 发信测试",
  text: "如果你收到了这封邮件，说明本次邮件已到达你的邮箱。这是一封用于检查发件配置的测试邮件，不包含登录验证码，无需进行其他操作。",
  idempotencyKey: `mail-test/${randomUUID()}`,
});
if (!id) throw new Error("Resend did not return a message ID");
console.info(JSON.stringify({ status: "accepted", id, to: email }));
