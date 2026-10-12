import { api, escapeHtml, jsonBody, showToast, type SessionState } from './api';

interface QueueItem {
  id: string;
  type: 'review' | 'tree-hole' | 'report';
  targetId?: string;
  targetType?: string;
  context?: string;
  content?: string;
  reason?: string;
  rating?: number;
  createdAt: string;
}

export function initModeration(): void {
  const status = document.querySelector<HTMLElement>(
    '[data-moderation-status]',
  );
  const queue = document.querySelector<HTMLElement>('[data-moderation-queue]');
  const refresh = document.querySelector<HTMLButtonElement>(
    '[data-refresh-queue]',
  );
  if (!status || !queue) return;

  const renderQueue = (items: QueueItem[]): void => {
    queue.innerHTML = items.length
      ? items
          .map(
            (item) =>
              `<article class="rounded-xl border border-surface-variant bg-surface p-5 shadow-sm"><div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2"><span class="rounded-full bg-secondary-container px-3 py-1 text-label-sm text-on-secondary-container">${item.type === 'review' ? '课程评价' : item.type === 'tree-hole' ? '匿名树洞' : '用户举报'}</span><span class="text-body-sm text-outline">${escapeHtml(item.context ?? item.targetType ?? '')}</span></div><time class="text-body-sm text-outline">${new Date(item.createdAt).toLocaleString('zh-CN')}</time></div><p class="mt-4 whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(item.content ?? '')}</p>${item.reason ? `<p class="mt-3 rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant"><strong>举报原因：</strong>${escapeHtml(item.reason)}</p>` : ''}${item.rating ? `<p class="mt-2 text-body-sm text-secondary">评分 ${Number(item.rating).toFixed(1)} / 10</p>` : ''}${item.type === 'report' ? `<p class="mt-2 text-body-sm text-outline">对象：${escapeHtml(item.targetType ?? '')} · ${escapeHtml(item.targetId ?? '')}</p>` : ''}<div class="mt-5 flex flex-wrap gap-2">${item.type === 'report' ? `<button type="button" data-action="resolved" data-id="${escapeHtml(item.id)}" data-type="reports" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">已处理</button><button type="button" data-action="dismissed" data-id="${escapeHtml(item.id)}" data-type="reports" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">忽略举报</button>` : `<button type="button" data-action="approved" data-id="${escapeHtml(item.id)}" data-type="${item.type === 'review' ? 'reviews' : 'tree-hole'}" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">通过并公开</button><button type="button" data-action="rejected" data-id="${escapeHtml(item.id)}" data-type="${item.type === 'review' ? 'reviews' : 'tree-hole'}" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">拒绝</button>`}</div></article>`,
          )
          .join('')
      : '<div class="rounded-xl border border-dashed border-outline-variant bg-surface p-10 text-center text-body-md text-outline">审核队列为空。</div>';
    queue
      .querySelectorAll<HTMLButtonElement>('[data-action]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const rejectionReason =
            button.dataset.action === 'rejected'
              ? (window.prompt('可选：记录拒绝原因，便于后续复核。')?.trim() ??
                '')
              : '';
          button.disabled = true;
          try {
            await api(
              `/api/admin/${button.dataset.type}/${encodeURIComponent(button.dataset.id ?? '')}`,
              {
                method: 'PATCH',
                body: jsonBody({
                  status: button.dataset.action,
                  reason: rejectionReason,
                }),
              },
            );
            showToast('审核状态已更新。', 'success');
            await load();
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '审核操作失败',
              'error',
            );
            button.disabled = false;
          }
        });
      });
  };

  const load = async (): Promise<void> => {
    try {
      const session = await api<SessionState>('/api/session');
      if (!session.authenticated || session.user?.role !== 'moderator') {
        status.innerHTML = `<div class="flex flex-col items-start gap-3"><p>此页面需要审核员权限。开发环境可通过右上角账户菜单选择“演示审核员身份”。正式环境需接入受信任的管理账号体系。</p>${session.demoAuthAvailable ? '<button type="button" data-moderator-login class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">登录审核员演示身份</button>' : ''}</div>`;
        queue.replaceChildren();
        status
          .querySelector('[data-moderator-login]')
          ?.addEventListener('click', async () => {
            await api('/api/auth/demo', {
              method: 'POST',
              body: jsonBody({ role: 'moderator' }),
            });
            const refreshed = await api<SessionState>('/api/session');
            window.dispatchEvent(
              new CustomEvent('shenxiaoli:session-changed', {
                detail: refreshed,
              }),
            );
            await load();
          });
        return;
      }
      status.textContent = `当前身份：${session.user.displayName}（开发演示审核员）`;
      const response = await api<{ items: QueueItem[] }>('/api/admin/queue');
      renderQueue(response.items);
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '审核队列加载失败。';
      queue.replaceChildren();
    }
  };
  refresh?.addEventListener('click', () => void load());
  void load();
}
