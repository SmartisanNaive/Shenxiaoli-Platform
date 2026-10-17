import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  await page.locator('[data-login-email]').fill(email);
  await page.locator('[data-login-recovery]').setChecked(recovery);
  await page.locator('[data-login-send]').click();
  await expect(page.locator('[data-login-verify]')).toBeVisible();
  await page
    .locator('[data-login-otp]')
    .fill(await otp(page, recovery ? 'test.user.a@example.test' : email));
  await page.locator('[data-login-verify]').click();
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

test('public information, login gating, and invalid external registration', async ({
  page,
}) => {
  await page.goto('/information.html');
  await expect(page.locator('main')).toBeVisible();
  await page.goto('/market.html');
  await expect(page.locator('main[data-requires-auth]')).toBeHidden();
  expect((await page.request.get('/api/admin/queue')).status()).toBe(401);
  await page.locator('[data-auth-toggle]').click();
  await page.locator('[data-login-email]').fill('unbound@example.test');
  await page.locator('[data-login-send]').click();
  await expect(
    page.getByText('仅支持 @stu.suat-sz.edu.cn、@suat-sz.edu.cn 校园邮箱', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('[data-local-test-tools]')).toBeVisible();
});

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
