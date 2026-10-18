import { api, escapeHtml, jsonBody, showToast, type SkillPost } from './api';
import { bindCommentSlots, commentSlot } from './comments';

interface SkillResponse {
  items: SkillPost[];
  total: number;
  page: number;
}

function skillCard(post: SkillPost, compact = false): string {
  const action = post.isOwner
    ? `<span class="text-body-sm text-outline">这是你发布的内容</span>${post.kind === 'request' ? `<button type="button" class="rounded border border-outline-variant px-4 py-2 text-label-sm text-primary" data-skill-recommend="${escapeHtml(post.id)}">查看匹配技能</button>` : ''}`
    : `<button type="button" class="rounded border border-outline-variant px-4 py-2 text-label-sm text-primary" data-skill-contact="${escapeHtml(post.id)}">联系同学</button>${post.kind === 'request' ? `<button type="button" class="rounded bg-primary px-4 py-2 text-label-sm text-on-primary hover:bg-secondary" data-skill-apply="${escapeHtml(post.id)}">提供帮助</button>` : ''}`;
  return `<article class="flex flex-col gap-4 rounded-md border border-surface-variant bg-surface-container-lowest ${compact ? 'p-5' : 'p-6'}"><div class="flex items-start justify-between gap-4"><div class="flex items-start gap-3"><span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-headline-sm text-primary">狸</span><div><h3 class="font-headline-sm text-primary">${escapeHtml(post.title)}</h3><p class="mt-1 text-body-sm text-outline">${escapeHtml(post.category)} · ${post.kind === 'offer' ? '技能分享' : '发起求助'}</p></div></div><span class="rounded-full bg-surface-container px-3 py-1 text-label-sm text-secondary">${post.kind === 'offer' ? '可互助' : '求帮助'}</span></div><p class="whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(post.description)}</p>${post.tags.length ? `<div class="flex flex-wrap gap-2">${post.tags.map((tag) => `<span class="rounded-lg bg-surface-container-low px-3 py-1 text-label-sm text-on-surface-variant">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<div class="flex flex-col gap-3 border-t border-surface-variant pt-4 sm:flex-row sm:items-center sm:justify-between"><div class="flex flex-col gap-1 text-body-sm"><span class="text-primary"><strong>我能提供：</strong>${escapeHtml(post.canOffer || post.title)}</span><span class="text-secondary"><strong>我想交流：</strong>${escapeHtml(post.wants || '欢迎留言交流')}</span></div><div class="flex flex-wrap gap-2">${action}</div></div>${commentSlot('skill', post.id)}</article>`;
}

export function initSkills(): void {
  const offers = document.querySelector<HTMLElement>('#skill-offers');
  const requests = document.querySelector<HTMLElement>('#skill-requests');
  const form = document.querySelector<HTMLElement>('#skill-form');
  const submitButton =
    document.querySelector<HTMLButtonElement>('#skill-submit');
  const modal = document.querySelector<HTMLElement>('#publish-modal');
  if (!offers || !requests || !form) return;
  offers.hidden = true;
  requests.hidden = true;
  let category = 'all';
  let kind: 'offer' | 'request' = 'offer';
  let allPosts: SkillPost[] = [];
  let currentPage = 1;
  let totalPosts = 0;

  const render = (): void => {
    const visible = allPosts.filter(
      (post) => category === 'all' || post.category === category,
    );
    const offerPosts = visible.filter((post) => post.kind === 'offer');
    const requestPosts = visible.filter((post) => post.kind === 'request');
    offers.innerHTML = `<div class="flex items-center justify-between gap-3"><h2 class="flex items-center gap-2 font-headline-md text-primary"><span class="material-symbols-outlined text-secondary" aria-hidden="true">psychology</span>技能分享</h2><span class="text-body-sm text-outline">${offerPosts.length} 条</span></div>${offerPosts.length ? offerPosts.map((post) => skillCard(post)).join('') : '<div class="rounded border border-dashed border-outline-variant p-7 text-body-sm text-outline">还没有符合条件的技能分享。</div>'}${allPosts.length < totalPosts ? `<button type="button" data-skills-more class="rounded border border-outline-variant px-4 py-3 text-label-sm text-primary">加载更多（已显示 ${allPosts.length} / ${totalPosts}）</button>` : ''}`;
    requests.innerHTML = `<div class="flex items-center justify-between gap-3"><h2 class="flex items-center gap-2 font-headline-md text-primary"><span class="material-symbols-outlined text-secondary" aria-hidden="true">forum</span>求助广场</h2><span class="text-body-sm text-outline">${requestPosts.length} 条</span></div>${requestPosts.length ? requestPosts.map((post) => skillCard(post, true)).join('') : '<div class="rounded border border-dashed border-outline-variant p-6 text-body-sm text-outline">暂时没有匹配的求助。</div>'}`;
    offers.hidden = false;
    requests.hidden = false;
    bindCommentSlots(offers);
    bindCommentSlots(requests);
    offers
      .querySelector('[data-skills-more]')
      ?.addEventListener('click', () => void load(true));
    document
      .querySelectorAll<HTMLButtonElement>('[data-skill-contact]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const result = await api<{ message: string }>(
              `/api/skills/${encodeURIComponent(button.dataset.skillContact ?? '')}/contact`,
              {
                method: 'POST',
                body: jsonBody({
                  message: '你好，我看到你的技能互助内容，想进一步交流。',
                }),
              },
            );
            showToast(result.message, 'success');
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '联系请求失败',
              'error',
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    document
      .querySelectorAll<HTMLButtonElement>('[data-skill-apply]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const response = await api<SkillResponse>('/api/skills?kind=offer');
            const ownOffers = response.items.filter((post) => post.isOwner);
            if (!ownOffers.length) {
              showToast('请先发布一条技能分享，再申请帮助这条求助。', 'info');
              return;
            }
            const choice = window.prompt(
              `选择你的技能分享编号：\n${ownOffers.map((post, index) => `${index + 1}. ${post.title}`).join('\n')}`,
              '1',
            );
            if (!choice) return;
            const offer = ownOffers[Number(choice) - 1];
            if (!offer) {
              showToast('没有这个编号。', 'error');
              return;
            }
            const scope = window.prompt(
              '简单说明你计划如何帮助（5–500 字）',
              `${offer.title}：一起讨论并完成练习`,
            );
            if (!scope) return;
            await api(
              `/api/skills/requests/${button.dataset.skillApply}/collaborations`,
              {
                method: 'POST',
                body: jsonBody({ offerPostId: offer.id, scope }),
              },
            );
            showToast('互助申请已发送，等待求助方确认。', 'success');
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '申请失败',
              'error',
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    document
      .querySelectorAll<HTMLButtonElement>('[data-skill-recommend]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const response = await api<{
              items: Array<{
                title: string;
                category: string;
                reasons: string[];
              }>;
            }>(
              `/api/skills/recommendations?requestId=${encodeURIComponent(button.dataset.skillRecommend ?? '')}`,
            );
            const dialog = document.createElement('dialog');
            dialog.className =
              'w-[min(92vw,32rem)] rounded-md bg-surface p-6 text-on-surface shadow-md backdrop:bg-primary/30';
            dialog.innerHTML = `<h2 class="font-headline-md text-primary">匹配的技能分享</h2><div class="mt-4 space-y-3">${response.items.length ? response.items.map((item) => `<article class="rounded-lg bg-surface-container-low p-3"><strong>${escapeHtml(item.title)}</strong><p class="mt-1 text-xs text-outline">${escapeHtml(item.category)} · ${escapeHtml(item.reasons.join('、') || '最近发布')}</p></article>`).join('') : '<p class="text-body-sm text-outline">暂时没有合适的技能分享。</p>'}</div><button class="mt-5 rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary" data-close>关闭</button>`;
            document.body.append(dialog);
            dialog
              .querySelector('[data-close]')
              ?.addEventListener('click', () => dialog.close());
            dialog.addEventListener('close', () => dialog.remove());
            dialog.showModal();
          } catch (error) {
            showToast(
              error instanceof Error ? error.message : '匹配加载失败',
              'error',
            );
          }
        });
      });
  };

  const loadStats = async (): Promise<void> => {
    const pairs = document.querySelector<HTMLElement>('[data-skill-pairs]');
    const completed = document.querySelector<HTMLElement>(
      '[data-skill-completed]',
    );
    const resolution = document.querySelector<HTMLElement>(
      '[data-skill-resolution]',
    );
    const detail = document.querySelector<HTMLElement>(
      '[data-skill-resolution-detail]',
    );
    const periodLabel = document.querySelector<HTMLElement>(
      '[data-skill-period]',
    );
    try {
      const stats = await api<{
        period: string;
        timeZone: string;
        successfulPairs: number;
        completedCollaborations: number;
        helpResolution: {
          numerator: number;
          denominator: number;
          rate: number | null;
        };
      }>('/api/skills/stats');
      if (pairs) pairs.textContent = String(stats.successfulPairs);
      if (completed)
        completed.textContent = String(stats.completedCollaborations);
      if (resolution)
        resolution.textContent =
          stats.helpResolution.rate === null
            ? '暂无数据'
            : `${stats.helpResolution.rate}%`;
      if (detail)
        detail.textContent = `${stats.helpResolution.numerator} / ${stats.helpResolution.denominator} · ${stats.period}`;
      if (periodLabel)
        periodLabel.textContent = `统计月份：${stats.period} · ${stats.timeZone}`;
    } catch {
      if (pairs) pairs.textContent = '—';
      if (completed) completed.textContent = '—';
      if (resolution) resolution.textContent = '暂无数据';
      if (detail) detail.textContent = '统计暂不可用';
      if (periodLabel) periodLabel.textContent = '统计暂不可用';
    }
  };

  const load = async (append = false): Promise<void> => {
    try {
      const params = new URLSearchParams({
        page: String(append ? currentPage + 1 : 1),
        pageSize: '20',
      });
      if (category !== 'all') params.set('category', category);
      const response = await api<SkillResponse>(`/api/skills?${params}`);
      allPosts = append ? [...allPosts, ...response.items] : response.items;
      currentPage = response.page;
      totalPosts = response.total;
      render();
    } catch (error) {
      offers.hidden = false;
      offers.innerHTML = `<p class="rounded bg-error-container p-6 text-body-sm text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '互助内容加载失败')}。请启动 API 后重试。</p>`;
      requests.hidden = false;
      requests.replaceChildren();
    }
  };

  document
    .querySelectorAll<HTMLButtonElement>('[data-skill-category]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        category = button.dataset.skillCategory ?? 'all';
        document.querySelectorAll('[data-skill-category]').forEach((item) => {
          item.classList.toggle('bg-primary', item === button);
          item.classList.toggle('text-on-primary', item === button);
          item.classList.toggle('bg-surface-container', item !== button);
        });
        void load();
      });
    });

  const openModal = (): void => {
    modal?.classList.remove('hidden');
    window.setTimeout(
      () => form.querySelector<HTMLInputElement>('[name="title"]')?.focus(),
      0,
    );
  };
  const closeModal = (): void => modal?.classList.add('hidden');
  window.openSkillPublishModal = openModal;
  window.closeSkillPublishModal = closeModal;
  document
    .querySelector('#skill-publish-open')
    ?.addEventListener('click', openModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  form
    .querySelectorAll<HTMLButtonElement>('[onclick*="classList.add"]')
    ?.forEach((button) => button.addEventListener('click', closeModal));

  form
    .querySelectorAll<HTMLButtonElement>('[data-skill-kind]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        kind = button.dataset.skillKind === 'request' ? 'request' : 'offer';
        form.querySelectorAll('[data-skill-kind]').forEach((item) => {
          item.classList.toggle('bg-primary', item === button);
          item.classList.toggle('text-on-primary', item === button);
          item.classList.toggle('border-primary', item === button);
        });
      });
    });

  const handleSubmit = async (): Promise<void> => {
    const controls = [
      ...form.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('[name]'),
    ];
    const invalid = controls.find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    if (submitButton) submitButton.disabled = true;
    const value = (name: string): string =>
      form.querySelector<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >(`[name="${name}"]`)?.value ?? '';
    const tags = value('tags')
      .split(/[\s,，]+/)
      .map((tag) => tag.replace(/^#/, '').trim())
      .filter(Boolean)
      .slice(0, 10);
    try {
      const result = await api<{ message: string }>('/api/skills', {
        method: 'POST',
        body: jsonBody({
          kind,
          title: value('title'),
          category: value('category'),
          description: value('description'),
          tags,
          canOffer: value('canOffer'),
          wants: value('wants'),
        }),
      });
      controls.forEach((control) => {
        control.value =
          control instanceof HTMLSelectElement
            ? (control.options[0]?.value ?? '')
            : '';
      });
      kind = 'offer';
      closeModal();
      showToast(result.message, 'success');
      await load();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '发布失败，请检查登录状态。',
        'error',
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  };

  submitButton?.addEventListener('click', () => void handleSubmit());

  void load();
  void loadStats();
}
