import { api, escapeHtml, jsonBody, showToast } from './api';

interface TestStatus {
  localTestMode: boolean;
  workerHeartbeat: string | null;
  identities: { name: string; email: string; role: string }[];
}
interface TestMail {
  recipient: string;
  subject: string;
  text: string;
  createdAt: string;
}

export async function initLocalTestTools(): Promise<void> {
  if (!import.meta.env.DEV) return;
  // Ordinary development and production have no testing routes.
  const response = await fetch('/api/testing/status').catch(() => null);
  if (!response?.ok) return;
  const state = (await response.json()) as TestStatus;
  if (!state.localTestMode) return;
  const tools = document.createElement('details');
  tools.dataset.localTestTools = '';
  tools.className =
    'fixed bottom-3 left-3 z-30 max-h-[70vh] w-[min(24rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-outline-variant bg-surface p-3 text-body-sm shadow-lg';
  tools.innerHTML = `<summary class="cursor-pointer font-semibold text-primary">本地测试工具</summary><p class="mt-3 text-xs text-outline">独立测试数据库 · 合成身份 · 邮件 worker ${state.workerHeartbeat && Date.parse(state.workerHeartbeat) > Date.now() - 10_000 ? '运行中' : '未检测到心跳'}</p><div class="mt-3 grid gap-2">${state.identities.map((identity, index) => `<button type="button" data-test-identity="${index}" class="rounded-lg border border-outline-variant px-3 py-2 text-left">${escapeHtml(identity.name)} · ${escapeHtml(identity.role)}</button>`).join('')}</div><p class="mt-3 text-xs text-outline">真实账号通过页眉校园邮箱入口验证。合成邮箱的验证码只在本机收件箱展示。</p><div class="mt-3 flex flex-wrap gap-2"><button type="button" data-test-inbox class="rounded-lg border border-outline-variant px-3 py-2">刷新本地收件箱</button><button type="button" data-test-reset class="rounded-lg border border-error/30 px-3 py-2 text-error">清空本地测试数据</button></div><div class="mt-3 space-y-3" data-test-mails></div>`;
  document.body.append(tools);
  tools
    .querySelectorAll<HTMLButtonElement>('[data-test-identity]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        const identity = state.identities[Number(button.dataset.testIdentity)];
        if (!identity) return;
        button.disabled = true;
        try {
          await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
          await api('/api/auth/logout', { method: 'POST' });
          await api('/api/auth/email-otp/send-verification-otp', {
            method: 'POST',
            body: jsonBody({ email: identity.email, type: 'sign-in' }),
          });
          const inbox = await api<{ items: TestMail[] }>(
            `/api/testing/inbox?recipient=${encodeURIComponent(identity.email)}`,
          );
          const otp = /验证码是 (\d{6})/.exec(inbox.items[0]?.text ?? '')?.[1];
          if (!otp) throw new Error('未找到本地测试验证码。');
          await api('/api/auth/sign-in/email-otp', {
            method: 'POST',
            body: jsonBody({ email: identity.email, otp, name: identity.name }),
          });
          window.location.reload();
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : '测试登录失败',
            'error',
          );
        } finally {
          button.disabled = false;
        }
      });
    });
  tools
    .querySelector('[data-test-inbox]')
    ?.addEventListener('click', async () => {
      try {
        const inbox = await api<{ items: TestMail[] }>('/api/testing/inbox');
        tools.querySelector('[data-test-mails]')!.innerHTML = inbox.items.length
          ? inbox.items
              .map(
                (mail) =>
                  `<article class="border-t border-surface-variant pt-3"><strong>${escapeHtml(mail.subject)}</strong><p class="mt-1 break-all text-xs text-outline">${escapeHtml(mail.recipient)} · ${escapeHtml(new Date(mail.createdAt).toLocaleTimeString('zh-CN'))}</p><p class="mt-2 whitespace-pre-line break-words text-xs">${escapeHtml(mail.text)}</p></article>`,
              )
              .join('')
          : '<p>本地收件箱为空。</p>';
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取失败', 'error');
      }
    });
  tools
    .querySelector('[data-test-reset]')
    ?.addEventListener('click', async () => {
      if (
        !window.confirm(
          '清空独立测试数据库的全部账号、内容和邮件？包括本机通过真实邮箱注册的测试账号。原开发数据库不受影响。',
        )
      )
        return;
      try {
        await api('/api/testing/reset', {
          method: 'POST',
          body: jsonBody({ confirmation: 'RESET_LOCAL_TEST_DATABASE' }),
        });
        window.location.href = './index.html';
      } catch (error) {
        showToast(error instanceof Error ? error.message : '重置失败', 'error');
      }
    });
}
