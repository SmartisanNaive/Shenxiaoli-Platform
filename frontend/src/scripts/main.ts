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

  const close = (): void => {
    panel?.classList.add('hidden');
    toggle?.setAttribute('aria-expanded', 'false');
  };
  const render = (state: SessionState): void => {
    if (label) label.textContent = state.user?.displayName ?? '未登录';
    if (message) {
      message.textContent = state.user
        ? `${state.user.displayName} · ${state.user.role === 'moderator' ? '审核员演示身份' : '学生演示身份'}`
        : state.demoAuthAvailable
          ? '本地演示登录仅用于测试互动流程。'
          : '真实校园统一认证尚未接入。';
    }
    if (loginOptions)
      loginOptions.hidden =
        Boolean(state.authenticated) || !state.demoAuthAvailable;
    if (adminLink) {
      adminLink.classList.toggle('hidden', state.user?.role !== 'moderator');
      adminLink.classList.toggle('block', state.user?.role === 'moderator');
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
          showToast('演示身份已登录。正式校园认证尚未接入。', 'success');
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
      await api('/api/auth/logout', { method: 'POST' });
      const state = await api<SessionState>('/api/session');
      render(state);
      close();
      window.dispatchEvent(
        new CustomEvent('shenxiaoli:session-changed', { detail: state }),
      );
      showToast('已退出演示登录。', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '退出登录失败',
        'error',
      );
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
          dropdown.classList.remove('hidden');
        } catch {
          close();
        }
      }, 220);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      if (
        event.key === 'Enter' &&
        dropdown.firstElementChild instanceof HTMLAnchorElement
      ) {
        event.preventDefault();
        window.location.href = dropdown.firstElementChild.href;
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
    'w-[min(92vw,34rem)] rounded-2xl border border-surface-variant bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-primary/30';
  dialog.innerHTML = `
    <div class="flex items-center justify-between border-b border-surface-variant px-6 py-4">
      <div><h2 class="font-headline-md text-primary">联系请求</h2><p class="mt-1 text-body-sm text-outline">当前版本仅支持请求与接受/拒绝，不包含站内私信。</p></div>
      <button class="rounded-lg p-2 text-outline hover:bg-surface-container-low" data-close-inbox aria-label="关闭">关闭</button>
    </div>
    <div class="max-h-[60vh] overflow-auto p-6" data-inbox-content><p class="text-body-sm text-outline">正在加载…</p></div>`;
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('[data-inbox-content]');
  const close = (): void => dialog.close();
  dialog.querySelector('[data-close-inbox]')?.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  button.addEventListener('click', async () => {
    try {
      const response = await api<{
        items: {
          id: string;
          targetType: string;
          message: string;
          status: string;
          direction: string;
          createdAt: string;
        }[];
      }>('/api/me/contact-requests');
      const pending = response.items.filter(
        (item) => item.direction === 'received' && item.status === 'pending',
      );
      const history = response.items.filter(
        (item) => item.direction === 'sent' || item.status !== 'pending',
      );
      const renderItem = (
        item: (typeof response.items)[number],
        incoming: boolean,
      ): string => `
        <article class="border-b border-surface-variant py-4 last:border-0">
          <div class="flex items-center justify-between gap-3"><strong class="text-label-md text-primary">${item.targetType === 'listing' ? '集市联系请求' : '技能互助请求'}</strong><span class="text-body-sm text-outline">${item.status === 'pending' ? '待处理' : item.status === 'accepted' ? '已接受' : item.status === 'declined' ? '已拒绝' : '已取消'}</span></div>
          <p class="mt-2 text-body-md">${item.message ? escapeHtml(item.message) : '对方希望与你建立联系。'}</p>
          ${incoming && item.status === 'pending' ? `<div class="mt-3 flex gap-2"><button class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-contact-action="accepted" data-id="${item.id}">接受</button><button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm text-primary" data-contact-action="declined" data-id="${item.id}">拒绝</button></div>` : ''}
        </article>`;
      if (content) {
        content.innerHTML =
          pending.length || history.length
            ? `${pending.map((item) => renderItem(item, true)).join('')}${
                history.length
                  ? `<h3 class="mb-2 mt-5 font-headline-sm text-primary">最近记录</h3>${history
                      .slice(0, 12)
                      .map((item) => renderItem(item, false))
                      .join('')}`
                  : ''
              }`
            : '<p class="py-8 text-center text-body-sm text-outline">暂时没有联系请求。</p>';
      }
      content
        ?.querySelectorAll<HTMLButtonElement>('[data-contact-action]')
        .forEach((action) => {
          action.addEventListener('click', async () => {
            await api(`/api/me/contact-requests/${action.dataset.id}`, {
              method: 'PATCH',
              body: jsonBody({ status: action.dataset.contactAction }),
            });
            showToast('已更新联系请求状态。', 'success');
            button.click();
          });
        });
      dialog.showModal();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '请先登录并启动 API',
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

function init(): void {
  updateFooterYear();
  initToast();
  authWidget();
  searchResults();
  inboxDialog();
  publishShortcut();
  const path = window.location.pathname;
  if (path.endsWith('course-evaluation.html')) initCourses();
  else if (path.endsWith('market.html')) initMarket();
  else if (path.endsWith('skill-mutual-aid.html')) initSkills();
  else if (path.endsWith('tree-hole.html')) initTreeHole();
  else if (path.endsWith('moderation.html')) initModeration();
  else initHome();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else init();
