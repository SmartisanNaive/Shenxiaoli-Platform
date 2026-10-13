import { api, escapeHtml, jsonBody, showToast, type SessionState } from './api';

interface QueueItem {
  id: string;
  type: 'review' | 'tree-hole' | 'report' | 'appeal' | 'collaboration';
  action?: string;
  appealReason?: string;
  originalModeratorId?: string;
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

  const renderQueueItem = (item: QueueItem): string => {
    const label =
      item.type === 'review'
        ? '课程评价'
        : item.type === 'tree-hole'
          ? '匿名树洞'
          : item.type === 'appeal'
            ? '申诉复核'
            : item.type === 'collaboration'
              ? '互助争议'
              : '用户举报';
    const actions =
      item.type === 'report'
        ? `<button type="button" data-action="handle" data-id="${escapeHtml(item.id)}" data-type="reports" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">处置举报</button><button type="button" data-action="dismiss" data-id="${escapeHtml(item.id)}" data-type="reports" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">驳回举报</button>`
        : item.type === 'appeal'
          ? `<button type="button" data-action="restore" data-id="${escapeHtml(item.id)}" data-type="appeals" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">申诉通过并恢复</button><button type="button" data-action="uphold" data-id="${escapeHtml(item.id)}" data-type="appeals" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">维持原处置</button>`
          : item.type === 'collaboration'
            ? `<button type="button" data-action="resume" data-id="${escapeHtml(item.id)}" data-type="collaborations" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">恢复合作</button><button type="button" data-action="cancel" data-id="${escapeHtml(item.id)}" data-type="collaborations" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">取消合作</button>`
            : `<button type="button" data-action="approved" data-id="${escapeHtml(item.id)}" data-type="${item.type === 'review' ? 'reviews' : 'tree-hole'}" class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">通过并公开</button><button type="button" data-action="rejected" data-id="${escapeHtml(item.id)}" data-type="${item.type === 'review' ? 'reviews' : 'tree-hole'}" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary">拒绝</button>`;
    return `<article class="rounded-xl border border-surface-variant bg-surface p-5 shadow-sm"><div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2"><span class="rounded-full bg-secondary-container px-3 py-1 text-label-sm text-on-secondary-container">${label}</span><span class="text-body-sm text-outline">${escapeHtml(item.context ?? item.targetType ?? '')}</span></div><time class="text-body-sm text-outline">${new Date(item.createdAt).toLocaleString('zh-CN')}</time></div><p class="mt-4 whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(item.content ?? '')}</p>${item.reason ? `<p class="mt-3 rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant"><strong>举报原因：</strong>${escapeHtml(item.reason)}</p>` : ''}${item.rating ? `<p class="mt-2 text-body-sm text-secondary">评分 ${Number(item.rating).toFixed(1)} / 10</p>` : ''}${item.type === 'report' ? `<p class="mt-2 text-body-sm text-outline">对象：${escapeHtml(item.targetType ?? '')} · ${escapeHtml(item.targetId ?? '')}</p>` : ''}${item.type === 'appeal' ? `<p class="mt-2 text-body-sm text-outline">原处置：${escapeHtml(item.action ?? '')} · 申诉理由：${escapeHtml(item.appealReason ?? '')}</p>` : ''}<div class="mt-5 flex flex-wrap gap-2">${actions}</div></article>`;
  };

  const renderQueue = (items: QueueItem[], hasMore: boolean): void => {
    queue.innerHTML = items.length
      ? items.map(renderQueueItem).join('')
      : '<div class="rounded-xl border border-dashed border-outline-variant bg-surface p-10 text-center text-body-md text-outline">审核队列为空。</div>';
    if (hasMore)
      queue.insertAdjacentHTML(
        'beforeend',
        '<button type="button" class="rounded-lg border border-outline-variant bg-surface px-4 py-3 text-label-sm text-primary" data-queue-more>加载更多审核记录</button>',
      );
    queue
      .querySelector('[data-queue-more]')
      ?.addEventListener(
        'click',
        () => void load(queuePage + 1, appealPage + 1, true),
      );
    queue
      .querySelectorAll<HTMLButtonElement>('[data-action]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const itemType = button.dataset.type;
          const id = encodeURIComponent(button.dataset.id ?? '');
          const isReview = itemType === 'appeals';
          const isReport = itemType === 'reports';
          const isCollaboration = itemType === 'collaborations';
          const reason =
            window
              .prompt(
                isReport
                  ? '请填写处置原因（至少 3 字）：'
                  : isReview
                    ? '请填写复核理由（至少 3 字）：'
                    : isCollaboration
                      ? '请填写争议处理原因（至少 3 字）：'
                      : '记录审核理由（可留空）：',
                '',
              )
              ?.trim() ?? '';
          if ((isReport || isReview || isCollaboration) && reason.length < 3)
            return;
          const reportAction =
            button.dataset.action === 'dismiss'
              ? 'dismiss'
              : isReport
                ? (window
                    .prompt(
                      '处置类型：hide / remove / warn / mute / ban',
                      'hide',
                    )
                    ?.trim() ?? '')
                : '';
          if (
            isReport &&
            !['dismiss', 'hide', 'remove', 'warn', 'mute', 'ban'].includes(
              reportAction,
            )
          )
            return;
          button.disabled = true;
          try {
            if (isReport)
              await api(`/api/admin/reports/${id}/action`, {
                method: 'POST',
                body: jsonBody({ action: reportAction, reason }),
              });
            else if (isReview)
              await api(`/api/admin/appeals/${id}`, {
                method: 'PATCH',
                body: jsonBody({ outcome: button.dataset.action, reason }),
              });
            else if (isCollaboration)
              await api(`/api/admin/collaborations/${id}/resolve`, {
                method: 'POST',
                body: jsonBody({ outcome: button.dataset.action, reason }),
              });
            else
              await api(`/api/admin/${itemType}/${id}`, {
                method: 'PATCH',
                body: jsonBody({ status: button.dataset.action, reason }),
              });
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

  let queuePage = 1;
  let queueTotal = 0;
  let appealPage = 1;
  let appealTotal = 0;
  let queueItems: QueueItem[] = [];
  let appealItems: QueueItem[] = [];
  const load = async (
    page = 1,
    appealPageRequest = 1,
    append = false,
  ): Promise<void> => {
    try {
      const session = await api<SessionState>('/api/session');
      if (
        !session.authenticated ||
        (session.user?.role !== 'moderator' && session.user?.role !== 'admin')
      ) {
        status.innerHTML = `<div class="flex flex-col items-start gap-3"><p>此页面需要审核员或管理员权限。开发环境可通过右上角账户菜单选择“演示审核员身份”；正式环境由管理员指定审核权限。</p>${session.demoAuthAvailable ? '<button type="button" data-moderator-login class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">登录审核员演示身份</button>' : ''}</div>`;
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
      status.textContent = `当前身份：${session.user.displayName}（${session.user.role === 'admin' ? '管理员' : session.demoAuthAvailable ? '开发演示审核员' : '审核员'}）`;
      const [response, appeals] = await Promise.all([
        api<{ items: QueueItem[]; total: number; page: number }>(
          `/api/admin/queue?page=${page}&pageSize=20`,
        ),
        api<{
          items: Array<QueueItem & { type?: string }>;
          total: number;
          page: number;
        }>(`/api/admin/appeals?page=${appealPageRequest}&pageSize=20`),
      ]);
      queueItems = append ? [...queueItems, ...response.items] : response.items;
      appealItems = append
        ? [
            ...appealItems,
            ...appeals.items.map((item) => ({
              ...item,
              type: 'appeal' as const,
            })),
          ]
        : appeals.items.map((item) => ({ ...item, type: 'appeal' as const }));
      queuePage = response.page;
      queueTotal = response.total;
      appealPage = appeals.page;
      appealTotal = appeals.total;
      renderQueue(
        [...queueItems, ...appealItems],
        queueItems.length < queueTotal || appealItems.length < appealTotal,
      );
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '审核队列加载失败。';
      queue.replaceChildren();
    }
  };
  refresh?.addEventListener('click', () => void load());
  void load();
}
