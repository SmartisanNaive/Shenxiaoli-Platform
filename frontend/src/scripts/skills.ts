import { api, escapeHtml, jsonBody, showToast, type SkillPost } from './api';

interface SkillResponse {
  items: SkillPost[];
  total: number;
}

function skillCard(post: SkillPost, compact = false): string {
  return `<article class="flex flex-col gap-4 rounded-2xl bg-surface-container-lowest ${compact ? 'p-5' : 'p-6'} shadow-sm transition-shadow hover:shadow-md"><div class="flex items-start justify-between gap-4"><div class="flex items-start gap-3"><span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-headline-sm text-primary">狸</span><div><h3 class="font-headline-sm text-primary">${escapeHtml(post.title)}</h3><p class="mt-1 text-body-sm text-outline">${escapeHtml(post.category)} · ${post.kind === 'offer' ? '技能分享' : '发起求助'}</p></div></div><span class="rounded-full bg-surface-container px-3 py-1 text-label-sm text-secondary">${post.kind === 'offer' ? '可互助' : '求帮助'}</span></div><p class="whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(post.description)}</p>${post.tags.length ? `<div class="flex flex-wrap gap-2">${post.tags.map((tag) => `<span class="rounded-lg bg-surface-container-low px-3 py-1 text-label-sm text-on-surface-variant">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<div class="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"><div class="flex flex-col gap-1 text-body-sm"><span class="text-primary"><strong>我能提供：</strong>${escapeHtml(post.canOffer || post.title)}</span><span class="text-secondary"><strong>我想交流：</strong>${escapeHtml(post.wants || '欢迎留言交流')}</span></div>${post.isOwner ? '<span class="text-body-sm text-outline">这是你发布的内容</span>' : `<button type="button" class="rounded-xl bg-primary px-5 py-2.5 text-label-md text-on-primary hover:bg-secondary" data-skill-contact="${escapeHtml(post.id)}">联系同学</button>`}</div></article>`;
}

export function initSkills(): void {
  const offers = document.querySelector<HTMLElement>('#skill-offers');
  const requests = document.querySelector<HTMLElement>('#skill-requests');
  const form = document.querySelector<HTMLElement>('#skill-form');
  const submitButton =
    document.querySelector<HTMLButtonElement>('#skill-submit');
  const modal = document.querySelector<HTMLElement>('#publish-modal');
  if (!offers || !requests || !form) return;
  let category = 'all';
  let kind: 'offer' | 'request' = 'offer';
  let allPosts: SkillPost[] = [];

  const render = (): void => {
    const visible = allPosts.filter(
      (post) => category === 'all' || post.category === category,
    );
    const offerPosts = visible.filter((post) => post.kind === 'offer');
    const requestPosts = visible.filter((post) => post.kind === 'request');
    offers.innerHTML = `<div class="flex items-center justify-between gap-3"><h2 class="flex items-center gap-2 font-headline-md text-primary"><span class="material-symbols-outlined text-secondary" aria-hidden="true">psychology</span>技能分享</h2><span class="text-body-sm text-outline">${offerPosts.length} 条</span></div>${offerPosts.length ? offerPosts.map((post) => skillCard(post)).join('') : '<div class="rounded-xl border border-dashed border-outline-variant p-7 text-body-sm text-outline">还没有符合条件的技能分享。</div>'}`;
    requests.innerHTML = `<div class="flex items-center justify-between gap-3"><h2 class="flex items-center gap-2 font-headline-md text-primary"><span class="material-symbols-outlined text-secondary" aria-hidden="true">forum</span>求助广场</h2><span class="text-body-sm text-outline">${requestPosts.length} 条</span></div>${requestPosts.length ? requestPosts.map((post) => skillCard(post, true)).join('') : '<div class="rounded-xl border border-dashed border-outline-variant p-6 text-body-sm text-outline">暂时没有匹配的求助。</div>'}`;
    const activeCount = document.querySelector<HTMLElement>(
      '[data-skill-active-count]',
    );
    const offerCount = document.querySelector<HTMLElement>(
      '[data-skill-offer-count]',
    );
    if (activeCount) activeCount.textContent = String(allPosts.length);
    if (offerCount)
      offerCount.textContent = String(
        allPosts.filter((post) => post.kind === 'offer').length,
      );
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
  };

  const load = async (): Promise<void> => {
    try {
      const query =
        category === 'all' ? '' : `?category=${encodeURIComponent(category)}`;
      const response = await api<SkillResponse>(`/api/skills${query}`);
      allPosts = response.items;
      render();
    } catch (error) {
      offers.innerHTML = `<p class="rounded-xl bg-error-container p-6 text-body-sm text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '互助内容加载失败')}。请启动 API 后重试。</p>`;
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
}
