import { api, escapeHtml, jsonBody, showToast } from './api';

export function commentSlot(type: string, id: string): string {
  return `<section class="border-t border-surface-container pt-3" data-comment-widget data-comment-type="${escapeHtml(type)}" data-comment-id="${escapeHtml(id)}"><button type="button" class="text-label-sm text-primary underline" data-comment-open>查看评论与回复</button><div class="mt-3 hidden" data-comment-panel></div></section>`;
}

export function bindCommentSlots(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>('[data-comment-widget]')
    .forEach((widget) => {
      const panel = widget.querySelector<HTMLElement>('[data-comment-panel]');
      const open = widget.querySelector<HTMLButtonElement>(
        '[data-comment-open]',
      );
      if (!panel || !open || widget.dataset.bound) return;
      widget.dataset.bound = 'true';
      let currentPage = 1;
      let total = 0;
      let comments: Array<{
        id: string;
        parentId: string | null;
        author: string;
        content: string;
        isMine: number | boolean;
        createdAt: string;
      }> = [];
      const load = async (page = 1, append = false): Promise<void> => {
        const type = widget.dataset.commentType ?? '';
        const id = widget.dataset.commentId ?? '';
        const params = new URLSearchParams({
          targetType: type,
          targetId: id,
          page: String(page),
          pageSize: '20',
        });
        const response = await api<{
          items: typeof comments;
          total: number;
          page: number;
        }>(`/api/comments?${params}`);
        comments = append ? [...comments, ...response.items] : response.items;
        currentPage = response.page;
        total = response.total;
        panel.innerHTML = `${comments.length ? comments.map((item) => `<article class="border-l-2 ${item.parentId ? 'ml-5 border-outline-variant' : 'border-secondary'} py-2 pl-3"><div class="flex items-center justify-between gap-2"><span class="text-xs text-outline">${escapeHtml(item.author)} · ${new Date(item.createdAt).toLocaleString('zh-CN')}</span><div class="flex gap-2">${!item.parentId ? `<button type="button" class="text-xs text-primary underline" data-reply-to="${escapeHtml(item.id)}">回复</button>` : ''}${item.isMine ? `<button type="button" class="text-xs text-primary underline" data-edit-comment="${escapeHtml(item.id)}" data-content="${escapeHtml(item.content)}">编辑</button><button type="button" class="text-xs text-error underline" data-delete-comment="${escapeHtml(item.id)}">删除</button>` : ''}</div></div><p class="mt-1 whitespace-pre-line text-body-sm leading-6">${escapeHtml(item.content)}</p></article>`).join('') : '<p class="py-2 text-xs text-outline">还没有评论，欢迎友善交流。</p>'}${comments.length < total ? `<button type="button" class="mt-2 text-xs text-primary underline" data-comments-more>加载更多评论（${comments.length} / ${total}）</button>` : ''}<form class="mt-3 grid gap-2" data-comment-form><input type="hidden" name="parentId" /><label class="sr-only" for="comment-${escapeHtml(id)}">写评论</label><textarea id="comment-${escapeHtml(id)}" name="content" rows="2" maxlength="1000" required class="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-sm" placeholder="写一条友善评论"></textarea><div class="flex items-center justify-between"><span class="text-xs text-outline" data-reply-label></span><button class="rounded-lg bg-primary px-3 py-1.5 text-xs text-on-primary">发送评论</button></div></form>`;
        panel
          .querySelector<HTMLButtonElement>('[data-comments-more]')
          ?.addEventListener('click', async (event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            try {
              await load(currentPage + 1, true);
            } catch (error) {
              button.disabled = false;
              showToast(
                error instanceof Error ? error.message : '评论加载失败',
                'error',
              );
            }
          });
        panel
          .querySelector<HTMLFormElement>('[data-comment-form]')
          ?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const parentId =
              (form.elements.namedItem('parentId') as HTMLInputElement).value ||
              null;
            const content = (
              form.elements.namedItem('content') as HTMLTextAreaElement
            ).value.trim();
            try {
              await api('/api/comments', {
                method: 'POST',
                body: jsonBody({
                  targetType: type,
                  targetId: id,
                  parentId,
                  content,
                }),
              });
              await load();
            } catch (error) {
              showToast(
                error instanceof Error ? error.message : '评论发送失败',
                'error',
              );
            }
          });
        panel
          .querySelectorAll<HTMLButtonElement>('[data-reply-to]')
          .forEach((button) =>
            button.addEventListener('click', () => {
              (
                panel.querySelector('[name="parentId"]') as HTMLInputElement
              ).value = button.dataset.replyTo ?? '';
              const label =
                panel.querySelector<HTMLElement>('[data-reply-label]');
              if (label) label.textContent = '正在回复评论；只能回复一级评论。';
              panel
                .querySelector<HTMLTextAreaElement>('[name="content"]')
                ?.focus();
            }),
          );
        panel
          .querySelectorAll<HTMLButtonElement>('[data-edit-comment]')
          .forEach((button) =>
            button.addEventListener('click', async () => {
              const content = window.prompt(
                '编辑评论',
                button.dataset.content ?? '',
              );
              if (content === null) return;
              await api(`/api/comments/${button.dataset.editComment}`, {
                method: 'PATCH',
                body: jsonBody({ content }),
              });
              await load();
            }),
          );
        panel
          .querySelectorAll<HTMLButtonElement>('[data-delete-comment]')
          .forEach((button) =>
            button.addEventListener('click', async () => {
              if (!window.confirm('删除这条评论？')) return;
              await api(`/api/comments/${button.dataset.deleteComment}`, {
                method: 'DELETE',
              });
              await load();
            }),
          );
      };
      open.addEventListener('click', async () => {
        const opening = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !opening);
        if (opening) {
          try {
            await load();
          } catch (error) {
            panel.innerHTML = `<p class="text-xs text-error">${escapeHtml(error instanceof Error ? error.message : '评论加载失败')}</p>`;
          }
        }
      });
    });
}
