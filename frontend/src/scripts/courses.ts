import {
  api,
  escapeHtml,
  jsonBody,
  showToast,
  type Course,
  type Review,
} from './api';

interface CourseResponse {
  items: Course[];
  total: number;
}

function reviewStars(score: number): string {
  return `<span class="font-headline-md text-primary">${score.toFixed(1)}</span><span class="ml-1 text-body-sm text-outline">/ 10</span>`;
}

export function initCourses(): void {
  const list = document.querySelector<HTMLElement>('#course-list');
  const detail = document.querySelector<HTMLElement>('#course-detail');
  const search = document.querySelector<HTMLInputElement>('#course-search');
  const filters = [
    ...document.querySelectorAll<HTMLSelectElement>('[data-course-filter]'),
  ];
  const reviewButton = document.querySelector<HTMLButtonElement>('#review-cta');
  if (!list || !detail) return;

  let courses: Course[] = [];
  let selected: Course | null = null;
  let pendingTimer = 0;

  const renderList = (): void => {
    const filtered = courses;
    list.innerHTML = `<div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">找到 ${filtered.length} 门相关课程</h3><span class="text-body-sm text-outline">按评分排序</span></div>${
      filtered.length
        ? filtered
            .map(
              (course) => `
      <button type="button" data-course-id="${escapeHtml(course.id)}" class="${selected?.id === course.id ? 'ring-2 ring-primary shadow-md' : 'shadow-sm hover:shadow-md'} group relative w-full overflow-hidden rounded-xl bg-surface p-5 text-left transition-all">
        <div class="mb-3 flex items-start justify-between gap-4"><div><span class="font-mono text-label-sm text-outline">${escapeHtml(course.code)}</span><h4 class="font-headline-sm text-primary group-hover:text-secondary">${escapeHtml(course.title)}</h4>${course.englishTitle ? `<p class="text-body-sm text-outline">${escapeHtml(course.englishTitle)}</p>` : ''}</div><div class="shrink-0 text-right">${reviewStars(Number(course.rating))}<span class="block text-label-sm text-outline">${Number(course.reviewCount)} 条评价</span></div></div>
        <div class="mb-4 flex flex-wrap items-center gap-2"><span class="rounded-md bg-secondary-container px-2.5 py-0.5 text-label-sm text-on-secondary-container">${escapeHtml(course.courseType)}</span><span class="rounded-md bg-surface-container-high px-2.5 py-0.5 text-label-sm text-on-surface-variant">${course.credits} 学分</span><span class="rounded-md bg-surface-container-high px-2.5 py-0.5 text-label-sm text-on-surface-variant">${escapeHtml(course.term)}</span><span class="ml-auto text-body-sm text-outline">难度 ${Number(course.difficulty).toFixed(1)}/5</span></div>
        <div class="flex items-center justify-between border-t border-surface-variant pt-3 text-body-sm text-on-surface-variant"><span>${escapeHtml(course.department)}</span><span class="font-medium text-secondary">${escapeHtml(course.enrollmentType)} · ${escapeHtml(course.assessment)}</span></div>
      </button>`,
            )
            .join('')
        : '<div class="rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-sm text-outline">没有符合条件的课程，试试清除筛选条件。</div>'
    }`;
    list
      .querySelectorAll<HTMLButtonElement>('[data-course-id]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          selected =
            courses.find((course) => course.id === button.dataset.courseId) ??
            null;
          renderList();
          void renderDetails();
        });
      });
  };

  const loadReviews = async (course: Course): Promise<Review[]> => {
    const response = await api<{ items: Review[] }>(
      `/api/courses/${encodeURIComponent(course.id)}/reviews`,
    );
    return response.items;
  };

  const renderDetails = async (): Promise<void> => {
    if (!selected) {
      detail.innerHTML =
        '<div class="rounded-xl bg-surface p-8 text-center text-body-sm text-outline">从左侧选择一门课程，查看评价。</div>';
      return;
    }
    const course = selected;
    detail.innerHTML = `<section class="rounded-xl bg-surface p-6 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-5"><div><span class="font-mono text-label-sm text-outline">${escapeHtml(course.code)}</span><h2 class="mt-1 font-headline-lg text-primary">${escapeHtml(course.title)}</h2><p class="mt-2 text-body-md text-on-surface-variant">${escapeHtml(course.department)} · ${escapeHtml(course.courseType)} · ${course.credits} 学分</p></div><div class="text-right"><div class="font-headline-xl text-primary">${Number(course.rating).toFixed(1)}</div><div class="text-body-sm text-outline">${Number(course.reviewCount)} 条公开评价</div></div></div><div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">修读性质</span><strong class="text-label-md text-primary">${escapeHtml(course.enrollmentType)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">学期</span><strong class="text-label-md text-primary">${escapeHtml(course.term)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">考核方式</span><strong class="text-label-md text-primary">${escapeHtml(course.assessment)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">平均难度</span><strong class="text-label-md text-primary">${Number(course.difficulty).toFixed(1)}/5</strong></div></div></section><section class="mt-6 rounded-xl bg-surface p-6 shadow-sm"><div class="mb-4 flex items-center justify-between gap-4"><div><h3 class="font-headline-md text-primary">同学评价</h3><p class="text-body-sm text-outline">评价经审核后公开，不显示发布者身份。</p></div><button class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary hover:bg-secondary" data-write-review>写条评价</button></div><div data-review-list><p class="text-body-sm text-outline">正在加载评价…</p></div></section>`;
    detail
      .querySelector('[data-write-review]')
      ?.addEventListener('click', openReviewModal);
    try {
      const reviews = await loadReviews(course);
      if (selected?.id !== course.id) return;
      const reviewList =
        detail.querySelector<HTMLElement>('[data-review-list]');
      if (!reviewList) return;
      reviewList.innerHTML = reviews.length
        ? reviews
            .map(
              (review) =>
                `<article class="border-t border-surface-variant py-5 first:border-0"><div class="flex flex-wrap items-center justify-between gap-2"><div><strong class="text-label-md text-primary">${escapeHtml(review.author)}</strong><span class="ml-3 text-body-sm text-outline">${escapeHtml(review.term)} · ${new Date(review.createdAt).toLocaleDateString('zh-CN')}</span></div><span class="font-headline-sm text-secondary">${Number(review.rating).toFixed(1)} / 10</span></div><p class="mt-3 whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(review.content)}</p><div class="mt-3 flex flex-wrap gap-2"><span class="rounded-full bg-surface-container-low px-3 py-1 text-body-sm text-outline">难度 ${Number(review.difficulty).toFixed(1)}/5</span><span class="rounded-full bg-surface-container-low px-3 py-1 text-body-sm text-outline">作业量 ${Number(review.workload).toFixed(1)}/5</span>${review.tags.map((tag) => `<span class="rounded-full bg-secondary-container px-3 py-1 text-body-sm text-on-secondary-container">${escapeHtml(tag)}</span>`).join('')}</div></article>`,
            )
            .join('')
        : '<p class="py-6 text-body-sm text-outline">还没有公开评价，欢迎分享你的真实修课体验。</p>';
    } catch (error) {
      const reviewList =
        detail.querySelector<HTMLElement>('[data-review-list]');
      if (reviewList)
        reviewList.innerHTML = `<p class="text-body-sm text-error">${escapeHtml(error instanceof Error ? error.message : '评价读取失败')}</p>`;
    }
  };

  const modal = document.createElement('dialog');
  modal.className =
    'w-[min(94vw,42rem)] rounded-2xl border border-surface-variant bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-primary/30';
  modal.innerHTML = `<form class="p-6" data-review-form><div class="mb-5 flex items-start justify-between gap-3"><div><h2 class="font-headline-lg text-primary">写一条课程评价</h2><p class="mt-1 text-body-sm text-outline" data-review-course>先选择课程</p></div><button type="button" class="rounded-lg px-3 py-2 text-body-sm text-outline hover:bg-surface-container-low" data-close-review>关闭</button></div><div class="grid grid-cols-1 gap-4 sm:grid-cols-3"><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">综合评分（1–10）<input name="rating" type="number" min="1" max="10" step="0.5" value="8" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">课程难度（1–5）<input name="difficulty" type="number" min="1" max="5" step="0.5" value="3" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">作业量（1–5）<input name="workload" type="number" min="1" max="5" step="0.5" value="3" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label></div><label class="mt-4 flex flex-col gap-2 text-label-sm text-on-surface-variant">修读学期<input name="term" value="2026 秋" minlength="3" maxlength="40" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="mt-4 flex flex-col gap-2 text-label-sm text-on-surface-variant">评价内容<textarea name="content" minlength="10" maxlength="1200" rows="5" required placeholder="写下课程内容、考核方式和修读建议。请勿包含他人隐私。" class="resize-y rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></textarea></label><p class="mt-3 text-body-sm text-outline">为保护社区，评价提交后先进入审核队列；页面不会公开你的账号身份。</p><div class="mt-5 flex justify-end gap-3"><button type="button" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-close-review>取消</button><button type="submit" class="rounded-lg bg-primary px-5 py-2 text-label-sm text-on-primary hover:bg-secondary">提交审核</button></div></form>`;
  document.body.append(modal);
  modal
    .querySelectorAll('[data-close-review]')
    .forEach((button) => button.addEventListener('click', () => modal.close()));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
  const form = modal.querySelector<HTMLFormElement>('[data-review-form]');

  const openReviewModal = (): void => {
    if (!selected) {
      showToast('请先从左侧选择一门课程。', 'info');
      return;
    }
    const courseName = modal.querySelector<HTMLElement>('[data-review-course]');
    if (courseName)
      courseName.textContent = `${selected.code} · ${selected.title}`;
    modal.showModal();
  };
  window.openReviewModal = openReviewModal;
  reviewButton?.addEventListener('click', openReviewModal);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selected || !form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    const values = new FormData(form);
    try {
      const response = await api<{ message: string }>(
        `/api/courses/${encodeURIComponent(selected.id)}/reviews`,
        {
          method: 'POST',
          body: jsonBody({
            rating: Number(values.get('rating')),
            difficulty: Number(values.get('difficulty')),
            workload: Number(values.get('workload')),
            term: String(values.get('term')),
            content: String(values.get('content')),
          }),
        },
      );
      modal.close();
      form.reset();
      showToast(response.message, 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '提交失败，请检查登录状态。',
        'error',
      );
    } finally {
      if (button) button.disabled = false;
    }
  });

  const load = async (): Promise<void> => {
    const params = new URLSearchParams();
    const query = search?.value.trim();
    if (query) params.set('q', query);
    filters.forEach((select) => {
      const field = select.dataset.courseFilter;
      const selectedText = select.selectedOptions[0]?.textContent?.trim() ?? '';
      const value = selectedText.replace(/^[^:：]+[:：]\s*/, '');
      if (!value || value === '全部' || value === '全部学院') return;
      if (field) params.set(field, value);
    });
    try {
      const response = await api<CourseResponse>(
        `/api/courses?${params.toString()}`,
      );
      courses = response.items;
      const requested = new URLSearchParams(location.search).get('course');
      selected =
        courses.find(
          (course) => course.id === requested || course.code === requested,
        ) ?? selected;
      if (!selected || !courses.some((course) => course.id === selected?.id))
        selected = courses[0] ?? null;
      renderList();
      await renderDetails();
    } catch (error) {
      list.innerHTML = `<div class="rounded-xl border border-error/20 bg-error-container p-6 text-body-sm text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '课程加载失败')}。请确认 API 服务已启动。</div>`;
    }
  };
  search?.addEventListener('input', () => {
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => void load(), 220);
  });
  filters.forEach((filter) =>
    filter.addEventListener('change', () => void load()),
  );
  window.addEventListener(
    'shenxiaoli:session-changed',
    () => void renderDetails(),
  );
  void load();
}
