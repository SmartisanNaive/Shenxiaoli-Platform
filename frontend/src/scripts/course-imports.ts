import {
  api,
  escapeHtml as esc,
  jsonBody,
  showToast,
  type Course,
} from './api';

export interface PersonalCourse extends Course {
  offeringId: string;
  teacherNames: string[];
  active: number;
  offeringActive: number;
}
interface ImportSession {
  id: string;
  state: 'login' | 'second-factor' | 'authenticated' | 'preview';
  expiresAt: number;
  nextSendAt: number;
  config: {
    passwordEnabled: boolean;
    smsEnabled: boolean;
    captchaStyle: string | null;
    smsInterval: number;
  };
  semesters: { id: string; name: string; current: boolean }[];
  defaultSemesterId?: string;
}
interface Preview {
  previewId: string;
  term: string;
  items: {
    sourceKey: string;
    title: string;
    teachers: string[];
    courseCode: string;
    requiresChoice: boolean;
    matchedCourseId: string | null;
    candidates: { id: string; title: string; code: string; active: number }[];
  }[];
}
interface Captcha {
  kind: 'image' | 'slider' | 'points';
  image: string;
  piece?: string;
  words?: string[];
}
const fieldClass =
  'mt-2 w-full rounded border border-outline-variant bg-surface px-3 py-2 text-body-md';
const buttonClass =
  'rounded border border-outline-variant px-4 py-2 text-label-md text-primary aria-pressed:bg-primary aria-pressed:text-on-primary disabled:opacity-50';
const primaryClass =
  'rounded bg-primary px-4 py-2 text-label-md text-on-primary disabled:opacity-50';

export function initCourseImports(
  onSelect: (course: PersonalCourse, write: boolean) => void,
  onImported: () => void,
): void {
  const trigger =
    document.querySelector<HTMLButtonElement>('#course-import-cta');
  const panel = document.querySelector<HTMLElement>('#my-courses');
  const list = document.querySelector<HTMLElement>('#my-course-list');
  const term = document.querySelector<HTMLSelectElement>('#my-courses-term');
  if (!trigger || !panel || !list || !term) return;
  let personal: PersonalCourse[] = [];
  let listRequest = 0;
  let session: ImportSession | null = null;
  let method: 'sms' | 'password' = 'sms';
  let preview: Preview | null = null;
  let captcha: Captcha | null = null;
  let captchaVerified = false;
  let points: { x: number; y: number }[] = [];
  let busy = false;
  let generation = 0;
  let countdown = 0;
  let expired = false;

  const scope = (value: 'all' | 'mine'): void => {
    panel.hidden = value !== 'mine';
    document
      .querySelectorAll<HTMLElement>('[data-course-catalog]')
      .forEach((el) => {
        el.hidden = value === 'mine';
      });
    document
      .querySelectorAll<HTMLButtonElement>('[data-course-scope]')
      .forEach((el) => {
        el.setAttribute(
          'aria-pressed',
          String(el.dataset.courseScope === value),
        );
      });
  };
  const loadPersonal = async (): Promise<void> => {
    const request = ++listRequest;
    try {
      const selectedTerm = term.value;
      const result = await api<{ items: PersonalCourse[]; terms: string[] }>(
        `/api/me/courses?term=${encodeURIComponent(selectedTerm)}`,
      );
      if (request !== listRequest) return;
      personal = result.items;
      term.innerHTML = `<option value="">全部学期</option>${result.terms.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
      term.value = selectedTerm;
      list.innerHTML =
        personal
          .map(
            (course, index) =>
              `<article class="rounded border border-surface-variant bg-surface p-5"><div class="flex flex-wrap items-start justify-between gap-4"><div><h3 class="font-headline-sm text-primary">${esc(course.title)}</h3><p class="mt-2 text-body-sm text-outline">${esc(course.term)} · ${esc(course.teacherNames.join('、') || '教师待补充')}</p><p class="mt-1 text-body-sm text-outline">${esc(course.codePending ? '课程代码待补充' : course.code)} · ${course.reviewCount} 条评价</p></div><div class="flex gap-2">${course.active && course.offeringActive ? `<button type="button" data-my-view="${index}" class="${buttonClass}">查看评价</button><button type="button" data-my-write="${index}" class="${primaryClass}">写评价</button>` : '<span class="text-body-sm text-outline">课程或开课记录已停用</span>'}</div></div></article>`,
          )
          .join('') ||
        `<div class="rounded border border-dashed border-outline-variant p-8 text-center"><p class="text-body-md text-outline">${selectedTerm ? '该学期暂无导入课程。' : '还没有导入课程，登录教务后即可添加。'}</p><button type="button" data-start-import class="${buttonClass} mt-4">导入教务课程</button></div>`;
    } catch (error) {
      if (request === listRequest)
        list.textContent =
          error instanceof Error ? error.message : '个人课程读取失败';
    }
  };
  document
    .querySelectorAll<HTMLButtonElement>('[data-course-scope]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const value = button.dataset.courseScope === 'mine' ? 'mine' : 'all';
        scope(value);
        if (value === 'mine') void loadPersonal();
      }),
    );
  term.addEventListener('change', () => void loadPersonal());
  list.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button')
        : null;
    if (!target) return;
    if (target.hasAttribute('data-start-import')) {
      void open();
      return;
    }
    const write = target.dataset.myWrite !== undefined;
    const index = Number(
      write ? target.dataset.myWrite : target.dataset.myView,
    );
    const course = personal[index];
    if (course?.active && course.offeringActive) {
      if (!write) scope('all');
      onSelect(course, write);
    }
  });

  const dialog = document.createElement('dialog');
  dialog.className =
    'w-[min(94vw,44rem)] max-h-[90dvh] overflow-y-auto rounded border border-surface-variant bg-surface p-6 text-on-surface backdrop:bg-primary/30';
  dialog.setAttribute('aria-labelledby', 'course-import-title');
  dialog.innerHTML = `<div class="mb-4 flex items-center justify-between gap-3"><h2 id="course-import-title" class="font-headline-lg text-primary">导入教务课程</h2><button type="button" data-import-close class="${buttonClass}">关闭</button></div><p data-import-message role="status" class="mb-4 text-body-sm text-outline"></p><div data-import-body></div>`;
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('[data-import-body]')!;
  const message = dialog.querySelector<HTMLElement>('[data-import-message]')!;
  const notice = (value: string): void => {
    message.textContent = value;
  };
  const endpoint = (suffix: string): string =>
    `/api/me/course-imports/${encodeURIComponent(session!.id)}${suffix}`;
  const post = async <T>(suffix: string, body: unknown = {}): Promise<T> => {
    const current = generation;
    const value = await api<T>(endpoint(suffix), {
      method: 'POST',
      body: jsonBody(body),
    });
    if (current !== generation) throw new Error('导入已取消');
    return value;
  };
  const perform = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    const currentGeneration = generation;
    content.querySelectorAll<HTMLButtonElement>('button').forEach((el) => {
      el.disabled = true;
    });
    try {
      await fn();
      if (session && currentGeneration === generation)
        session.expiresAt = Date.now() + 180000;
    } catch (error) {
      if (currentGeneration !== generation) return;
      const status = (error as { status?: number }).status;
      if (status === 410 || status === 401) {
        expired = true;
        render();
      } else if (session) {
        const id = session.id;
        const fresh = await api<ImportSession>(
          `/api/me/course-imports/${encodeURIComponent(id)}`,
        ).catch(() => null);
        if (currentGeneration !== generation) return;
        if (fresh) {
          const changed = session?.state !== fresh.state;
          session = fresh;
          if (changed) render();
        }
      }
      notice(error instanceof Error ? error.message : '导入失败，请重试');
    } finally {
      if (currentGeneration === generation) {
        busy = false;
        content.querySelectorAll<HTMLButtonElement>('button').forEach((el) => {
          el.disabled = false;
        });
        tick();
      }
    }
  };
  const close = (): void => {
    generation++;
    const id = session?.id;
    session = null;
    preview = null;
    captcha = null;
    busy = false;
    content.replaceChildren();
    window.clearInterval(countdown);
    dialog.close();
    if (id)
      void api(`/api/me/course-imports/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
  };
  dialog.querySelector('[data-import-close]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  const tick = (): void => {
    if (!session || !dialog.open) return;
    if (Date.now() >= session.expiresAt && !busy && !expired) {
      expired = true;
      render();
      notice('教务导入会话已过期，请重新登录。');
      return;
    }
    const send = content.querySelector<HTMLButtonElement>('[data-import-send]');
    if (send) {
      const seconds = Math.max(
        0,
        Math.ceil((session.nextSendAt - Date.now()) / 1000),
      );
      send.disabled = busy || seconds > 0;
      send.textContent = seconds > 0 ? `${seconds} 秒后重发` : '获取短信验证码';
    }
    const confirm = content.querySelector<HTMLButtonElement>(
      '[data-import-confirm] button[type="submit"]',
    );
    if (confirm) confirm.disabled = busy || !preview?.items.length;
  };

  const render = (): void => {
    if (expired) {
      content.innerHTML = `<button type="button" data-import-restart class="${primaryClass}">重新登录教务</button>`;
      return;
    }
    if (!session) {
      content.textContent = '正在连接学校认证系统…';
      return;
    }
    if (session.state === 'login') {
      content.innerHTML = `<p class="mb-4 text-body-sm leading-6 text-outline">使用学校统一认证账号或学校绑定的手机号。验证码由学校发送。登录信息仅用于本次获取课表；导入后选课记录仅自己可见，缺失的课程资料会补充到公共课程库。</p><div class="mb-4 flex gap-2">${session.config.smsEnabled ? `<button type="button" data-import-method="sms" aria-pressed="${method === 'sms'}" class="${buttonClass}">手机号验证码</button>` : ''}${session.config.passwordEnabled ? `<button type="button" data-import-method="password" aria-pressed="${method === 'password'}" class="${buttonClass}">账号密码</button>` : ''}</div>${!session.config.smsEnabled && !session.config.passwordEnabled ? '<p>学校暂未开放可用的登录方式，请稍后重试。</p>' : `<form data-import-login><label class="block text-label-md">${method === 'sms' ? '学校绑定的手机号' : '学校统一认证账号'}<input name="account" aria-label="${method === 'sms' ? '学校绑定的手机号' : '学校统一认证账号'}" autocomplete="off" ${method === 'sms' ? 'type="tel" inputmode="numeric" pattern="1[3-9][0-9]{9}" maxlength="11"' : 'maxlength="100"'} required class="${fieldClass}"></label>${method === 'sms' ? `<div class="mt-4 flex flex-wrap items-end gap-3"><label class="min-w-0 flex-1 text-label-md">短信验证码<input name="mobileCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,8}" maxlength="8" required class="${fieldClass}"></label><button type="button" data-import-send class="${buttonClass}">获取短信验证码</button></div>` : `<label class="mt-4 block text-label-md">教务密码<input name="password" type="password" autocomplete="off" maxlength="256" required class="${fieldClass}"></label>${session.config.captchaStyle ? `<div data-import-captcha class="mt-4"><button type="button" data-captcha-refresh class="${buttonClass}">获取人机验证图片</button><div data-captcha-content class="mt-3"></div></div>` : ''}`}<label class="mt-5 flex items-start gap-2 text-body-sm"><input type="checkbox" name="consent" required class="mt-1 shrink-0"><span>我同意本次连接学校认证系统并获取个人课表，且已阅读学校<a href="https://sso.suat-sz.edu.cn/gravity-login/#/protocol?type=privacy" target="_blank" rel="noopener noreferrer" class="underline">隐私政策</a>与<a href="https://sso.suat-sz.edu.cn/gravity-login/#/protocol?type=terms" target="_blank" rel="noopener noreferrer" class="underline">服务条款</a>。</span></label><button type="submit" class="${primaryClass} mt-5">登录并获取学期</button></form>`}`;
    } else if (session.state === 'second-factor') {
      content.innerHTML = `<p class="mb-4 text-body-md">学校要求短信二次验证，请获取发送到账号绑定手机号的验证码。</p><form data-import-factor><label class="block text-label-md">二次验证短信验证码<input name="code" required pattern="[0-9]{4,8}" maxlength="8" inputmode="numeric" autocomplete="one-time-code" class="${fieldClass}"></label><div class="mt-4 flex flex-wrap gap-3"><button type="button" data-import-send class="${buttonClass}">获取短信验证码</button><button type="submit" class="${primaryClass}">验证并获取学期</button></div></form>`;
    } else if (preview) {
      content.innerHTML = `<p class="mb-4 text-body-md">${esc(preview.term)} · ${preview.items.length} 门课程${preview.items.some((v) => v.requiresChoice) ? '，请确认同名课程的关联。' : ''}</p><form data-import-confirm><div class="space-y-4">${preview.items.map((course, index) => `<div class="border-b border-surface-variant pb-4"><strong>${esc(course.title)}</strong><p class="mt-1 text-body-sm text-outline">${esc(course.teachers.join('、') || '教师待补充')} · ${esc(course.courseCode || '课程代码待补充')}</p>${course.requiresChoice ? `<label class="mt-2 block text-body-sm">课程关联<select required data-match-index="${index}" class="${fieldClass}"><option value="">请选择关联方式</option>${course.candidates.map((v) => `<option value="${esc(v.id)}" ${v.active ? '' : 'disabled'}>${esc(v.code)} · ${esc(v.title)}${v.active ? '' : '（已停用）'}</option>`).join('')}<option value="new">新增为另一门课程</option></select></label>` : `<p class="mt-1 text-body-sm text-outline">${course.matchedCourseId ? '关联已有课程' : '补充到公共课程库'}</p>`}</div>`).join('')}</div><div class="mt-5 flex flex-wrap gap-3"><button type="submit" class="${primaryClass}" ${preview.items.length ? '' : 'disabled'}>确认导入课程</button><button type="button" data-import-back class="${buttonClass}">重新选择学期</button></div></form>`;
    } else if (!session.semesters.length) {
      content.innerHTML = `<p class="mb-4 text-body-sm">教务登录已完成，尚未获取到学期列表。</p><button type="button" data-import-retry-semesters class="${primaryClass}">重试获取学期</button>`;
    } else {
      content.innerHTML = `<form data-import-semester><label class="block text-label-md">选择导入学期<select name="semesterId" required class="${fieldClass}">${session.semesters.map((v) => `<option value="${esc(v.id)}" ${v.id === session!.defaultSemesterId ? 'selected' : ''}>${esc(v.name)}${v.current ? '（当前学期）' : ''}</option>`).join('')}</select></label><button type="submit" class="${primaryClass} mt-5">获取课程并导入</button></form>`;
    }
    tick();
  };
  const open = async (): Promise<void> => {
    if (dialog.open) return;
    dialog.showModal();
    expired = false;
    preview = null;
    captcha = null;
    captchaVerified = false;
    method = 'sms';
    const currentGeneration = ++generation;
    notice('正在建立仅用于本次导入的教务会话。');
    render();
    await perform(async () => {
      const created = await api<ImportSession>('/api/me/course-imports', {
        method: 'POST',
        body: jsonBody({}),
      });
      if (currentGeneration !== generation) {
        void api(`/api/me/course-imports/${created.id}`, {
          method: 'DELETE',
        }).catch(() => undefined);
        return;
      }
      session = created;
      if (!created.config.smsEnabled) method = 'password';
      notice('请完成学校登录。');
      render();
      countdown = window.setInterval(tick, 1000);
    });
    if (!session && dialog.open)
      content.innerHTML = `<button type="button" data-import-restart class="${buttonClass}">重新连接学校</button>`;
  };
  trigger.addEventListener('click', () => void open());

  const showCaptcha = (): void => {
    const root = content.querySelector<HTMLElement>('[data-captcha-content]');
    if (!root || !captcha) return;
    const image = /^data:image\/(png|jpe?g);base64,[a-zA-Z0-9+/=\r\n]+$/.test(
      captcha.image,
    )
      ? captcha.image
      : '';
    const piece =
      captcha.piece &&
      /^data:image\/(png|jpe?g);base64,[a-zA-Z0-9+/=\r\n]+$/.test(captcha.piece)
        ? captcha.piece
        : '';
    root.innerHTML = `<p class="mb-2 text-body-sm">${captcha.kind === 'points' ? `请依次点击：${esc(captcha.words?.join('、'))}` : captcha.kind === 'slider' ? '请拖动滑块，将拼图移到缺口处，再点击验证。' : '请输入图片中的验证码。'}</p><div data-captcha-image-area class="relative max-w-full overflow-hidden ${captcha.kind === 'image' ? '' : 'w-[310px]'}"><img data-captcha-image src="${esc(image)}" alt="学校人机验证图片" class="block max-w-full ${captcha.kind === 'image' ? '' : 'w-full'}" ${captcha.kind === 'points' ? 'role="button" tabindex="0" aria-label="按提示依次点击图片中的文字"' : ''}>${piece ? `<img data-captcha-piece src="${esc(piece)}" alt="待移动拼图" class="pointer-events-none absolute left-0 top-0 h-full">` : ''}</div>${captcha.kind === 'image' ? `<label class="mt-2 block text-body-sm">图片验证码<input name="captcha" autocomplete="off" maxlength="20" class="${fieldClass}"></label>` : captcha.kind === 'slider' ? `<label class="mt-3 block text-body-sm">移动拼图<input data-captcha-slider type="range" min="0" max="310" value="0" step="1" class="mt-2 w-full" aria-label="移动拼图"></label><button type="button" data-captcha-verify class="${buttonClass} mt-2">验证拼图位置</button>` : '<p data-captcha-points class="mt-2 text-body-sm" aria-live="polite">已选择 0 个位置</p><button type="button" data-captcha-verify class="mt-2 rounded border border-outline-variant px-4 py-2">验证所选位置</button>'}`;
    const img = root.querySelector<HTMLImageElement>('[data-captcha-image]');
    if (captcha.kind === 'points')
      img?.addEventListener('click', (event) => {
        if (
          busy ||
          captchaVerified ||
          !captcha?.words ||
          points.length >= captcha.words.length
        )
          return;
        const rect = img!.getBoundingClientRect();
        points.push({
          x: Math.round(((event.clientX - rect.left) / rect.width) * 310),
          y: Math.round(((event.clientY - rect.top) / rect.height) * 155),
        });
        const count = root.querySelector('[data-captcha-points]');
        if (count)
          count.textContent = `已选择 ${points.length} / ${captcha.words.length} 个位置，选择错误时可重新获取图片。`;
      });
    root
      .querySelector<HTMLInputElement>('[data-captcha-slider]')
      ?.addEventListener('input', (event) => {
        const value = Number((event.target as HTMLInputElement).value);
        points = [{ x: value, y: 5 }];
        captchaVerified = false;
        const tile = root.querySelector<HTMLElement>('[data-captcha-piece]');
        if (tile) tile.style.left = `${(value / 310) * 100}%`;
      });
  };

  content.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button')
        : null;
    if (!target || busy) return;
    if (target.hasAttribute('data-import-restart')) {
      close();
      void open();
      return;
    }
    if (target.dataset.importMethod) {
      method = target.dataset.importMethod === 'password' ? 'password' : 'sms';
      captcha = null;
      captchaVerified = false;
      points = [];
      render();
      return;
    }
    if (target.hasAttribute('data-import-back')) {
      preview = null;
      render();
      return;
    }
    if (target.hasAttribute('data-import-retry-semesters'))
      void perform(async () => {
        session = await api<ImportSession>(endpoint('/semesters'));
        notice('已获取学期，请选择导入。');
        render();
      });
    if (target.hasAttribute('data-import-send'))
      void perform(async () => {
        if (session?.state === 'second-factor')
          session = await post<ImportSession>('/second-factor/send');
        else {
          const account =
            content.querySelector<HTMLInputElement>('[name="account"]')!;
          const consent =
            content.querySelector<HTMLInputElement>('[name="consent"]')!;
          if (!account.reportValidity() || !consent.reportValidity()) return;
          session = await post<ImportSession>('/sms', {
            mobile: account.value,
          });
        }
        notice('学校验证码已发送，请查看绑定手机号的短信。');
        tick();
      });
    if (target.hasAttribute('data-captcha-refresh'))
      void perform(async () => {
        captcha = await post<Captcha>('/captcha');
        captchaVerified = false;
        points = [];
        showCaptcha();
        notice('请手动完成学校人机验证。');
      });
    if (target.hasAttribute('data-captcha-verify'))
      void perform(async () => {
        await post('/captcha/verify', { points });
        captchaVerified = true;
        notice('人机验证已完成，可以提交登录。');
      });
  });
  content.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    void perform(async () => {
      const currentGeneration = generation;
      if (form.hasAttribute('data-import-login')) {
        if (
          method === 'password' &&
          captcha &&
          captcha.kind !== 'image' &&
          !captchaVerified
        ) {
          notice('请先完成学校人机验证。');
          return;
        }
        try {
          const state = await post<ImportSession>('/login', {
            method,
            account: values.get('account'),
            password: values.get('password'),
            mobileCode: values.get('mobileCode'),
            captcha: values.get('captcha'),
          });
          if (currentGeneration !== generation) return;
          session = state;
          preview = null;
          captcha = null;
          notice(
            state.state === 'second-factor'
              ? '请继续完成短信二次验证。'
              : '教务登录成功，请选择学期。',
          );
          render();
        } finally {
          const password =
            form.querySelector<HTMLInputElement>('[name="password"]');
          if (password) password.value = '';
        }
      } else if (form.hasAttribute('data-import-factor')) {
        const state = await post<ImportSession>('/second-factor/verify', {
          code: values.get('code'),
        });
        if (currentGeneration !== generation) return;
        session = state;
        notice('教务登录成功，请选择学期。');
        render();
      } else if (form.hasAttribute('data-import-semester')) {
        const result = await post<Preview>('/preview', {
          semesterId: values.get('semesterId'),
        });
        if (currentGeneration !== generation) return;
        preview = result;
        render();
        notice(
          result.items.length
            ? '请确认课程信息后导入。'
            : '该学期没有可导入的课程。',
        );
      } else if (form.hasAttribute('data-import-confirm') && preview) {
        const matches: Record<string, string> = {};
        form
          .querySelectorAll<HTMLSelectElement>('[data-match-index]')
          .forEach((select) => {
            const item = preview!.items[Number(select.dataset.matchIndex)];
            if (item) matches[item.sourceKey] = select.value;
          });
        const result = await post<{
          courseCount: number;
          newCourseCount: number;
        }>('/confirm', { previewId: preview.previewId, matches });
        if (currentGeneration !== generation) return;
        session = null;
        close();
        scope('mine');
        await loadPersonal();
        onImported();
        showToast(
          `已导入 ${result.courseCount} 门课程，补充 ${result.newCourseCount} 门新课程。`,
          'success',
        );
      }
    });
  });
  window.addEventListener('shenxiaoli:session-changed', () => {
    close();
    listRequest++;
    personal = [];
    list.replaceChildren();
    term.innerHTML = '<option value="">全部学期</option>';
    scope('all');
  });
  window.addEventListener('pagehide', () => {
    if (session)
      void fetch(endpoint(''), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      });
  });
}
