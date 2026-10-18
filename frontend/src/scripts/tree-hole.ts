import {
  api,
  escapeHtml,
  formatRelativeTime,
  jsonBody,
  showToast,
  type TreePost,
} from './api';
import { bindCommentSlots, commentSlot } from './comments';

interface TreeResponse {
  items: TreePost[];
  total: number;
  hasMore: boolean;
}

export function initTreeHole(): void {
  const feed = document.querySelector<HTMLElement>('#tree-hole-feed');
  const textarea =
    document.querySelector<HTMLTextAreaElement>('#tree-hole-input');
  const status = document.querySelector<HTMLElement>('#tree-hole-status');
  const publish =
    document.querySelector<HTMLButtonElement>('#tree-hole-publish');
  const count = document.querySelector<HTMLElement>('[data-tree-count]');
  const composerTopics = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-tree-topic]'),
  ];
  const topicLinks = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '#tree-topic-filter button',
    ),
  ];
  if (!feed || !textarea) return;

  let topic = 'all';
  let sort: 'recent' | 'popular' = 'recent';
  let offset = 0;
  let hasMore = false;
  let total = 0;
  let loading = false;
  let posts: TreePost[] = [];
  let composerTopic = '校园生活';

  const render = (): void => {
    const content = posts.length
      ? posts
          .map(
            (post) =>
              `<article class="flex flex-col gap-4 rounded bg-surface p-6 shadow-sm" id="tree-${escapeHtml(post.id)}"><div class="flex items-center justify-between"><div class="flex items-center gap-3"><div class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary-container text-label-md font-bold text-on-secondary-container">狸</div><div><strong class="block text-label-md text-on-surface">匿名狸友</strong><span class="text-body-sm text-outline">${escapeHtml(formatRelativeTime(post.createdAt))}</span></div></div><span class="rounded-full bg-surface-container-low px-3 py-1 text-label-sm text-secondary">#${escapeHtml(post.topic)}</span></div><p class="whitespace-pre-line text-body-lg leading-relaxed text-on-surface">${escapeHtml(post.content)}</p><div class="flex items-center justify-between border-t border-surface-container pt-4"><div class="flex items-center gap-5"><button type="button" data-tree-feel="${escapeHtml(post.id)}" aria-pressed="${Boolean(post.reacted)}" class="flex items-center gap-1.5 text-label-md ${post.reacted ? 'text-secondary' : 'text-on-surface-variant'} hover:text-primary"><span class="material-symbols-outlined text-sm" aria-hidden="true">favorite</span>同感 <span class="font-bold">${post.reactions}</span></button><button type="button" data-tree-report="${escapeHtml(post.id)}" class="text-label-sm text-outline hover:text-primary">举报</button></div><button type="button" data-tree-share="${escapeHtml(post.id)}" class="flex items-center gap-1 text-label-sm text-outline hover:text-primary"><span class="material-symbols-outlined text-sm" aria-hidden="true">share</span>复制链接</button></div>${commentSlot('tree-hole', post.id)}</article>`,
          )
          .join('')
      : '<div class="rounded border border-dashed border-outline-variant bg-surface p-10 text-center"><span class="material-symbols-outlined text-3xl text-outline" aria-hidden="true">spa</span><p class="mt-3 text-body-md text-on-surface-variant">这个话题暂时没有公开树洞。</p><p class="mt-1 text-body-sm text-outline">树洞会即时公开并接受后续巡查；普通展示不包含发布者账号信息。</p></div>';
    feed.innerHTML = `<div class="flex items-center justify-between rounded bg-surface px-6 py-3 shadow-sm"><div class="flex items-center gap-5"><button type="button" data-tree-sort="recent" class="pb-1 text-label-md ${sort === 'recent' ? 'font-bold text-primary' : 'text-on-surface-variant'}">最新发布</button><button type="button" data-tree-sort="popular" class="pb-1 text-label-md ${sort === 'popular' ? 'font-bold text-primary' : 'text-on-surface-variant'}">最多同感</button></div><span class="text-body-sm text-outline">${total} 篇公开内容</span></div>${content}${hasMore ? '<button type="button" data-tree-more class="w-full rounded border border-outline-variant bg-surface px-4 py-3 text-label-sm text-primary hover:bg-surface-container-low">加载更多</button>' : ''}`;
    bindCommentSlots(feed);

    feed
      .querySelectorAll<HTMLButtonElement>('[data-tree-sort]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          sort = button.dataset.treeSort === 'popular' ? 'popular' : 'recent';
          offset = 0;
          posts = [];
          void load();
        });
      });
    feed
      .querySelectorAll<HTMLButtonElement>('[data-tree-feel]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            await api(
              `/api/tree-hole/${encodeURIComponent(button.dataset.treeFeel ?? '')}/feel`,
              { method: 'POST' },
            );
            offset = 0;
            await load();
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '操作失败，请先登录',
              'error',
            );
          }
        });
      });
    feed
      .querySelectorAll<HTMLButtonElement>('[data-tree-report]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const reason = window
            .prompt('请简要说明举报原因（3–300 字）：')
            ?.trim();
          if (!reason) return;
          try {
            const result = await api<{ message: string }>('/api/reports', {
              method: 'POST',
              body: jsonBody({
                targetType: 'tree-hole',
                targetId: button.dataset.treeReport,
                reason,
              }),
            });
            showToast(result.message, 'success');
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '举报失败',
              'error',
            );
          }
        });
      });
    feed
      .querySelectorAll<HTMLButtonElement>('[data-tree-share]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const url = `${location.origin}${location.pathname}?post=${encodeURIComponent(button.dataset.treeShare ?? '')}`;
          try {
            await navigator.clipboard.writeText(url);
            showToast('树洞链接已复制。', 'success');
          } catch {
            showToast(url, 'info');
          }
        });
      });
    feed
      .querySelector<HTMLButtonElement>('[data-tree-more]')
      ?.addEventListener('click', () => {
        offset = posts.length;
        void load(true);
      });
  };

  const load = async (append = false): Promise<void> => {
    if (loading) return;
    loading = true;
    try {
      const query = new URLSearchParams({
        sort,
        limit: '20',
        offset: append ? String(offset) : '0',
      });
      if (topic !== 'all') query.set('topic', topic);
      const response = await api<TreeResponse>(
        `/api/tree-hole?${query.toString()}`,
      );
      posts = append ? [...posts, ...response.items] : response.items;
      hasMore = response.hasMore;
      total = response.total;
      if (count) count.textContent = `${response.total} 篇`;
      render();
      const requested = new URLSearchParams(location.search).get('post');
      if (requested)
        window.setTimeout(
          () =>
            document
              .getElementById(`tree-${requested}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          100,
        );
    } catch (error) {
      if (!append)
        feed.innerHTML = `<div class="rounded bg-error-container p-8 text-body-sm text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '树洞加载失败')}。请启动 API 后重试。</div>`;
    } finally {
      loading = false;
    }
  };

  const setTopic = (next: string): void => {
    topic = next;
    offset = 0;
    posts = [];
    topicLinks.forEach((link) => {
      const active = (link.dataset.topic ?? 'all') === topic;
      link.classList.toggle('bg-primary', active);
      link.classList.toggle('text-on-primary', active);
      link.classList.toggle('text-on-surface-variant', !active);
      link.classList.toggle('bg-surface-container-low', !active);
    });
    void load();
  };
  topicLinks.forEach((link) => {
    const label = link.textContent?.trim() ?? '';
    const value = label === '全部' ? 'all' : label;
    link.dataset.topic = value;
    link.addEventListener('click', () => {
      setTopic(value);
    });
  });
  composerTopics.forEach((button) => {
    button.type = 'button';
    button.addEventListener('click', () => {
      composerTopic = button.dataset.treeTopic ?? '校园生活';
      composerTopics.forEach((item) =>
        item.classList.toggle('bg-secondary-container', item === button),
      );
    });
  });

  textarea.addEventListener('input', () => {
    if (status)
      status.textContent = `${textarea.value.length}/1000 字 · 即时公开，普通展示不包含账号信息`;
  });
  const submit = async (): Promise<void> => {
    const content = textarea.value.trim();
    if (content.length < 5) {
      if (status) status.textContent = '请至少输入 5 个字。';
      textarea.focus();
      return;
    }
    if (publish) publish.disabled = true;
    try {
      const response = await api<{ message: string }>('/api/tree-hole', {
        method: 'POST',
        body: jsonBody({ content, topic: composerTopic }),
      });
      textarea.value = '';
      if (status)
        status.textContent = '树洞已公开；举报和治理流程仍可处理违规内容。';
      showToast(response.message, 'success');
      sort = 'recent';
      if (topic !== 'all' && topic !== composerTopic) {
        setTopic(composerTopic);
      } else {
        offset = 0;
        await load();
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '发布失败，请先登录并检查 API。';
      if (status) status.textContent = message;
      showToast(message, 'error');
    } finally {
      if (publish) publish.disabled = false;
    }
  };
  publish?.addEventListener('click', () => {
    void submit();
  });

  void load();
}
