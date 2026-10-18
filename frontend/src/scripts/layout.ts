import { renderPasswordForm } from './password-settings';

/**
 * Layout module — shared site chrome.
 *
 * Defines the header navigation and footer markup used across every page.
 * The Vite document plugin replaces `data-layout="header"` and
 * `data-layout="footer"` placeholders before the page reaches the browser.
 *
 * Each page sets the active nav item by adding `data-active="<key>"`
 * to its header placeholder; the matching nav link receives the
 * `aria-current="page"` attribute and the active styling.
 */

export type NavKey =
  'home' | 'course-evaluation' | 'market' | 'skill-mutual-aid' | 'tree-hole';

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', href: './index.html' },
  {
    key: 'course-evaluation',
    label: '评课',
    href: './course-evaluation.html',
  },
  { key: 'market', label: '集市', href: './market.html' },
  {
    key: 'skill-mutual-aid',
    label: '技能互助',
    href: './skill-mutual-aid.html',
  },
  { key: 'tree-hole', label: '树洞', href: './tree-hole.html' },
];

const PROFILE_AVATAR = './mascot-avatar.png';
const LOGO_AVATAR = './mascot-logo.png';

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderNavItem = (item: NavItem, activeKey?: NavKey): string => {
  const isActive = item.key === activeKey;
  const className = isActive
    ? 'transition-colors text-primary font-semibold'
    : 'text-body-md text-on-surface-variant hover:text-primary transition-colors';
  const attrs = isActive
    ? `aria-current="page" class="${className}" data-path="${item.key}"`
    : `class="${className}" data-path="${item.key}"`;
  return `<a ${attrs} href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
};

export const renderHeader = (activeKey?: NavKey): string => {
  const navLinks = NAV_ITEMS.map((item) => renderNavItem(item, activeKey)).join(
    '',
  );

  return `
  <header class="fixed top-0 z-50 w-full border-b border-surface-variant bg-surface">
    <div class="mx-auto flex h-20 max-w-[1200px] items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
      <div class="flex min-w-0 items-center gap-3 sm:gap-8">
        <a class="flex min-w-0 items-center gap-3" data-path="home" href="./index.html">
          <img alt="深小狸 logo" class="h-11 w-11 shrink-0 object-contain" src="${LOGO_AVATAR}" />
          <span class="truncate font-headline-sm font-bold text-primary">深小狸</span>
        </a>
        <nav class="hidden items-center gap-6 lg:flex">
          ${navLinks}
        </nav>
      </div>
      <div class="hidden max-w-md flex-1 md:block">
        <div class="relative flex items-center">
          <span class="material-symbols-outlined absolute left-3 text-outline text-sm">search</span>
          <input
            class="w-full bg-surface-container-low pl-10 pr-4 py-2 rounded text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="搜索课程、商品、技能或帖子…"
            type="text"
          />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2 sm:gap-4">
        <div class="relative">
          <button
            class="flex items-center gap-2 rounded bg-primary px-3 py-2 text-label-md text-on-primary transition-colors hover:bg-secondary sm:px-4"
            data-publish-shortcut
            type="button"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span class="hidden sm:inline">发布</span>
          </button>
        </div>
        <button
          class="relative hidden p-2 text-on-surface-variant transition-colors hover:text-primary sm:block"
          data-notifications-open
          type="button"
            aria-label="通知、联系请求与私信"
        >
          <span class="material-symbols-outlined">notifications</span>
        </button>
        <div class="relative" data-auth-widget>
          <button
            class="flex items-center gap-2 rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            data-auth-toggle
            type="button"
            aria-expanded="false"
            aria-label="账户与登录选项"
          >
            <img alt="" class="h-9 w-9 rounded-full object-cover" src="${PROFILE_AVATAR}" />
            <span class="hidden max-w-28 truncate text-label-sm sm:block" data-auth-label>未登录</span>
            <span class="material-symbols-outlined text-sm" aria-hidden="true">expand_more</span>
          </button>
          <dialog class="auth-dialog" data-auth-dialog aria-labelledby="auth-title">
            <div data-auth-panel class="auth-dialog-content">
              <div class="auth-dialog-heading">
                <h2 id="auth-title" data-auth-title>登录深小狸</h2>
                <button data-auth-close type="button" class="auth-close" aria-label="关闭登录窗口"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
              </div>
              <div data-auth-methods class="auth-methods" role="group" aria-label="登录方式">
                <button data-auth-switch="password" type="button" aria-pressed="true">密码登录</button>
                <button data-auth-switch="login" type="button" aria-pressed="false">验证码登录 / 注册</button>
              </div>
              <section data-auth-view="password">
                <form data-password-login class="auth-form">
                  <label class="auth-field">邮箱<input name="email" type="email" autocomplete="username" required placeholder="输入登录邮箱" /></label>
                  <div class="auth-field">
                    <div class="auth-field-heading"><label for="auth-password">密码</label><button data-auth-switch="reset" type="button" class="auth-text-link">忘记密码？</button></div>
                    <input id="auth-password" name="password" type="password" autocomplete="current-password" required maxlength="128" placeholder="输入登录密码" />
                  </div>
                  <p data-password-login-error role="alert" class="text-xs leading-5 text-error"></p>
                  <button type="submit" class="auth-primary">登录</button>
                </form>
              </section>
              <section data-auth-view="login" hidden>
                <p class="auth-description">首次验证将自动创建账号。</p>
                <form data-email-login class="auth-form" novalidate>
                  <label class="auth-field">邮箱<input data-login-email autocomplete="email" type="email" required placeholder="name@stu.suat-sz.edu.cn" /></label>
                  <label data-login-otp-field hidden class="auth-field">邮箱验证码<input data-login-otp inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" /></label>
                  <p data-login-status role="status" class="break-words text-xs leading-5 text-on-surface-variant"></p>
                  <p data-login-error role="alert" class="text-xs leading-5 text-error"></p>
                  <button data-login-send type="submit" class="auth-primary">获取验证码</button>
                  <button data-login-verify type="submit" hidden class="auth-primary">验证并进入</button>
                  <button data-login-resend type="button" hidden class="auth-secondary">重新发送验证码</button>
                </form>
                <p data-login-qq-note hidden class="auth-note">直接使用 QQ 邮箱，将创建或进入该 QQ 邮箱对应的账号。</p>
                <details class="auth-email-policy"><summary>支持哪些邮箱？</summary><p data-login-email-policy>注册仅接受 @stu.suat-sz.edu.cn、@suat-sz.edu.cn 校园邮箱。邮箱验证证明你能访问该邮箱，不代表学校学籍认证。</p></details>
              </section>
              <section data-auth-view="recovery" hidden>
                <p class="auth-description">填写原账号邮箱，验证码将发往已绑定的辅助邮箱。</p>
                <form data-account-recovery class="auth-form" novalidate>
                  <label class="auth-field">原账号邮箱<input data-recovery-email autocomplete="email" type="email" required placeholder="原校园邮箱" /></label>
                  <label data-recovery-otp-field hidden class="auth-field">辅助邮箱验证码<input data-recovery-otp inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" /></label>
                  <p data-recovery-status role="status" class="break-words text-xs leading-5 text-on-surface-variant"></p>
                  <p data-recovery-error role="alert" class="text-xs leading-5 text-error"></p>
                  <button data-recovery-send type="submit" class="auth-primary">获取验证码</button>
                  <button data-recovery-verify type="submit" hidden class="auth-primary">验证并回到原账号</button>
                  <button data-recovery-resend type="button" hidden class="auth-secondary">重新发送验证码</button>
                  <p class="auth-note">找回校园账号时，请填写原校园邮箱，即使辅助邮箱是 QQ 邮箱。验证后回到原账号。</p>
                </form>
                <button data-auth-switch="login" type="button" class="auth-back">返回邮箱登录 / 注册</button>
              </section>
              <section data-auth-view="reset" hidden>
                <p class="auth-description">验证账号邮箱，设置或重设 8–128 位密码。</p>
                ${renderPasswordForm()}
                <p class="auth-note">新用户请先通过验证码注册。</p>
                <button data-auth-switch="password" type="button" class="auth-back">返回密码登录</button>
              </section>
              <div data-auth-help class="auth-help">
                <p data-auth-email-hint class="auth-note">支持校园邮箱登录</p>
                <button data-auth-switch="recovery" type="button" class="auth-text-link">无法使用原邮箱？找回账号</button>
              </div>
              <div class="mt-5 flex flex-col gap-2" data-demo-login-options hidden>
                <button class="auth-secondary" data-demo-login="student" type="button">以演示同学身份登录</button>
                <button class="auth-secondary" data-demo-login="moderator" type="button">以演示审核员身份登录</button>
                <p class="auth-note">仅供本地开发演示，不代表学校认证。</p>
              </div>
            </div>
          </dialog>
          <div data-account-menu hidden class="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-surface-variant bg-surface p-3 shadow-lg">
            <p class="mb-3 px-2 text-body-sm text-on-surface-variant" data-auth-message>正在检查登录状态…</p>
            <a class="mb-1 hidden rounded-lg px-3 py-2 text-label-sm text-primary hover:bg-surface-container-low" data-admin-link href="./moderation.html">内容审核台</a>
            <a class="mb-1 block rounded-lg px-3 py-2 text-label-sm text-primary hover:bg-surface-container-low" href="./account.html">个人中心</a>
            <button class="hidden w-full rounded-lg px-3 py-2 text-left text-label-sm text-on-surface-variant hover:bg-surface-container-low" data-auth-logout type="button">退出登录</button>
          </div>
        </div>
      </div>
    </div>
  </header>`;
};

export const renderFooter = (): string => `
  <footer class="w-full bg-surface-container-low border-t border-surface-variant mt-12">
    <div class="max-w-[1200px] mx-auto px-gutter py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="md:col-span-2">
        <div class="flex items-center gap-3 mb-4">
          <img alt="深小狸 logo" class="h-11 w-11 shrink-0 object-contain" src="${LOGO_AVATAR}" />
          <span class="font-headline-sm text-primary font-bold">深小狸</span>
        </div>
        <p class="text-body-md text-on-surface-variant max-w-md">
          深圳理工大学（SUAT）同学共建的非官方社区，提供课程评价、闲置交易、技能互助与树洞交流。
        </p>
      </div>
      <div>
        <h5 class="font-label-md text-on-surface mb-3">关于</h5>
        <ul class="flex flex-col gap-2 text-body-md text-on-surface-variant">
          <li><a class="hover:text-primary transition-colors" href="./information.html#project">项目主页</a></li>
          <li><a class="hover:text-primary transition-colors" href="https://github.com/SmartisanNaive/Shenxiaoli-Platform" target="_blank" rel="noopener noreferrer">开源代码</a></li>
          <li><a class="hover:text-primary transition-colors" href="./information.html#privacy">隐私政策</a></li>
          <li><a class="hover:text-primary transition-colors" href="./information.html#contact">联系我们</a></li>
        </ul>
      </div>
    </div>
    <div class="border-t border-surface-variant">
      <div class="max-w-[1200px] mx-auto px-gutter py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-body-sm text-outline">
        <span>© <span data-current-year>${new Date().getFullYear()}</span> 深小狸</span>
      </div>
    </div>
  </footer>`;
