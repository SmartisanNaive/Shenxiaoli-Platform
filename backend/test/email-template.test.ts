import { expect, test } from "bun:test";
import {
  brandedEmailSender,
  deliverCampusEmail,
  type EmailMessage,
} from "../src/email";
import { renderEmailHtml } from "../src/email-template";

test("verification emails highlight one code, preserve action details, and do not expose codes in the preheader", () => {
  for (const purpose of [
    "校园邮箱验证码",
    "确认当前校园邮箱",
    "确认新的校园邮箱",
    "辅助邮箱登录验证码",
    "确认辅助邮箱设置",
    "验证新的辅助邮箱",
    "确认账号注销",
  ]) {
    const html = renderEmailHtml({
      subject: `深小狸：${purpose}`,
      text: "校园账号：test.user.a@stu.suat-sz.edu.cn\n你的验证码是 123456，5 分钟内有效。提交后账号立即停用，身份资料将在 30 天后清理。若非本人操作，请忽略此邮件。",
    });
    expect(html.match(/123456/g)).toHaveLength(1);
    expect(html).toContain("data-verification-code");
    expect(html).toContain("5 分钟内有效");
    expect(html).toContain("30 天后清理");
    expect(html).toContain("test.user.a@stu.suat-sz.edu.cn");
    expect(html).toContain("请勿向任何人透露或转发验证码");
    expect(/<div[^>]*>[^<]*123456/.test(html)).toBe(false);
    expect(html).not.toMatch(/<script|<img|https?:\/\//);
  }
});

test("notification content is escaped and cannot inject markup or a verification block", () => {
  const html = renderEmailHtml({
    subject: '深小狸：<img src=x onerror="alert(1)">',
    text: '请查看 <script>alert(1)</script> & "详情"\n验证码是 123456',
  });
  expect(html).toContain("&lt;img");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&amp;");
  expect(html).not.toMatch(/<script|<img|data-verification-code/);
  const notification = renderEmailHtml({
    subject: "深小狸：你有新的站内消息",
    text: "邮件不包含消息内容。",
  });
  expect(notification).toContain("个人中心 → 账号设置");
  expect(notification).toContain("邮件不包含消息内容");
  expect(notification).not.toContain("data-verification-code");
  for (const subject of ["__proto__", "constructor"])
    expect(renderEmailHtml({ subject, text: "请登录查看详情。" })).toContain(
      subject,
    );
});

test("the common delivery path supplies HTML and plain text to test senders and normalizes legacy queued branding", async () => {
  const mail: EmailMessage[] = [];
  const id = await deliverCampusEmail(
    {
      to: "test.user.a@stu.suat-sz.edu.cn",
      subject: "深小狸校园：你有新的站内消息",
      text: "请登录深小狸校园查看。",
      idempotencyKey: "template/notification",
    },
    async (message) => {
      mail.push(message);
      return "accepted";
    },
  );
  expect(id).toBe("accepted");
  expect(mail[0].subject).toBe("深小狸：你有新的站内消息");
  expect(mail[0].text).toBe("请登录深小狸查看。");
  expect(mail[0].html).toContain("你有新的站内消息");
  expect(mail[0].html).not.toContain("深小狸校园");
  expect(mail[0].idempotencyKey).toBe("template/notification");
  expect(brandedEmailSender("旧发件人 <notice@example.test>")).toBe(
    "深小狸 <notice@example.test>",
  );
  expect(brandedEmailSender(" notice@example.test ")).toBe(
    "深小狸 <notice@example.test>",
  );
});

test("Resend receives the branded sender and both representations with the original idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM = "旧名称 <notice@example.test>";
  let payload: Record<string, unknown> | undefined;
  const idempotency: (string | null)[] = [];
  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    idempotency.push(new Headers(init?.headers).get("idempotency-key"));
    return new Response(JSON.stringify({ id: "provider-test-id" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const id = await deliverCampusEmail({
      to: "test.user.a@stu.suat-sz.edu.cn",
      subject: "深小狸：校园邮箱验证码",
      text: "你的验证码是 654321，5 分钟内有效。",
      idempotencyKey: "template/provider",
    });
    expect(id).toBe("provider-test-id");
    expect(payload?.from).toBe("深小狸 <notice@example.test>");
    expect(payload?.text).toBe("你的验证码是 654321，5 分钟内有效。");
    expect(payload?.html).toContain("data-verification-code");
    expect(payload?.html).toContain("654321");
    expect(idempotency).toEqual(["template/provider"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = previousFrom;
  }
});
