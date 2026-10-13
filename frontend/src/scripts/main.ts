import {
  api,
  escapeHtml,
  type SearchResult,
  type SessionState,
  jsonBody,
  showToast,
} from './api';
import { initHome } from './home';
import { initCourses } from './courses';
import { initMarket } from './market';
import { initSkills } from './skills';
import { initTreeHole } from './tree-hole';
import { initModeration } from './moderation';
import { authClient } from './auth-client';
import { initAccount } from './account';
import { initInformation } from './information';
import { initSearch } from './search';

declare global {
  interface Window {
    openPublishModal?: () => void;
    closePublishModal?: () => void;
    openSkillPublishModal?: () => void;
    closeSkillPublishModal?: () => void;
    openReviewModal?: () => void;

    filterCategory?: (category: string, button: HTMLElement) => void;
    handlePublish?: (event: Event) => void;
    handleSkillPublish?: (event: Event) => void;
    openDetailModal?: (
      listing: HTMLElement,
      data: Record<string, string>,
    ) => void;
    closeDetailModal?: () => void;
    contactSeller?: () => void;
  }
}

const routeFor = (result: SearchResult): string => {
  if (result.type === 'course')
    return `./course-evaluation.html?course=${encodeURIComponent(result.id)}`;
  if (result.type === 'listing')
    return `./market.html?listing=${encodeURIComponent(result.id)}`;
  if (result.type === 'tree-hole')
    return `./tree-hole.html?post=${encodeURIComponent(result.id)}`;
  return `./skill-mutual-aid.html?skill=${encodeURIComponent(result.id)}`;
};

const labelFor = (type: SearchResult['type']): string => {
  const labels: Record<SearchResult['type'], string> = {
    course: '课程',
    listing: '集市',
    skill: '技能互助',
    'tree-hole': '树洞',
  };
  return labels[type];
};

function updateFooterYear(): void {
  const year = String(new Date().getFullYear());
  document
    .querySelectorAll<HTMLElement>('[data-current-year]')
    .forEach((element) => {
      element.textContent = year;
    });
}

function initToast(): void {
  const container = document.createElement('div');
  container.className =
    'fixed bottom-5 right-5 z-[100] flex max-w-sm flex-col gap-2';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  document.body.append(container);
  document.addEventListener('shenxiaoli:toast', (event) => {
    const detail = (event as CustomEvent<{ message: string; tone: string }>)
      .detail;
    if (!detail?.message) return;
    const toast = document.createElement('div');
    const toneClass =
      detail.tone === 'error'
        ? 'border-error/30 bg-error-container text-on-error-container'
        : detail.tone === 'success'
          ? 'border-secondary/30 bg-secondary-container text-on-secondary-container'
          : 'border-outline-variant bg-surface text-on-surface';
    toast.className = `rounded-xl border px-4 py-3 text-body-sm shadow-lg ${toneClass}`;
    toast.textContent = detail.message;
    container.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error instanceof Error) showToast(error.message, 'error');
  });
}

function authWidget(): void {
  const root = document.querySelector<HTMLElement>('[data-auth-widget]');
  if (!root) return;
  const toggle = root.querySelector<HTMLButtonElement>('[data-auth-toggle]');
  const panel = root.querySelector<HTMLElement>('[data-auth-panel]');
  const label = root.querySelector<HTMLElement>('[data-auth-label]');
  const message = root.querySelector<HTMLElement>('[data-auth-message]');
  const loginOptions = root.querySelector<HTMLElement>(
    '[data-demo-login-options]',
  );
  const adminLink = root.querySelector<HTMLAnchorElement>('[data-admin-link]');
  const logout = root.querySelector<HTMLButtonElement>('[data-auth-logout]');
  const emailForm = root.querySelector<HTMLFormElement>('[data-email-login]');
  const emailInput = root.querySelector<HTMLInputElement>('[data-login-email]');
  const nameInput = root.querySelector<HTMLInputElement>('[data-login-name]');
  const otpInput = root.querySelector<HTMLInputElement>('[data-login-otp]');
  const nameField = root.querySelector<HTMLElement>('[data-login-name-field]');
  const otpField = root.querySelector<HTMLElement>('[data-login-otp-field]');
  const sendButton = root.querySelector<HTMLButtonElement>('[data-login-send]');
  const verifyButton = root.querySelector<HTMLButtonElement>(
    '[data-login-verify]',
  );
  let pendingEmail = '';

  const close = (): void => {
    panel?.classList.add('hidden');
    toggle?.setAttribute('aria-expanded', 'false');
  };
  const render = (state: SessionState): void => {
    if (label) label.textContent = state.user?.displayName ?? '未登录';
    if (message) {
      message.textContent = state.user
        ? `${state.user.displayName} · ${state.campusEmailVerified ? '校园邮箱已验证' : state.user.role === 'moderator' ? '本地审核员演示身份' : '本地演示身份'}`
        : state.demoAuthAvailable
          ? '使用校园邮箱验证码登录；也可选择本地演示身份。'
          : '使用 SUAT 校园邮箱验证码登录。';
    }
    if (emailForm) emailForm.hidden = Boolean(state.authenticated);
    if (loginOptions)
      loginOptions.hidden =
        Boolean(state.authenticated) || !state.demoAuthAvailable;
    if (adminLink) {
      const canModerate =
        state.user?.role === 'moderator' || state.user?.role === 'admin';
      adminLink.classList.toggle('hidden', !canModerate);
      adminLink.classList.toggle('block', canModerate);
    }
    logout?.classList.toggle('hidden', !state.authenticated);
  };

  toggle?.addEventListener('click', () => {
    const opening = panel?.classList.contains('hidden') ?? false;
    panel?.classList.toggle('hidden', !opening);
    toggle.setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  root
    .querySelectorAll<HTMLButtonElement>('[data-demo-login]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const role =
            button.dataset.demoLogin === 'moderator' ? 'moderator' : 'student';
          await api('/api/auth/demo', {
            method: 'POST',
            body: jsonBody({ role }),
          });
          const state = await api<SessionState>('/api/session');
          render(state);
          close();
          showToast('本地演示身份已登录。', 'success');
          window.dispatchEvent(
            new CustomEvent('shenxiaoli:session-changed', { detail: state }),
          );
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : '登录失败，请先启动 API',
            'error',
          );
        } finally {
          button.disabled = false;
        }
      });
    });
  logout?.addEventListener('click', async () => {
    try {
      await authClient.signOut();
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      const state = await api<SessionState>('/api/session');
      render(state);
      close();
      window.dispatchEvent(
        new CustomEvent('shenxiaoli:session-changed', { detail: state }),
      );
      showToast('已退出登录。', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '退出登录失败',
        'error',
      );
    }
  });
  emailForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!emailInput || !sendButton) return;
    const email = emailInput.value.trim().toLowerCase();
    pendingEmail = email;
    sendButton.disabled = true;
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      });
      if (result.error)
        throw new Error(result.error.message || '验证码发送失败');
      nameField?.classList.remove('hidden');
      otpField?.classList.remove('hidden');
      verifyButton?.classList.remove('hidden');
      sendButton.textContent = '重新发送验证码';
      showToast('如果邮箱符合校园域名要求，验证码已发送。', 'success');
      otpInput?.focus();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '验证码发送失败',
        'error',
      );
    } finally {
      sendButton.disabled = false;
    }
  });
  verifyButton?.addEventListener('click', async () => {
    if (!otpInput || !pendingEmail) return;
    verifyButton.disabled = true;
    try {
      const result = await authClient.signIn.emailOtp({
        email: pendingEmail,
        otp: otpInput.value.trim(),
        name:
          nameInput?.value.trim() || pendingEmail.split('@')[0] || '校园同学',
      });
      if (result.error) throw new Error(result.error.message || '验证码无效');
      const state = await api<SessionState>('/api/session');
      if (!state.authenticated || !state.campusEmailVerified)
        throw new Error('校园邮箱验证尚未完成，请重新登录。');
      render(state);
      close();
      showToast('校园邮箱已验证，登录成功。', 'success');
      window.dispatchEvent(
        new CustomEvent('shenxiaoli:session-changed', { detail: state }),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '登录失败', 'error');
    } finally {
      verifyButton.disabled = false;
    }
  });
  api<SessionState>('/api/session')
    .then(render)
    .catch(() => {
      if (message) message.textContent = 'API 尚未连接；请先启动后端服务。';
    });
}

function searchResults(): void {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="text"][placeholder*="搜索"]',
  );
  inputs.forEach((input) => {
    const wrapper = input.parentElement;
    if (!wrapper) return;
    wrapper.classList.add('relative');
    const dropdown = document.createElement('div');
    dropdown.className =
      'absolute left-0 right-0 top-full z-40 mt-2 hidden max-h-80 overflow-auto rounded-xl border border-surface-variant bg-surface p-2 shadow-xl';
    dropdown.setAttribute('role', 'listbox');
    wrapper.append(dropdown);
    let timer = 0;

    const close = (): void => dropdown.classList.add('hidden');
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) {
        close();
        return;
      }
      timer = window.setTimeout(async () => {
        try {
          const response = await api<{ results: SearchResult[] }>(
            `/api/search?q=${encodeURIComponent(query)}`,
          );
          if (input.value.trim() !== query) return;
          dropdown.replaceChildren();
          if (!response.results.length) {
            dropdown.innerHTML =
              '<p class="px-3 py-2 text-body-sm text-outline">没有找到相关内容</p>';
          }
          response.results.forEach((result) => {
            const link = document.createElement('a');
            link.href = routeFor(result);
            link.className =
              'flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-container-low';
            const title = document.createElement('span');
            title.className = 'text-label-sm text-on-surface';
            title.textContent = `${result.identifier ? `${result.identifier} · ` : ''}${result.title}`;
            const meta = document.createElement('span');
            meta.className = 'shrink-0 text-body-sm text-outline';
            meta.textContent = `${labelFor(result.type)} · ${result.detail}`;
            link.append(title, meta);
            dropdown.append(link);
          });
          const allResults = document.createElement('a');
          allResults.href = `./search.html?q=${encodeURIComponent(query)}`;
          allResults.className =
            'mt-1 block rounded-lg border-t border-surface-variant px-3 py-2 text-label-sm text-primary hover:bg-surface-container-low';
          allResults.textContent = '查看完整搜索结果';
          dropdown.append(allResults);
          dropdown.classList.remove('hidden');
        } catch {
          close();
        }
      }, 220);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Enter' && input.value.trim().length >= 2) {
        event.preventDefault();
        window.location.href = `./search.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    });
    document.addEventListener('click', (event) => {
      if (!wrapper.contains(event.target as Node)) close();
    });
  });
}

function inboxDialog(): void {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-notifications-open]',
  );
  if (!button) return;
  const dialog = document.createElement('dialog');
  dialog.className =
    'w-[min(92vw,38rem)] rounded-2xl border border-surface-variant bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-primary/30';
  dialog.innerHTML = `<div class="flex items-center justify-between border-b border-surface-variant px-6 py-4"><div><h2 class="font-headline-md text-primary">社区消息</h2><p class="mt-1 text-body-sm text-outline">通知、联系请求和私信入口</p></div><button class="rounded-lg p-2 text-outline hover:bg-surface-container-low" data-close-inbox aria-label="关闭">关闭</button></div><div class="max-h-[65vh] overflow-auto p-6" data-inbox-content><p class="text-body-sm text-outline">正在加载…</p></div><div class="flex flex-wrap gap-2 border-t border-surface-variant px-6 py-4"><a class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary" href="./account.html#requests">查看联系请求</a><a class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" href="./account.html#messages">打开私信</a><a class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" href="./account.html#notifications">全部通知</a></div>`;
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('[data-inbox-content]');
  dialog
    .querySelector('[data-close-inbox]')
    ?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  button.addEventListener('click', async () => {
    try {
      const [requests, notifications] = await Promise.all([
        api<{
          items: Array<{
            id: string;
            targetType: string;
            message: string;
            status: string;
            direction: string;
            otherName?: string;
          }>;
        }>('/api/me/contact-requests?pageSize=10'),
        api<{
          items: Array<{
            id: string;
            title: string;
            detail: string;
            href: string | null;
            readAt: string | null;
          }>;
        }>('/api/notifications?pageSize=8'),
      ]);
      const pending = requests.items.filter(
        (item) => item.direction === 'received' && item.status === 'pending',
      );
      const unread = notifications.items.filter((item) => !item.readAt);
      if (content)
        content.innerHTML = `<section><h3 class="mb-2 font-label-md text-primary">待处理联系请求</h3>${pending.length ? pending.map((item) => `<article class="border-b border-surface-variant py-3"><strong>${escapeHtml(item.otherName ?? '校园同学')} · ${item.targetType === 'listing' ? '集市' : '技能互助'}</strong><p class="mt-1 text-body-sm">${escapeHtml(item.message || '对方希望与你建立联系。')}</p><div class="mt-2 flex gap-2"><button class="rounded-lg bg-primary px-3 py-1.5 text-xs text-on-primary" data-contact-action="accepted" data-id="${escapeHtml(item.id)}">接受并开启私信</button><button class="rounded-lg border border-outline-variant px-3 py-1.5 text-xs" data-contact-action="declined" data-id="${escapeHtml(item.id)}">拒绝</button></div></article>`).join('') : '<p class="py-3 text-body-sm text-outline">没有待处理请求。</p>'}</section><section class="mt-6"><h3 class="mb-2 font-label-md text-primary">未读通知</h3>${unread.length ? unread.map((item) => `<a class="block border-b border-surface-variant py-3" href="${escapeHtml(item.href ?? './account.html#notifications')}" data-read-notification="${escapeHtml(item.id)}"><strong class="text-label-sm text-primary">${escapeHtml(item.title)}</strong><span class="mt-1 block text-body-sm text-outline">${escapeHtml(item.detail)}</span></a>`).join('') : '<p class="py-3 text-body-sm text-outline">没有未读通知。</p>'}</section>`;
      content
        ?.querySelectorAll<HTMLButtonElement>('[data-contact-action]')
        .forEach((action) =>
          action.addEventListener('click', async () => {
            await api(`/api/me/contact-requests/${action.dataset.id}`, {
              method: 'PATCH',
              body: jsonBody({ status: action.dataset.contactAction }),
            });
            showToast(
              action.dataset.contactAction === 'accepted'
                ? '请求已接受，可以继续私信。'
                : '请求已拒绝。',
              'success',
            );
            button.click();
          }),
        );
      content
        ?.querySelectorAll<HTMLAnchorElement>('[data-read-notification]')
        .forEach((link) =>
          link.addEventListener('click', () => {
            void api(`/api/notifications/${link.dataset.readNotification}`, {
              method: 'PATCH',
            });
          }),
        );
      dialog.showModal();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '请先登录后查看消息',
        'error',
      );
    }
  });
}

function publishShortcut(): void {
  document
    .querySelector<HTMLButtonElement>('[data-publish-shortcut]')
    ?.addEventListener('click', () => {
      const path = window.location.pathname;
      if (path.endsWith('market.html')) window.openPublishModal?.();
      else if (path.endsWith('skill-mutual-aid.html'))
        window.openSkillPublishModal?.();
      else if (path.endsWith('tree-hole.html'))
        document
          .querySelector<HTMLTextAreaElement>('#tree-hole-input')
          ?.focus();
      else if (path.endsWith('course-evaluation.html'))
        window.openReviewModal?.();
      else window.location.href = './market.html';
    });
}

function initializePage(): void {
  const path = window.location.pathname;
  if (path.endsWith('course-evaluation.html')) initCourses();
  else if (path.endsWith('market.html')) initMarket();
  else if (path.endsWith('skill-mutual-aid.html')) initSkills();
  else if (path.endsWith('tree-hole.html')) initTreeHole();
  else if (path.endsWith('moderation.html')) initModeration();
  else if (path.endsWith('account.html')) initAccount();
  else if (path.endsWith('information.html')) initInformation();
  else if (path.endsWith('search.html')) initSearch();
  else initHome();
}

function enforcePageAccess(): void {
  const main = document.querySelector<HTMLElement>('[data-requires-auth]');
  if (!main) {
    initializePage();
    return;
  }
  const gate = document.createElement('main');
  gate.className = 'min-h-[65vh] bg-background px-4 pb-16 pt-32 sm:px-6';
  gate.innerHTML =
    '<section class="mx-auto max-w-xl rounded-2xl bg-surface-container-lowest p-8 text-center shadow-sm"><span class="material-symbols-outlined text-4xl text-secondary" aria-hidden="true">lock</span><h1 class="mt-4 font-headline-lg text-primary">登录后查看校园内容</h1><p class="mt-3 text-body-md text-on-surface-variant" data-gate-message>正在检查登录状态…</p><button class="mt-5 rounded-lg bg-primary px-5 py-2.5 text-label-sm text-on-primary" data-open-login>校园邮箱登录</button><a class="mt-4 hidden text-label-sm text-primary underline" data-appeal-link href="./account.html#appeals">查看处置记录并提交申诉</a></section>';
  main.before(gate);
  gate.querySelector('[data-open-login]')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('[data-auth-toggle]')?.click();
  });
  let initialized = false;
  const update = (state: SessionState): void => {
    const isAccountPage = window.location.pathname.endsWith('account.html');
    if (
      state.authenticated &&
      state.user?.accountStatus !== 'deleting' &&
      (state.user?.accountStatus !== 'banned' || isAccountPage)
    ) {
      if (
        state.user?.accountStatus === 'banned' &&
        isAccountPage &&
        !location.hash
      )
        location.hash = 'appeals';
      gate.remove();
      main.hidden = false;
      if (!initialized) {
        initialized = true;
        initializePage();
      }
      return;
    }
    main.hidden = true;
    gate.hidden = false;
    const message = gate.querySelector<HTMLElement>('[data-gate-message]');
    if (message)
      message.textContent =
        state.user?.accountStatus === 'banned' ||
        state.user?.accountStatus === 'deleting'
          ? '账号当前处于受限状态。如需查看处罚或申诉，请联系社区管理。'
          : '课程、集市、技能互助和树洞仅向已登录的校园邮箱账号开放。';
    gate
      .querySelector<HTMLAnchorElement>('[data-appeal-link]')
      ?.classList.toggle('hidden', state.user?.accountStatus !== 'banned');
  };
  api<SessionState>('/api/session')
    .then(update)
    .catch(() => {
      const message = gate.querySelector<HTMLElement>('[data-gate-message]');
      if (message) message.textContent = '暂时无法连接校园服务，请稍后重试。';
    });
  window.addEventListener('shenxiaoli:session-changed', (event) =>
    update((event as CustomEvent<SessionState>).detail),
  );
}

function init(): void {
  updateFooterYear();
  initToast();
  authWidget();
  searchResults();
  inboxDialog();
  publishShortcut();
  enforcePageAccess();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else init();
