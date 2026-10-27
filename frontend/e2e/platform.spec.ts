import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('academic SMS import persists personal courses and connects to real reviews', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/course-evaluation.html');
  await page.getByRole('button', { name: '导入教务课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入教务课程' });
  await dialog
    .getByLabel('学校绑定的手机号', { exact: true })
    .fill('13800000000');
  await dialog.locator('[name="consent"]').check();
  await dialog
    .getByRole('button', { name: '获取短信验证码', exact: true })
    .click();
  await expect(dialog.locator('[data-import-send]')).toBeDisabled();
  await dialog.locator('[name="mobileCode"]').fill('000000');
  await dialog.getByRole('button', { name: '登录并获取学期' }).click();
  await expect(dialog.getByRole('status')).toContainText('验证码错误');
  await dialog.locator('[name="mobileCode"]').fill('123456');
  await dialog.getByRole('button', { name: '登录并获取学期' }).click();
  await expect(dialog.locator('[name="semesterId"]')).toHaveValue('100');
  await dialog.getByRole('button', { name: '获取课程并导入' }).click();
  await expect(dialog).toContainText('合成教务课程');
  await dialog.getByRole('button', { name: '确认导入课程' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#my-courses')).toBeVisible();
  await expect(page.locator('#my-course-list')).toContainText('合成教务教师');
  await page.reload();
  await page.getByRole('button', { name: '我的课程', exact: true }).click();
  await expect(page.locator('#my-course-list')).toContainText('合成教务课程');
  await page.screenshot({
    path: testInfo.outputPath('academic-personal-courses.png'),
    fullPage: true,
  });
  await page.locator('[data-my-write]').click();
  const review = page.locator('[data-review-form]');
  await expect(review.locator('[name="term"]')).toHaveValue('2026秋');
  await expect(review.locator('[name="offeringId"]')).not.toHaveValue('');
  await review
    .locator('[name="content"]')
    .fill('这是一条通过教务导入课程发布的真实接口测试评价。');
  await review.getByRole('button', { name: '发布评价', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('#course-detail')).toContainText(
    '通过教务导入课程发布',
  );
  await page.getByRole('button', { name: '全部课程', exact: true }).click();
  await expect(page.locator('#course-detail')).toBeVisible();
  const result = await page.request.get(
    '/api/courses/TEST-ACADEMIC-001/reviews',
  );
  expect(await result.json()).toMatchObject({ total: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('academic password captcha, second factor, cancellation and expiry are usable', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/course-evaluation.html');
  await page.getByRole('button', { name: '导入教务课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入教务课程' });
  await dialog.getByRole('button', { name: '账号密码', exact: true }).click();
  await dialog
    .getByLabel('学校统一认证账号', { exact: true })
    .fill('synthetic-student');
  await dialog.locator('[name="password"]').fill('academic-test-password');
  await dialog.getByRole('button', { name: '获取人机验证图片' }).click();
  await expect(dialog.locator('[data-captcha-image]')).toBeVisible();
  await dialog.locator('[name="captcha"]').fill('4');
  await dialog.locator('[name="consent"]').check();
  await page.screenshot({
    path: testInfo.outputPath('academic-password-captcha.png'),
  });
  await dialog.getByRole('button', { name: '登录并获取学期' }).click();
  await expect(dialog).toContainText('短信二次验证');
  await dialog
    .getByRole('button', { name: '获取短信验证码', exact: true })
    .click();
  await dialog.locator('[name="code"]').fill('123456');
  await dialog.getByRole('button', { name: '验证并获取学期' }).click();
  await expect(dialog.locator('[name="semesterId"]')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    await (await page.request.get('/api/me/courses')).json(),
  ).toMatchObject({ total: 0 });
  await page.getByRole('button', { name: '导入教务课程', exact: true }).click();
  await dialog
    .getByLabel('学校绑定的手机号', { exact: true })
    .fill('13800000000');
  await dialog.locator('[name="mobileCode"]').fill('123456');
  await dialog.locator('[name="consent"]').check();
  const loginRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith('/login') &&
      request.url().includes('/course-imports/'),
  );
  // Expire the exact server session before submitting without changing UI state.
  await page.route('**/api/me/course-imports/*/login', async (route) => {
    const sessionUrl = route
      .request()
      .url()
      .replace(/\/login$/, '');
    await page.request.delete(sessionUrl);
    await route.continue();
  });
  await dialog.getByRole('button', { name: '登录并获取学期' }).click();
  await loginRequest;
  await expect(
    dialog.getByRole('button', { name: '重新登录教务' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
});

const student = 'test.user.a@stu.suat-sz.edu.cn';
const otherStudent = 'test.user.b@suat-sz.edu.cn';
let scenario = 10;

async function otp(page: Page, recipient: string): Promise<string> {
  const response = await page.request.get(
    `/api/testing/inbox?recipient=${encodeURIComponent(recipient)}`,
  );
  expect(response.ok()).toBeTruthy();
  const inbox = (await response.json()) as { items: { text: string }[] };
  const code = /验证码是 (\d{6})/.exec(inbox.items[0]?.text ?? '')?.[1];
  if (!code) throw new Error(`No test code for ${recipient}`);
  return code;
}

async function login(
  page: Page,
  email = student,
  recovery = false,
): Promise<void> {
  await page.goto('/index.html');
  await page.locator('[data-auth-toggle]').click();
  const mode = recovery ? 'recovery' : 'login';
  await page.locator(`[data-auth-switch="${mode}"]:visible`).click();
  await page.locator(`[data-${mode}-email]`).fill(email);
  await page.locator(`[data-${mode}-send]`).click();
  await expect(page.locator(`[data-${mode}-verify]`)).toBeVisible();
  await page
    .locator(`[data-${mode}-otp]`)
    .fill(await otp(page, recovery ? 'test.user.a@example.test' : email));
  await page.locator(`[data-${mode}-otp]`).press('Enter');
  await expect(page.locator('[data-auth-label]')).not.toHaveText('未登录');
  await expect(page.locator('[data-auth-panel]')).toBeHidden();
}

test.beforeEach(async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'x-forwarded-for': `198.18.${testInfo.workerIndex % 250}.${(testInfo.line % 250) + 1}`,
  });
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.abort(),
  );
  const response = await page.request.post('/api/testing/reset', {
    data: { confirmation: 'RESET_LOCAL_TEST_DATABASE' },
  });
  expect(response.status()).toBe(200);
});

test('public information, login gating, and external email registration', async ({
  page,
}) => {
  await page.goto('/information.html');
  await expect(page.locator('main')).toBeVisible();
  await expect(
    page.locator('footer').getByText('产品', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('footer').getByRole('link', { name: '开源代码' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/SmartisanNaive/Shenxiaoli-Platform',
  );
  await page.goto('/market.html');
  await expect(page.locator('main[data-requires-auth]')).toBeHidden();
  expect((await page.request.get('/api/admin/queue')).status()).toBe(401);
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-switch="login"]:visible').click();
  await page.route(
    '**/api/auth/email-otp/send-verification-otp',
    async (route) => {
      expect(route.request().postDataJSON().email).toBe('unbound@example.test');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    },
  );
  await page.locator('[data-login-email]').fill('unbound@example.test');
  await page.locator('[data-login-send]').click();
  await expect(page.locator('[data-login-verify]')).toBeVisible();
  await expect(page.locator('[data-local-test-tools]')).toBeVisible();
});

for (const path of ['/index.html', '/market.html?category=books']) {
  test(`campus email entry opens login and continues on ${path}`, async ({
    page,
  }) => {
    await page.goto(path);
    const entry = page.getByRole('button', {
      name: /邮箱登录/,
    });
    const panel = page.locator('[data-auth-panel]');
    const toggle = page.locator('[data-auth-toggle]');
    await entry.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator('[data-password-login] [name="email"]'),
    ).toBeFocused();
    await page.locator('[data-auth-switch="login"]:visible').click();
    await expect(page.locator('[data-login-email]')).toHaveAttribute(
      'placeholder',
      '邮箱地址',
    );
    await expect(page.locator('[data-login-email-policy]')).toContainText(
      '支持使用有效邮箱注册和登录',
    );
    await expect(page.locator('[data-auth-dialog]')).toHaveJSProperty(
      'open',
      true,
    );
    await page.locator('[data-auth-close]').click();
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await entry.click();
    await page.locator('[data-auth-switch="login"]:visible').click();
    await page.locator('[data-login-email]').fill(student);
    await page.locator('[data-login-send]').click();
    await expect(page.locator('[data-login-verify]')).toBeVisible();
    await page.locator('[data-login-otp]').fill(await otp(page, student));
    await page.locator('[data-login-verify]').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-auth-label]')).not.toHaveText('未登录');
    await expect(entry).toHaveCount(0);
    await expect(page).toHaveURL(new URL(path, 'http://127.0.0.1:5176').href);
    if (path.startsWith('/market.html')) {
      await expect(page.locator('main[data-requires-auth]')).toBeVisible();
    } else {
      await expect(page.locator('[data-home-counts]')).toContainText('门课程');
    }
  });
}

test('all member pages load without runtime errors or horizontal overflow', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  for (const path of [
    '/index.html',
    '/course-evaluation.html',
    '/market.html',
    '/skill-mutual-aid.html',
    '/tree-hole.html',
    '/search.html?q=ICGA503',
    '/account.html',
    '/information.html',
  ]) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      path,
    ).toBe(true);
  }
  await page.goto('/moderation.html');
  await expect(page.locator('[data-moderation-status]')).toContainText(
    '此页面需要审核员或管理员权限',
  );
  await page.screenshot({
    path: testInfo.outputPath('member-pages.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('home feed follows login and logout without a page reload', async ({
  page,
}) => {
  await login(page);
  await expect(page.locator('[data-home-counts]')).toContainText('门课程');
  await expect(
    page.getByText('校园内容仅向已登录成员开放', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-home-feed]')).toHaveCount(1);
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-logout]').click();
  await expect(
    page.getByText('校园内容仅向已登录成员开放', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-home-courses]')).toHaveCount(0);
  await expect(page.locator('[data-home-listings]')).toHaveCount(0);
  await expect(page.locator('[data-home-feed]')).toHaveCount(1);
});

test('navigation icons render when external font services are unavailable', async ({
  page,
}) => {
  await page.goto('/index.html');
  const loaded = await page.evaluate(
    async () =>
      (await document.fonts.load('24px "Material Symbols Outlined"', 'search'))
        .length,
  );
  expect(loaded).toBeGreaterThan(0);
  const publishIcon = page.locator(
    '[data-publish-shortcut] .material-symbols-outlined',
  );
  await expect(publishIcon).toBeVisible();
  const bounds = await publishIcon.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(30);
});

test('course search, immediate review publication, comments, and account tabs', async ({
  page,
}) => {
  await login(page);
  await page.goto('/course-evaluation.html');
  await page.locator('#course-search').fill('ICGA503');
  await expect(page.locator('[data-course-id]')).toHaveCount(1);
  await page.locator('[data-course-id]').click();
  await page.locator('[data-write-review]').click();
  const form = page.locator('[data-review-form]');
  await form
    .locator('[name="content"]')
    .fill('浏览器测试课程评价：内容清楚，考核安排合理，建议提前预习。');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('[data-review-list]')).toContainText(
    '浏览器测试课程评价',
  );
  const widget = page
    .locator('[data-comment-widget]')
    .filter({ hasText: '查看评论与回复' })
    .first();
  await widget.locator('[data-comment-open]').click();
  await widget.locator('[name="content"]').fill('这是一条浏览器测试评论。');
  await widget.getByRole('button', { name: '发送评论', exact: true }).click();
  await expect(widget).toContainText('这是一条浏览器测试评论。');
  await page.goto('/account.html');
  for (const tab of [
    'publications',
    'favorites',
    'requests',
    'collaborations',
    'messages',
    'notifications',
    'appeals',
    'profile',
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator('[data-account-content]')).toBeVisible();
    await expect(page.locator('[data-account-content]')).not.toContainText(
      '请求失败',
    );
  }
  await expect(page.locator('[data-recovery-settings]')).toContainText(
    '辅助邮箱与账号恢复',
  );
  await page
    .locator('[data-profile-form] [name="displayName"]')
    .fill('浏览器测试新昵称');
  await page
    .locator('[data-profile-form] [name="socialEmailEnabled"]')
    .uncheck();
  await page.locator('[data-profile-form] button').click();
  await expect(
    page.getByText('账号设置已保存。', { exact: true }),
  ).toBeVisible();
  expect(await (await page.request.get('/api/session')).json()).toMatchObject({
    user: { displayName: '浏览器测试新昵称' },
  });
  expect(
    await (await page.request.get('/api/notifications/preferences')).json(),
  ).toEqual({ socialEmailEnabled: false });
});

test('market publishing includes an image that the browser can read', async ({
  page,
}) => {
  await login(page);
  await page.goto('/market.html');
  await page.locator('button[onclick*="openPublishModal"]').first().click();
  await page.locator('#listing-title').fill('浏览器测试教材');
  await page.locator('#listing-category').selectOption({ label: '教材书籍' });
  await page.locator('#listing-price').fill('12.50');
  await page.locator('#listing-location').selectOption({ label: '图书馆门前' });
  await page
    .locator('#listing-description')
    .fill('用于验证完整发布与图片读取流程的合成测试商品。');
  await page.locator('#listing-images').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl6kAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const published = page.waitForResponse(
    (response) =>
      response.url().includes('/api/market/listings') &&
      response.request().method() === 'POST',
  );
  await page.locator('#listing-form button[type="submit"]').click();
  expect((await published).status()).toBe(201);
  await expect(page.locator('#items-grid')).toContainText('浏览器测试教材');
  const result = (await (
    await page.request.get('/api/market/listings?q=浏览器测试教材')
  ).json()) as { items: { images: string[] }[] };
  const image = await page.request.get(result.items[0]!.images[0]!);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect(
    await page.evaluate(
      (url) =>
        new Promise<number>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth);
          image.onerror = () => resolve(0);
          image.src = url;
        }),
      result.items[0]!.images[0]!,
    ),
  ).toBe(1);
});

test('skill publishing and tree publishing update the visible feed, with reactions and comments', async ({
  page,
}) => {
  await login(page);
  await page.goto('/skill-mutual-aid.html');
  await page.locator('#skill-publish-open').click();
  const form = page.locator('#skill-form');
  await form.locator('[data-skill-kind="request"]').click();
  await form.locator('[name="title"]').fill('浏览器测试 Python 求助');
  await form
    .locator('[name="description"]')
    .fill('希望交流 Python 数据分析与测试方法，时间和范围可以协商。');
  await form.locator('[name="canOffer"]').fill('协助整理文档');
  await form.locator('[name="wants"]').fill('Python 入门讲解');
  await form.locator('[name="tags"]').fill('Python 测试');
  await page.locator('#skill-submit').click();
  await expect(page.locator('#skill-requests')).toContainText(
    '浏览器测试 Python 求助',
  );
  await page.goto('/tree-hole.html');
  await page
    .locator('textarea')
    .first()
    .fill('浏览器测试树洞：发布之后应该立即出现在当前信息流。');
  await page.locator('#tree-hole-publish').click();
  const post = page
    .locator('article')
    .filter({ hasText: '浏览器测试树洞：发布之后应该立即出现在当前信息流。' });
  await expect(post).toBeVisible();
  await post.locator('[data-tree-feel]').click();
  await expect(post.locator('[data-tree-feel]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await post.locator('[data-comment-open]').click();
  await post.locator('[name="content"]').fill('匿名评论正常显示。');
  await post.getByRole('button', { name: '发送评论', exact: true }).click();
  await expect(post).toContainText('匿名评论正常显示。');
});

test('binding an auxiliary inbox and recovery login preserve the original account', async ({
  page,
}, testInfo) => {
  await login(page);
  const before = (await (await page.request.get('/api/session')).json()) as {
    user: { id: string };
  };
  await page.goto('/account.html#profile');
  const settings = page.locator('[data-recovery-settings]');
  await settings.locator('[name="email"]').fill('test.user.a@example.test');
  await settings.locator('[data-recovery-bind]').click();
  await expect(settings.locator('[data-recovery-proof]')).toBeVisible();
  await settings.locator('[name="currentOtp"]').fill(await otp(page, student));
  await settings
    .locator('[name="newOtp"]')
    .fill(await otp(page, 'test.user.a@example.test'));
  await page.screenshot({
    path: testInfo.outputPath('auxiliary-binding.png'),
    fullPage: true,
  });
  await settings.locator('[data-recovery-confirm]').click();
  await expect(page).toHaveURL(/index\.html$/);
  await login(page, student, true);
  const after = (await (await page.request.get('/api/session')).json()) as {
    user: { id: string };
  };
  expect(after.user.id).toBe(before.user.id);
  await page.goto('/account.html#profile');
  await expect(page.locator('[data-recovery-settings]')).toContainText(
    '已绑定：test.user.a@example.test',
  );
});

test('the same verified student gains admin access only after the grant command', async ({
  page,
}) => {
  await login(page);
  expect(
    (await page.request.get('/api/admin/courses/import-template')).status(),
  ).toBe(403);
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  execFileSync('bun', ['run', 'src/admin.ts', 'grant-admin', student], {
    cwd: resolve(root, 'backend'),
    env: {
      ...process.env,
      DATABASE_PATH: resolve(root, '.local-test/e2e/database.sqlite'),
    },
  });
  await page.reload();
  await page.locator('[data-auth-toggle]').click();
  await expect(page.locator('[data-admin-link]')).toBeVisible();
  expect(
    (await page.request.get('/api/admin/courses/import-template')).status(),
  ).toBe(200);
  await page.goto('/moderation.html');
  await expect(page.locator('[data-moderation-status]')).toContainText(
    '管理员',
  );
  await expect(page.locator('[data-moderation-queue]')).toContainText(
    '审核队列为空',
  );
});

test('contact acceptance opens a private conversation and browser messages reach the other participant', async ({
  page,
  browser,
}) => {
  await login(page);
  const listing = await page.request.post('/api/market/listings', {
    data: {
      title: '私信测试商品',
      category: '教材书籍',
      price: 10,
      condition: '全新',
      location: '图书馆',
      description: '用于验证联系请求和私信界面的合成商品。',
      images: [],
    },
  });
  expect(listing.status()).toBe(201);
  const { id } = (await listing.json()) as { id: string };
  const other = await browser.newContext({
    baseURL: 'http://127.0.0.1:5176',
    extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${scenario++}` },
  });
  try {
    const otherPage = await other.newPage();
    await login(otherPage, otherStudent);
    expect(
      (
        await otherPage.request.post(`/api/market/listings/${id}/contact`, {
          data: { message: '希望交流这本测试教材。' },
        })
      ).status(),
    ).toBe(201);
    await page.goto('/account.html#requests');
    await page.locator('[data-request-action="accepted"]').click();
    await page.locator('[data-open-conversation]').click();
    await expect(page.locator('[data-message-form]')).toBeVisible();
    await page
      .locator('[data-message-form] [name="body"]')
      .fill('这是浏览器发送的私信内容。');
    await page.locator('[data-message-form] button').click();
    await expect(page.locator('[data-message-list]')).toContainText(
      '这是浏览器发送的私信内容。',
    );
    await otherPage.goto('/account.html#messages');
    await otherPage.locator('[data-conversation]').first().click();
    await expect(otherPage.locator('[data-message-list]')).toContainText(
      '这是浏览器发送的私信内容。',
    );
  } finally {
    await other.close();
  }
});

test('moderators handle reports and a different reviewer restores content after the author appeals', async ({
  page,
  browser,
}, testInfo) => {
  await login(page);
  const post = await page.request.post('/api/tree-hole', {
    data: { content: '浏览器测试治理与独立复核的树洞内容。', topic: '科研' },
  });
  expect(post.status()).toBe(201);
  const { id } = (await post.json()) as { id: string };
  const contexts: BrowserContext[] = [];
  const peer = async (email: string, suffix: number) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5176',
      extraHTTPHeaders: {
        'x-forwarded-for': `198.19.${testInfo.project.name === 'mobile' ? 18 : 17}.${suffix}`,
      },
    });
    contexts.push(context);
    await context.route(
      /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
      (route) => route.abort(),
    );
    const result = await context.newPage();
    await login(result, email);
    return result;
  };
  try {
    const reporter = await peer(otherStudent, 1);
    const report = await reporter.request.post('/api/reports', {
      data: {
        targetType: 'tree-hole',
        targetId: id,
        reason: '浏览器测试举报与复核',
      },
    });
    expect(report.status()).toBe(201);
    const reportId = ((await report.json()) as { id: string }).id;
    const moderator = await peer('test.moderator.a@suat-sz.edu.cn', 2);
    moderator.on('dialog', (dialog) =>
      dialog.accept(
        dialog.message().includes('处置类型')
          ? 'hide'
          : '浏览器测试处置与复核理由',
      ),
    );
    await moderator.goto('/moderation.html');
    await moderator
      .locator(
        `[data-type="reports"][data-id="${reportId}"][data-action="handle"]`,
      )
      .click();
    await expect(moderator.locator('[data-moderation-queue]')).toContainText(
      '审核队列为空',
    );
    await page.goto('/account.html#appeals');
    page.once('dialog', (dialog) =>
      dialog.accept('请由另一名审核员复核这条测试内容，内容不存在违规情况。'),
    );
    await page.locator('[data-appeal]').click();
    await expect(page.locator('[data-account-content]')).toContainText(
      '复核中',
    );
    await moderator.reload();
    await moderator
      .locator('[data-type="appeals"][data-action="restore"]')
      .click();
    await expect(
      moderator.getByText('原处理人不能复核这条申诉', { exact: true }),
    ).toBeVisible();
    const reviewer = await peer('test.moderator.b@suat-sz.edu.cn', 3);
    reviewer.on('dialog', (dialog) =>
      dialog.accept('另一审核员复核通过测试内容。'),
    );
    await reviewer.goto('/moderation.html');
    await reviewer
      .locator('[data-type="appeals"][data-action="restore"]')
      .click();
    await expect(reviewer.locator('[data-moderation-queue]')).toContainText(
      '审核队列为空',
    );
    await page.reload();
    await expect(page.locator('[data-account-content]')).toContainText(
      '申诉通过',
    );
    await page.goto(`/tree-hole.html?post=${id}`);
    await expect(page.locator(`#tree-${id}`)).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('login and recovery views isolate proofs, validate on Enter and reset after resend failures', async ({
  page,
}, testInfo) => {
  let releaseRequest = () => {};
  const held = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let loginSends = 0;
  let recoverySends = 0;
  const confirmations: { email: string; challengeId: string; otp: string }[] =
    [];
  await page.route(
    '**/api/auth/email-otp/send-verification-otp',
    async (route) => {
      loginSends++;
      await held;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.route(
    '**/api/auth/recovery-email/login/request',
    async (route) => {
      recoverySends++;
      await route.fulfill(
        recoverySends === 2
          ? { status: 503, json: { message: '测试发送失败，请重试。' } }
          : { json: { challengeId: `proof-${recoverySends}`, expiresIn: 300 } },
      );
    },
  );
  await page.route(
    '**/api/auth/recovery-email/login/confirm',
    async (route) => {
      confirmations.push(
        route.request().postDataJSON() as (typeof confirmations)[number],
      );
      await route.fulfill({
        status: 400,
        json: { message: '验证码无效、已过期或尝试次数过多' },
      });
    },
  );
  await page.goto('/index.html');
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-switch="login"]:visible').click();
  await expect(
    page.getByRole('heading', { name: '邮箱登录 / 注册', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-auth-view="login"]')).toContainText(
    '首次验证将自动创建账号',
  );
  await expect(page.locator('[data-login-qq-note]')).toBeHidden();
  await expect(
    page.locator('[data-login-recovery], [data-login-name]'),
  ).toHaveCount(0);
  await page.locator('[data-login-email]').fill(student);
  await page.locator('[data-login-email]').press('Enter');
  try {
    await expect(page.locator('[data-login-send]')).toBeDisabled();
    await expect(page.locator('[data-login-email]')).toBeDisabled();
    await expect(page.locator('[data-auth-switch="recovery"]')).toBeDisabled();
  } finally {
    releaseRequest();
  }
  await expect(page.locator('[data-login-otp]')).toBeFocused();
  await expect(page.locator('[data-login-status]')).toContainText(student);
  await page.locator('[data-login-otp]').fill('123456');
  await page
    .locator('[data-auth-panel]')
    .screenshot({ path: testInfo.outputPath('email-login.png') });
  await page.locator('[data-auth-switch="recovery"]').click();
  await expect(page.locator('[data-recovery-email]')).toBeFocused();
  await expect(page.locator('[data-email-login]')).toBeHidden();
  await expect(page.locator('[data-login-otp]')).toHaveValue('');
  await expect(page.locator('[data-account-recovery]')).toContainText(
    '请填写原账号邮箱',
  );
  await page.locator('[data-recovery-email]').fill(student);
  await page.locator('[data-recovery-send]').click();
  await expect(page.locator('[data-recovery-otp]')).toBeFocused();
  await expect(page.locator('[data-recovery-status]')).toContainText(
    '如果该账号可恢复且已绑定辅助邮箱',
  );
  await page
    .locator('[data-auth-panel]')
    .screenshot({ path: testInfo.outputPath('account-recovery.png') });
  await page.locator('[data-recovery-otp]').fill('123456');
  await page.locator('[data-recovery-otp]').press('Enter');
  await expect(page.locator('[data-recovery-error]')).toContainText(
    '验证码无效',
  );
  expect(recoverySends).toBe(1);
  expect(confirmations).toEqual([
    { email: student, challengeId: 'proof-1', otp: '123456' },
  ]);
  await page.locator('[data-recovery-resend]').click();
  await expect(page.locator('[data-recovery-error]')).toContainText(
    '测试发送失败',
  );
  await expect(page.locator('[data-recovery-otp]')).toHaveValue('');
  await expect(page.locator('[data-recovery-verify]')).toBeHidden();
  await expect(page.locator('[data-recovery-status]')).toBeEmpty();
  await page.locator('[data-recovery-send]').click();
  await expect(page.locator('[data-recovery-otp]')).toBeFocused();
  await expect(page.locator('[data-recovery-error]')).toBeEmpty();
  await page.locator('[data-recovery-otp]').fill('654321');
  await page.locator('[data-recovery-otp]').press('Enter');
  await expect(page.locator('[data-recovery-error]')).toContainText(
    '验证码无效',
  );
  expect(confirmations.at(-1)).toEqual({
    email: student,
    challengeId: 'proof-3',
    otp: '654321',
  });
  await page.locator('[data-recovery-email]').fill(otherStudent);
  await expect(page.locator('[data-recovery-verify]')).toBeHidden();
  await expect(page.locator('[data-recovery-otp]')).toHaveValue('');
  await page.locator('[data-auth-switch="login"]:visible').click();
  await expect(page.locator('[data-login-email]')).toBeFocused();
  await expect(page.locator('[data-account-recovery]')).toBeHidden();
  await expect(page.locator('[data-login-send]')).toBeVisible();
  await expect(page.locator('[data-login-status]')).toBeEmpty();
  await page.locator('[data-login-send]').click();
  await expect(page.locator('[data-login-verify]')).toBeVisible();
  await page.locator('[data-login-email]').fill(otherStudent);
  await expect(page.locator('[data-login-verify]')).toBeHidden();
  expect(loginSends).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('unknown and unbound accounts show the same recovery delivery message', async ({
  page,
}) => {
  await login(page);
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-logout]').click();
  await expect(page.locator('[data-auth-label]')).toHaveText('未登录');
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-switch="recovery"]').click();
  let message = '';
  for (const email of [student, 'unknown@stu.suat-sz.edu.cn']) {
    await page.locator('[data-recovery-email]').fill(email);
    await page.locator('[data-recovery-send]').click();
    await expect(page.locator('[data-recovery-verify]')).toBeVisible();
    const current = await page.locator('[data-recovery-status]').textContent();
    if (!message) message = current!;
    expect(current).toBe(message);
  }
  const inbox = (await (
    await page.request.get('/api/testing/inbox')
  ).json()) as { items: { subject: string }[] };
  expect(
    inbox.items.filter((item) => item.subject.includes('账号找回')),
  ).toHaveLength(0);
});

test('QQ login and campus recovery submit distinct account emails and endpoints', async ({
  page,
}) => {
  const sent: { endpoint: string; body: unknown }[] = [];
  await page.route(
    '**/api/auth/email-otp/send-verification-otp',
    async (route) => {
      sent.push({
        endpoint: 'login-send',
        body: route.request().postDataJSON() as unknown,
      });
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.route('**/api/auth/sign-in/email-otp', async (route) => {
    sent.push({
      endpoint: 'login-confirm',
      body: route.request().postDataJSON() as unknown,
    });
    await route.fulfill({ status: 400, json: { message: '测试验证码无效' } });
  });
  await page.route(
    '**/api/auth/recovery-email/login/request',
    async (route) => {
      sent.push({
        endpoint: 'recovery-send',
        body: route.request().postDataJSON() as unknown,
      });
      await route.fulfill({
        json: { challengeId: 'campus-recovery', expiresIn: 300 },
      });
    },
  );
  await page.route(
    '**/api/auth/recovery-email/login/confirm',
    async (route) => {
      sent.push({
        endpoint: 'recovery-confirm',
        body: route.request().postDataJSON() as unknown,
      });
      await route.fulfill({ status: 400, json: { message: '测试验证码无效' } });
    },
  );
  await page.goto('/index.html');
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-auth-switch="login"]:visible').click();
  await page.locator('[data-login-email]').fill('123456789@qq.com');
  await page.locator('[data-login-send]').click();
  await expect(page.locator('[data-login-otp]')).toBeFocused();
  await page.locator('[data-login-otp]').fill('123456');
  await page.locator('[data-login-otp]').press('Enter');
  await expect(page.locator('[data-login-error]')).toContainText(
    '测试验证码无效',
  );
  await page.locator('[data-auth-switch="recovery"]').click();
  await page.locator('[data-recovery-email]').fill(student);
  await page.locator('[data-recovery-send]').click();
  await expect(page.locator('[data-recovery-otp]')).toBeFocused();
  await page.locator('[data-recovery-otp]').fill('654321');
  await page.locator('[data-recovery-otp]').press('Enter');
  await expect(page.locator('[data-recovery-error]')).toContainText(
    '测试验证码无效',
  );
  expect(sent).toEqual([
    {
      endpoint: 'login-send',
      body: { email: '123456789@qq.com', type: 'sign-in' },
    },
    {
      endpoint: 'login-confirm',
      body: { email: '123456789@qq.com', otp: '123456', name: '123456789' },
    },
    { endpoint: 'recovery-send', body: { email: student } },
    {
      endpoint: 'recovery-confirm',
      body: { email: student, challengeId: 'campus-recovery', otp: '654321' },
    },
  ]);
});

test('account settings set a password, reject mismatched confirmation and preserve the account on password login', async ({
  page,
}, testInfo) => {
  const password = 'Browser-custom-password-123';
  await login(page);
  const original = (await (await page.request.get('/api/session')).json()) as {
    user: { id: string };
  };
  await page.goto('/account.html#profile');
  const settings = page.locator('[data-password-settings]');
  await expect(settings).toContainText('登录密码');
  await expect(settings.locator('[name="email"]')).toHaveAttribute(
    'readonly',
    '',
  );
  await settings.locator('[data-password-send]').click();
  await expect(settings.locator('[data-password-proof]')).toBeVisible();
  await settings.locator('[name="otp"]').fill(await otp(page, student));
  await settings.locator('[name="password"]').fill(password);
  await settings
    .locator('[name="confirmPassword"]')
    .fill('Different-password-123');
  await settings.locator('[data-password-confirm]').click();
  expect(
    await settings
      .locator('[name="confirmPassword"]')
      .evaluate((input) => (input as HTMLInputElement).validity.customError),
  ).toBe(true);
  await settings.locator('[name="confirmPassword"]').fill(password);
  await settings.locator('[data-password-confirm]').click();
  await expect(page).toHaveURL(/index\.html$/);
  await expect(page.locator('[data-auth-label]')).toHaveText('未登录');
  await page.locator('[data-auth-toggle]').click();
  const form = page.locator('[data-password-login]');
  await expect(form).toBeVisible();
  await expect(page.locator('[data-email-login]')).toBeHidden();
  await form.locator('[name="email"]').fill(student);
  await form.locator('[name="password"]').fill('Incorrect-password-123');
  await form.locator('[name="password"]').press('Enter');
  await expect(page.locator('[data-password-login-error]')).toContainText(
    '邮箱或密码不正确',
  );
  await form.locator('[name="password"]').fill(password);
  await page
    .locator('[data-auth-panel]')
    .screenshot({ path: testInfo.outputPath('password-login.png') });
  await form.locator('[name="password"]').press('Enter');
  await expect(page.locator('[data-auth-panel]')).toBeHidden();
  const current = (await (await page.request.get('/api/session')).json()) as {
    user: { id: string };
  };
  expect(current.user.id).toBe(original.user.id);
  await page.locator('[data-auth-toggle]').click();
  await expect(form).toBeHidden();
  await expect(page.locator('[data-email-login]')).toBeHidden();
  await expect(page.locator('[data-account-recovery]')).toBeHidden();
});

test('forgot password verifies the account inbox and allows an existing OTP account to choose a password', async ({
  page,
}, testInfo) => {
  const password = 'Browser-reset-password-456';
  await page.goto('/index.html');
  await page.locator('[data-auth-toggle]').click();
  await page
    .locator('[data-password-login] [name="password"]')
    .fill('clear-this-secret');
  await page.locator('[data-auth-switch="reset"]').click();
  await expect(
    page.locator('[data-password-login] [name="password"]'),
  ).toHaveValue('');
  const view = page.locator('[data-auth-view="reset"]');
  await expect(view.locator('[name="email"]')).toBeFocused();
  await view.locator('[name="email"]').fill(student);
  await view.locator('[data-password-send]').click();
  await expect(view.locator('[data-password-proof]')).toBeVisible();
  await view.locator('[name="otp"]').fill(await otp(page, student));
  await view.locator('[name="password"]').fill(password);
  await view.locator('[name="confirmPassword"]').fill(password);
  await view.screenshot({ path: testInfo.outputPath('password-reset.png') });
  await view.locator('[name="confirmPassword"]').press('Enter');
  const form = page.locator('[data-password-login]');
  await expect(form).toBeVisible();
  await expect(form.locator('[name="email"]')).toHaveValue(student);
  await expect(view.locator('[name="password"]')).toHaveValue('');
  await form.locator('[name="password"]').fill(password);
  await form.locator('[name="password"]').press('Enter');
  await expect(page.locator('[data-auth-panel]')).toBeHidden();
  await expect(page.locator('[data-auth-label]')).not.toHaveText('未登录');
});

test('login dialog stays centered, traps keyboard focus and closes with Escape or the backdrop', async ({
  page,
}, testInfo) => {
  await page.goto('/index.html');
  const toggle = page.locator('[data-auth-toggle]');
  const dialog = page.locator('[data-auth-dialog]');
  const panel = page.locator('[data-auth-panel]');
  const close = page.getByRole('button', { name: '关闭登录窗口' });
  await toggle.click();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(page.getByRole('dialog', { name: '登录深小狸' })).toBeVisible();
  await expect(page.locator('[data-account-menu]')).toBeHidden();
  await expect(page.locator('[data-auth-methods]')).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
  ).toBeLessThan(2);
  expect(bounds.x).toBeGreaterThanOrEqual(15);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 15);
  await page.screenshot({ path: testInfo.outputPath('login-dialog.png') });
  await panel.screenshot({
    path: testInfo.outputPath('login-dialog-panel.png'),
  });
  const lastButton = page.locator('[data-auth-switch="recovery"]');
  await lastButton.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('html')).not.toHaveClass(/auth-modal-open/);
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});
