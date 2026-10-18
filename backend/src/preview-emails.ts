import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderEmailHtml } from "./email-template";

const directory = resolve(import.meta.dir, "../../.local-test/mail-preview");
const samples = [
  {
    id: "password",
    label: "设置登录密码",
    subject: "设置登录密码验证码",
    text: "你的验证码是 123456，5 分钟内有效。你正在为 test.user.a@stu.suat-sz.edu.cn 对应的账号设置或重设登录密码。设置成功后，所有设备上的登录会话将失效，请重新登录。若非本人操作，请忽略此邮件。",
  },
  {
    id: "sign-in",
    label: "邮箱登录 / 注册",
    subject: "邮箱登录验证码",
    text: "你的验证码是 123456，5 分钟内有效。请勿将验证码转发给他人。若非本人操作，请忽略此邮件。",
  },
  {
    id: "campus-change",
    label: "更换校园邮箱",
    subject: "确认新的校园邮箱",
    text: "你的验证码是 123456，5 分钟内有效。请勿将验证码转发给他人。若非本人操作，请忽略此邮件。",
  },
  {
    id: "auxiliary-proof",
    label: "确认辅助邮箱设置",
    subject: "确认辅助邮箱设置",
    text: "校园账号：test.user.a@stu.suat-sz.edu.cn\n你的当前邮箱验证码是 123456，5 分钟内有效。本次操作将更新辅助邮箱设置，并使已有登录会话失效。若非本人操作，请忽略此邮件。",
  },
  {
    id: "auxiliary-new",
    label: "验证新辅助邮箱",
    subject: "验证新的辅助邮箱",
    text: "校园账号：test.user.a@stu.suat-sz.edu.cn\n你的新辅助邮箱验证码是 123456，5 分钟内有效。若非本人操作，请忽略此邮件。",
  },
  {
    id: "recovery",
    label: "找回原账号",
    subject: "账号找回验证码",
    text: "原账号：test.user.a@stu.suat-sz.edu.cn\n你的登录验证码是 123456，5 分钟内有效。验证后将回到上述原账号，不会创建辅助邮箱对应的账号。若非本人操作，请忽略此邮件。",
  },
  {
    id: "deletion",
    label: "账号注销",
    subject: "确认账号注销",
    text: "你的注销验证码是 123456，5 分钟内有效。提交后账号立即停用，身份资料将在 30 天后清理。若非本人操作，请忽略此邮件。",
  },
  {
    id: "notification",
    label: "站内消息通知",
    subject: "你有新的站内消息",
    text: "你有新的站内消息。请登录深小狸查看。\n\n为保护隐私，邮件不包含消息内容。",
  },
  {
    id: "test",
    label: "发信测试",
    subject: "Resend 发信测试",
    text: "如果你收到了这封邮件，说明本次邮件已到达你的邮箱。这是一封用于检查发件配置的测试邮件，不包含登录验证码，无需进行其他操作。",
  },
];

await mkdir(directory, { recursive: true });
for (const sample of samples)
  await writeFile(
    resolve(directory, `${sample.id}.html`),
    renderEmailHtml({
      subject: `深小狸：${sample.subject}`,
      text: sample.text,
    }),
  );

await writeFile(
  resolve(directory, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>邮件预览 · 深小狸</title><style>*{box-sizing:border-box}body{margin:0;background:#f9faf6;color:#1a1c1a;font-family:system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:32px 20px}h1{font-size:28px;color:#012d1d;margin:0 0 10px}p{color:#717973;line-height:1.7}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}button{font:inherit;background:white;border:1px solid #c1c8c2;border-radius:6px;padding:8px 12px;cursor:pointer;color:#012d1d}button[aria-pressed=true]{background:#012d1d;color:white;border-color:#012d1d}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:18px}.controls a{margin-left:auto;color:#2c694e}.viewer{overflow:auto}iframe{display:block;width:640px;max-width:100%;height:880px;margin:0 auto;border:1px solid #e2e6df;background:#f3f4ef}</style></head><body><main><h1>深小狸 · 邮件预览</h1><p>展示实际发送使用的 HTML 模板。全部内容为演示数据，验证码不会用于登录；此命令不发送邮件。</p><nav aria-label="邮件类型">${samples.map((sample, index) => `<button data-sample="${sample.id}" aria-pressed="${index === 0}">${sample.label}</button>`).join("")}</nav><div class="controls"><button data-width="640" aria-pressed="true">桌面</button><button data-width="375" aria-pressed="false">手机 375px</button><a id="full" href="sign-in.html" target="_blank">查看完整 HTML</a></div><div class="viewer"><iframe title="校园邮箱登录邮件" src="sign-in.html" sandbox="allow-same-origin"></iframe></div></main><script>const frame=document.querySelector('iframe');document.querySelectorAll('[data-sample]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-sample]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));frame.src=button.dataset.sample+'.html';frame.title=button.textContent+'邮件';document.querySelector('#full').href=frame.src;}));document.querySelectorAll('[data-width]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-width]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));frame.style.width=button.dataset.width+'px';}));</script></body></html>`,
);
console.info(`邮件预览：${resolve(directory, "index.html")}`);
