import {
  api,
  escapeHtml,
  jsonBody,
  showToast,
  type Course,
  type Review,
} from './api';
import { bindCommentSlots, commentSlot } from './comments';

interface CourseResponse {
  items: Course[];
  total: number;
  page: number;
  pageSize: number;
}

interface CourseDetails extends Course {
  offerings: Array<{
    id: string;
    term: string;
    section: string;
    teachers: Array<{ id: string; name: string; department: string }>;
  }>;
}

interface TeacherSummary {
  id: string;
  code: string | null;
  name: string;
  department: string;
  offeringCount: number;
  reviewCount: number;
  rating: number;
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
  const teacherSearch =
    document.querySelector<HTMLInputElement>('#teacher-search');
  const teacherResults =
    document.querySelector<HTMLElement>('#teacher-results');
  const teacherDetail = document.querySelector<HTMLElement>('#teacher-detail');
  const reviewButton = document.querySelector<HTMLButtonElement>('#review-cta');
  if (!list || !detail) return;

  let courses: Course[] = [];
  let selected: Course | null = null;
  let pendingTimer = 0;
  let teacherTimer = 0;
  let activeTeacherId: string | null = null;
  let focusedTeacherId: string | null = null;
  let coursePage = 1;
  let courseTotal = 0;

  const renderList = (): void => {
    const filtered = courses;
    list.innerHTML = `<div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">找到 ${courseTotal} 门相关课程</h3><span class="text-body-sm text-outline">已显示 ${filtered.length} 门</span></div>${
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
    }${filtered.length < courseTotal ? '<button type="button" data-courses-next class="rounded-lg border border-outline-variant bg-surface px-4 py-3 text-label-sm text-primary hover:bg-surface-container-low">加载更多课程</button>' : ''}`;
    list
      .querySelectorAll<HTMLButtonElement>('[data-course-id]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          selected =
            courses.find((course) => course.id === button.dataset.courseId) ??
            null;
          activeTeacherId = null;
          renderList();
          void renderDetails();
        });
      });
    list
      .querySelector<HTMLButtonElement>('[data-courses-next]')
      ?.addEventListener('click', () => void load(true));
  };

  const loadReviews = async (
    course: Course,
    teacherId: string | null,
    page = 1,
  ): Promise<{ items: Review[]; total: number; page: number }> => {
    const params = new URLSearchParams();
    if (teacherId) params.set('teacherId', teacherId);
    params.set('page', String(page));
    params.set('pageSize', '20');
    const response = await api<{
      items: Review[];
      total: number;
      page: number;
    }>(
      `/api/courses/${encodeURIComponent(course.id)}/reviews${params.size ? `?${params}` : ''}`,
    );
    return response;
  };

  const reviewCard = (review: Review): string =>
    `<article class="border-t border-surface-variant py-5 first:border-0"><div class="flex flex-wrap items-center justify-between gap-2"><div><strong class="text-label-md text-primary">${escapeHtml(review.author)}</strong><span class="ml-3 text-body-sm text-outline">${escapeHtml(review.term)} · ${new Date(review.createdAt).toLocaleDateString('zh-CN')}</span></div><span class="font-headline-sm text-secondary">${Number(review.rating).toFixed(1)} / 10</span></div><p class="mt-3 whitespace-pre-line text-body-md leading-7 text-on-surface">${escapeHtml(review.content)}</p><div class="mt-3 flex flex-wrap gap-2"><span class="rounded-full bg-surface-container-low px-3 py-1 text-body-sm text-outline">难度 ${Number(review.difficulty).toFixed(1)}/5</span><span class="rounded-full bg-surface-container-low px-3 py-1 text-body-sm text-outline">作业量 ${Number(review.workload).toFixed(1)}/5</span>${review.tags.map((tag) => `<span class="rounded-full bg-secondary-container px-3 py-1 text-body-sm text-on-secondary-container">${escapeHtml(tag)}</span>`).join('')}</div>${commentSlot('review', review.id)}</article>`;

  const renderDetails = async (): Promise<void> => {
    if (!selected) {
      detail.innerHTML =
        '<div class="rounded-xl bg-surface p-8 text-center text-body-sm text-outline">从左侧选择一门课程，查看评价。</div>';
      return;
    }
    const course = selected;
    let courseDetails: CourseDetails | null = null;
    try {
      courseDetails = await api<CourseDetails>(
        `/api/courses/${encodeURIComponent(course.id)}`,
      );
    } catch {
      courseDetails = null;
    }
    if (selected?.id !== course.id) return;
    const offeringHtml = courseDetails?.offerings.length
      ? `<section class="mt-5 rounded-lg bg-surface-container-low p-4"><h3 class="font-headline-sm text-primary">开课与教师</h3><div class="mt-3 space-y-3">${courseDetails.offerings.map((offering) => `<div class="border-t border-surface-variant pt-3 first:border-0 first:pt-0"><p class="text-body-sm text-outline">${escapeHtml(offering.term)}${offering.section ? ` · ${escapeHtml(offering.section)}` : ''}</p><div class="mt-2 flex flex-wrap gap-2">${offering.teachers.map((teacher) => `<button type="button" data-review-teacher="${escapeHtml(teacher.id)}" class="rounded-lg bg-surface px-3 py-1.5 text-body-sm text-primary hover:bg-secondary-container">${escapeHtml(teacher.name)} · 查看该教师评价</button>`).join('') || '<span class="text-body-sm text-outline">教师信息待补充</span>'}</div></div>`).join('')}</div></section>`
      : '<p class="mt-4 rounded-lg bg-surface-container-low p-4 text-body-sm text-outline">这门课程还没有已导入的开课和教师记录。</p>';
    detail.innerHTML = `<section class="rounded-xl bg-surface p-6 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-5"><div><span class="font-mono text-label-sm text-outline">${escapeHtml(course.code)}</span><h2 class="mt-1 font-headline-lg text-primary">${escapeHtml(course.title)}</h2><p class="mt-2 text-body-md text-on-surface-variant">${escapeHtml(course.department)} · ${escapeHtml(course.courseType)} · ${course.credits} 学分</p></div><div class="text-right"><div class="font-headline-xl text-primary">${Number(course.rating).toFixed(1)}</div><div class="text-body-sm text-outline">${Number(course.reviewCount)} 条公开评价</div></div></div><div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">修读性质</span><strong class="text-label-md text-primary">${escapeHtml(course.enrollmentType)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">学期</span><strong class="text-label-md text-primary">${escapeHtml(course.term)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">考核方式</span><strong class="text-label-md text-primary">${escapeHtml(course.assessment)}</strong></div><div class="rounded-lg bg-surface-container-low p-3"><span class="block text-body-sm text-outline">平均难度</span><strong class="text-label-md text-primary">${Number(course.difficulty).toFixed(1)}/5</strong></div></div>${offeringHtml}</section><section class="mt-6 rounded-xl bg-surface p-6 shadow-sm"><div class="mb-4 flex items-center justify-between gap-4"><div><h3 class="font-headline-md text-primary">${activeTeacherId ? '该教师的课程评价' : '同学评价'}</h3><p class="text-body-sm text-outline">评价经审核后公开，不显示发布者身份。</p></div><button class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary hover:bg-secondary" data-write-review>写条评价</button></div><div data-review-list><p class="text-body-sm text-outline">正在加载评价…</p></div></section>`;
    detail
      .querySelector('[data-write-review]')
      ?.addEventListener('click', openReviewModal);
    try {
      const response = await loadReviews(course, activeTeacherId);
      if (selected?.id !== course.id) return;
      let reviewPage = response.page;
      const reviewTotal = response.total;
      const reviewList =
        detail.querySelector<HTMLElement>('[data-review-list]');
      if (!reviewList) return;
      reviewList.innerHTML = response.items.length
        ? `<div data-review-items>${response.items.map(reviewCard).join('')}</div>${response.items.length < reviewTotal ? '<button type="button" data-reviews-next class="mt-4 w-full rounded-lg border border-outline-variant px-4 py-3 text-label-sm text-primary">加载更多评价</button>' : ''}`
        : '<p class="py-6 text-body-sm text-outline">还没有公开评价，欢迎分享你的真实修课体验。</p>';
      bindCommentSlots(reviewList);
      reviewList
        .querySelector('[data-reviews-next]')
        ?.addEventListener('click', async (event) => {
          const button = event.currentTarget as HTMLButtonElement;
          button.disabled = true;
          try {
            const next = await loadReviews(
              course,
              activeTeacherId,
              reviewPage + 1,
            );
            if (selected?.id !== course.id) return;
            reviewPage = next.page;
            reviewList
              .querySelector('[data-review-items]')
              ?.insertAdjacentHTML(
                'beforeend',
                next.items.map(reviewCard).join(''),
              );
            bindCommentSlots(reviewList);
            if (reviewPage * 20 >= reviewTotal) button.remove();
            else button.disabled = false;
          } catch (error) {
            button.disabled = false;
            showToast(
              error instanceof Error ? error.message : '评价加载失败',
              'error',
            );
          }
        });
    } catch (error) {
      const reviewList =
        detail.querySelector<HTMLElement>('[data-review-list]');
      if (reviewList)
        reviewList.innerHTML = `<p class="text-body-sm text-error">${escapeHtml(error instanceof Error ? error.message : '评价读取失败')}</p>`;
    }
    detail
      .querySelectorAll<HTMLButtonElement>('[data-review-teacher]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          activeTeacherId = button.dataset.reviewTeacher ?? null;
          void renderDetails();
        }),
      );
  };

  const modal = document.createElement('dialog');
  modal.className =
    'w-[min(94vw,42rem)] rounded-2xl border border-surface-variant bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-primary/30';
  modal.innerHTML = `<form class="p-6" data-review-form><div class="mb-5 flex items-start justify-between gap-3"><div><h2 class="font-headline-lg text-primary">写一条课程评价</h2><p class="mt-1 text-body-sm text-outline" data-review-course>先选择课程</p></div><button type="button" class="rounded-lg px-3 py-2 text-body-sm text-outline hover:bg-surface-container-low" data-close-review>关闭</button></div><div class="grid grid-cols-1 gap-4 sm:grid-cols-3"><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">综合评分（1–10）<input name="rating" type="number" min="1" max="10" step="0.5" value="8" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">课程难度（1–5）<input name="difficulty" type="number" min="1" max="5" step="0.5" value="3" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="flex flex-col gap-2 text-label-sm text-on-surface-variant">作业量（1–5）<input name="workload" type="number" min="1" max="5" step="0.5" value="3" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label></div><label class="mt-4 flex flex-col gap-2 text-label-sm text-on-surface-variant">授课教师与开课记录<select name="offeringId" class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"><option value="">教师信息待补充 / 手动填写学期</option></select></label><label class="mt-4 flex flex-col gap-2 text-label-sm text-on-surface-variant">修读学期<input name="term" value="2026 秋" minlength="3" maxlength="40" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></label><label class="mt-4 flex flex-col gap-2 text-label-sm text-on-surface-variant">评价内容<textarea name="content" minlength="10" maxlength="1200" rows="5" required placeholder="写下课程内容、考核方式和修读建议。请勿包含他人隐私。" class="resize-y rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-md"></textarea></label><p class="mt-3 text-body-sm text-outline">评价会即时公开，并接受后续巡查；页面不会公开你的账号身份。</p><div class="mt-5 flex justify-end gap-3"><button type="button" class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-close-review>取消</button><button type="submit" class="rounded-lg bg-primary px-5 py-2 text-label-sm text-on-primary hover:bg-secondary">发布评价</button></div></form>`;
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
    const offeringSelect = form?.elements.namedItem(
      'offeringId',
    ) as HTMLSelectElement | null;
    const termInput = form?.elements.namedItem(
      'term',
    ) as HTMLInputElement | null;
    if (offeringSelect && termInput) {
      void api<CourseDetails>(`/api/courses/${encodeURIComponent(selected.id)}`)
        .then((details) => {
          offeringSelect.innerHTML = `<option value="">教师信息待补充 / 手动填写学期</option>${details.offerings.map((offering) => `<option value="${escapeHtml(offering.id)}" data-term="${escapeHtml(offering.term)}">${escapeHtml(offering.term)}${offering.section ? ` · ${escapeHtml(offering.section)}` : ''} · ${offering.teachers.map((teacher) => escapeHtml(teacher.name)).join('、') || '教师待补充'}</option>`).join('')}`;
        })
        .catch(() => {
          offeringSelect.innerHTML =
            '<option value="">教师信息待补充 / 手动填写学期</option>';
        });
      offeringSelect.onchange = () => {
        const selectedOption = offeringSelect.selectedOptions[0];
        const term = selectedOption?.dataset.term;
        if (term) termInput.value = term;
      };
    }
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
            offeringId: String(values.get('offeringId') ?? ''),
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

  const load = async (append = false): Promise<void> => {
    const params = new URLSearchParams();
    params.set('page', String(append ? coursePage + 1 : 1));
    params.set('pageSize', '20');
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
      courses = append ? [...courses, ...response.items] : response.items;
      coursePage = response.page;
      courseTotal = response.total;
      if (!append) {
        const requested = new URLSearchParams(location.search).get('course');
        selected =
          courses.find(
            (course) => course.id === requested || course.code === requested,
          ) ??
          courses[0] ??
          null;
        activeTeacherId = null;
      }
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
  const teacherLoad = async (append = false): Promise<void> => {
    if (!teacherResults) return;
    const params = new URLSearchParams({
      page: String(append ? teacherPage + 1 : 1),
      pageSize: '20',
    });
    const query = teacherSearch?.value.trim();
    if (query) params.set('q', query);
    try {
      const response = await api<{
        items: TeacherSummary[];
        total: number;
        page: number;
      }>(`/api/teachers?${params}`);
      teacherPage = response.page;
      teacherTotal = response.total;
      const items = append
        ? [...teacherItems, ...response.items]
        : response.items;
      teacherItems = items;
      teacherResults.innerHTML = `${items.map((teacher) => `<button type="button" data-teacher-id="${escapeHtml(teacher.id)}" class="flex w-full items-center justify-between gap-3 rounded-lg bg-surface-container-low px-4 py-3 text-left hover:bg-secondary-container"><span><strong class="block text-label-md text-primary">${escapeHtml(teacher.name)}</strong><span class="text-body-sm text-outline">${escapeHtml(teacher.department)}${teacher.code ? ` · ${escapeHtml(teacher.code)}` : ''}</span></span><span class="text-right text-body-sm text-outline">${Number(teacher.reviewCount)} 条评价<br>${Number(teacher.offeringCount)} 个开课</span></button>`).join('') || '<p class="rounded-lg bg-surface-container-low p-4 text-body-sm text-outline">没有找到教师记录。</p>'}${items.length < teacherTotal ? '<button type="button" data-teachers-next class="w-full rounded-lg border border-outline-variant px-4 py-2 text-body-sm text-primary">加载更多教师</button>' : ''}`;
    } catch (error) {
      teacherResults.innerHTML = `<p class="text-body-sm text-error">${escapeHtml(error instanceof Error ? error.message : '教师读取失败')}</p>`;
    }
  };
  let teacherPage = 1;
  let teacherTotal = 0;
  let teacherItems: TeacherSummary[] = [];
  let teacherOfferingPage = 1;
  let teacherOfferingTotal = 0;
  let teacherOfferings: Array<{
    courseId: string;
    courseCode: string;
    courseTitle: string;
    term: string;
    section: string;
  }> = [];
  const showTeacher = async (
    teacherId: string,
    page = 1,
    append = false,
  ): Promise<void> => {
    if (!teacherDetail) return;
    teacherDetail.innerHTML = '<p>正在读取教师授课记录…</p>';
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      });
      const profile = await api<{
        name: string;
        code: string | null;
        department: string;
        offerings: typeof teacherOfferings;
        total: number;
        page: number;
      }>(`/api/teachers/${encodeURIComponent(teacherId)}?${params}`);
      teacherOfferings = append
        ? [...teacherOfferings, ...profile.offerings]
        : profile.offerings;
      teacherOfferingPage = profile.page;
      teacherOfferingTotal = profile.total;
      teacherDetail.innerHTML = `<h3 class="font-headline-md text-primary">${escapeHtml(profile.name)}</h3><p class="mt-1 text-body-sm text-outline">${escapeHtml(profile.department)}${profile.code ? ` · ${escapeHtml(profile.code)}` : ''}</p><h4 class="mt-5 text-label-md text-primary">授课记录（${teacherOfferings.length} / ${teacherOfferingTotal}）</h4><div class="mt-2 space-y-2">${teacherOfferings.map((offering) => `<button type="button" data-teacher-course="${escapeHtml(offering.courseCode)}" class="flex w-full items-center justify-between gap-3 rounded-lg bg-surface px-3 py-3 text-left hover:bg-secondary-container"><span><strong class="block text-label-sm text-primary">${escapeHtml(offering.courseCode)} · ${escapeHtml(offering.courseTitle)}</strong><span class="text-body-sm text-outline">${escapeHtml(offering.term)}${offering.section ? ` · ${escapeHtml(offering.section)}` : ''}</span></span><span class="text-body-sm text-secondary">查看评价</span></button>`).join('') || '<p class="text-body-sm text-outline">暂无在授课程记录。</p>'}</div>${teacherOfferings.length < teacherOfferingTotal ? '<button type="button" class="mt-3 text-xs text-primary underline" data-teacher-offerings-more>加载更多授课记录</button>' : ''}`;
      teacherDetail
        .querySelector('[data-teacher-offerings-more]')
        ?.addEventListener(
          'click',
          () => void showTeacher(teacherId, teacherOfferingPage + 1, true),
        );
    } catch (error) {
      teacherDetail.innerHTML = `<p class="text-body-sm text-error">${escapeHtml(error instanceof Error ? error.message : '教师信息读取失败')}</p>`;
    }
  };
  teacherResults?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-teacher-id]');
    if (button?.dataset.teacherId) {
      focusedTeacherId = button.dataset.teacherId;
      teacherOfferings = [];
      void showTeacher(button.dataset.teacherId);
    }
    if (target.closest('[data-teachers-next]')) void teacherLoad(true);
  });
  teacherDetail?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-teacher-course]');
    const code = button?.dataset.teacherCourse;
    if (!code) return;
    if (search) search.value = code;
    await load();
    if (selected) {
      activeTeacherId = focusedTeacherId;
      await renderDetails();
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  teacherSearch?.addEventListener('input', () => {
    window.clearTimeout(teacherTimer);
    teacherTimer = window.setTimeout(() => void teacherLoad(), 220);
  });
  teacherLoad();
  window.addEventListener(
    'shenxiaoli:session-changed',
    () => void renderDetails(),
  );
  void load();
}
