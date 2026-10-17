interface EmailContent {
  subject: string;
  text: string;
}

interface EmailPurpose {
  title: string;
  introduction: string;
  verification?: boolean;
  preferences?: boolean;
}

const purposes: Record<string, EmailPurpose> = {
  校园邮箱验证码: {
    title: "登录深小狸",
    introduction: "使用下方验证码验证校园邮箱并登录，首次登录将创建账号。",
    verification: true,
  },
  确认新的校园邮箱: {
    title: "确认更换校园邮箱",
    introduction: "请使用下方验证码完成本次校园邮箱验证。",
    verification: true,
  },
  确认当前校园邮箱: {
    title: "验证校园邮箱",
    introduction: "请使用下方验证码确认你仍能访问当前校园邮箱。",
    verification: true,
  },
  辅助邮箱登录验证码: {
    title: "欢迎回来",
    introduction: "你正在通过已绑定的辅助邮箱登录原来的深小狸账号。",
    verification: true,
  },
  确认辅助邮箱设置: {
    title: "确认辅助邮箱设置",
    introduction: "请使用当前邮箱收到的验证码，确认本次辅助邮箱设置。",
    verification: true,
  },
  验证新的辅助邮箱: {
    title: "验证辅助邮箱",
    introduction: "验证后，这个邮箱可帮助你在校园邮箱无法使用时登录原账号。",
    verification: true,
  },
  确认账号注销: {
    title: "确认注销账号",
    introduction: "请确认这是你本人发起的注销申请，再使用下方验证码继续。",
    verification: true,
  },
  你有新的站内消息: {
    title: "你有新的站内消息",
    introduction: "有新的联系或交流在等你，方便时回深小狸看看。",
    preferences: true,
  },
  "Resend 发信测试": {
    title: "这是一封测试邮件",
    introduction: "深小狸的邮件服务已发出本次测试。",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function renderEmailHtml(content: EmailContent): string {
  const subject = content.subject.replace(/^深小狸(?:校园|平台)?[：:]\s*/, "");
  const purpose = Object.hasOwn(purposes, subject)
    ? purposes[subject]
    : { title: subject, introduction: "" };
  const code = purpose.verification
    ? /验证码是\s*(\d{6})(?!\d)/.exec(content.text)?.[1]
    : undefined;
  const account = /^校园账号：([^\n]+)$/m.exec(content.text)?.[1];
  let detail = content.text;
  if (subject === "你有新的站内消息")
    detail = detail.replace(/^你有新的站内消息。请登录深小狸查看。\s*/, "");
  if (account) detail = detail.replace(/^校园账号：[^\n]+\n?/m, "");
  if (code)
    detail = detail.replace(
      /你的(?:注销|当前邮箱|新辅助邮箱|登录)?验证码是\s*\d{6}[，,]\s*5\s*分钟内有效[。.]?/,
      "",
    );
  // The security note is rendered once, below the code and action details.
  if (purpose.verification)
    detail = detail
      .replace("请勿将验证码转发给他人。", "")
      .replace("若非本人操作，请忽略此邮件。", "");
  const paragraphs = detail
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;color:#414844;font-size:15px;line-height:1.8;overflow-wrap:anywhere;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(purpose.title)} · 深小狸</title></head>
<body style="margin:0;padding:0;background-color:#f3f4ef;color:#1a1c1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(purpose.introduction || purpose.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4ef;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;text-align:left;">
<tr><td style="padding:0 8px 22px;color:#012d1d;font-size:24px;font-weight:700;letter-spacing:1px;">深小狸</td></tr>
<tr><td style="padding:32px 24px;background-color:#ffffff;border:1px solid #e2e6df;border-top:3px solid #1b4332;border-radius:12px;">
<h1 style="margin:0 0 14px;color:#012d1d;font-size:26px;font-weight:650;line-height:1.4;">${escapeHtml(purpose.title)}</h1>
${purpose.introduction ? `<p style="margin:0 0 24px;color:#414844;font-size:15px;line-height:1.8;">${escapeHtml(purpose.introduction)}</p>` : ""}
${account ? `<p style="margin:0 0 20px;color:#717973;font-size:13px;line-height:1.7;overflow-wrap:anywhere;">校园账号<br><span style="color:#414844;">${escapeHtml(account)}</span></p>` : ""}
${code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:#f3f6f1;border:1px solid #e2e6df;border-radius:8px;"><tr><td align="center" style="padding:22px 12px;"><p style="margin:0 0 10px;color:#717973;font-size:12px;">验证码</p><p dir="ltr" translate="no" data-verification-code style="margin:0;color:#012d1d;font-family:Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:8px;line-height:1.3;">${code}</p><p style="margin:12px 0 0;color:#717973;font-size:12px;line-height:1.6;">5 分钟内有效 · 仅限本次操作</p></td></tr></table>` : ""}
${paragraphs}
${purpose.verification ? '<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #eeeeeb;color:#717973;font-size:12px;line-height:1.8;">请勿向任何人透露或转发验证码。如果不是你本人操作，请忽略这封邮件。</p>' : ""}
</td></tr>
<tr><td style="padding:20px 8px 0;color:#717973;font-size:12px;line-height:1.8;">深小狸 · 学生共建的校园社区<br>${purpose.preferences ? "邮件通知偏好可在「个人中心 → 账号设置」修改。<br>" : ""}这是一封系统邮件，请勿直接回复。</td></tr>
</table></td></tr></table>
</body></html>`;
}
