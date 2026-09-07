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

const PROFILE_AVATAR =
  'https://lh3.googleusercontent.com/aida/AEtjO1UDmyqYuHr3A5mKiLnsGr0ahhVQn9xPIKdrc7P8FJ0tVaWlL1f0FTpqK8QuXUtd7t2gwU_hRMjZIW5PcbthXyoOtt4T-6PzmGlcDBN3sok_gliYbla7J0iNy2egLeScw-e7zhwTkdbfxu6rLyfWn2jxPb3sbcYJeWPkF5cCh8xR9QeqFhTRxaR1E0ul-pEqrdIGGW91rJ1EsZRzoOM8IgndIsq4uq-2P05c3sfAeWpH1ZV1fOaBzGANHxyeYF6DmInLfNdOjvUZLw';
const LOGO_AVATAR = PROFILE_AVATAR;

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
  <header class="fixed top-0 z-50 w-full bg-surface/90 shadow-card-soft backdrop-blur-xl">
    <div class="mx-auto flex h-20 max-w-[1200px] items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
      <div class="flex min-w-0 items-center gap-3 sm:gap-8">
        <a class="flex min-w-0 items-center gap-3" data-path="home" href="./index.html">
          <img alt="深小狸校园 logo" class="h-8 w-8 shrink-0 rounded-full object-cover" src="${LOGO_AVATAR}" />
          <span class="truncate font-headline-sm font-bold text-primary">深小狸校园</span>
        </a>
        <nav class="hidden items-center gap-6 lg:flex">
          ${navLinks}
        </nav>
      </div>
      <div class="hidden max-w-md flex-1 md:block">
        <div class="relative flex items-center">
          <span class="material-symbols-outlined absolute left-3 text-outline text-sm">search</span>
          <input
            class="w-full bg-surface-container-low pl-10 pr-4 py-2 rounded-xl text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="搜索课程、商品、技能或帖子…"
            type="text"
          />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2 sm:gap-4">
        <div class="relative">
          <button
            class="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-label-md text-on-primary transition-colors hover:bg-secondary sm:px-4"
            onclick="alert('演示模式：请进入具体板块体验发布流程，当前不会提交数据。')"
            type="button"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span class="hidden sm:inline">发布</span>
          </button>
        </div>
        <a
          class="relative hidden p-2 text-on-surface-variant transition-colors hover:text-primary sm:block"
          data-path="messages"
          href="#"
          onclick="event.preventDefault(); alert('演示模式：通知中心暂未接入，不会产生真实消息。')"
        >
          <span class="material-symbols-outlined">notifications</span>
        </a>
        <a
          class="flex items-center"
          data-path="profile"
          href="#"
          onclick="event.preventDefault(); alert('演示模式：个人主页暂未接入，不会读取账户信息。')"
        >
          <img alt="用户头像" class="w-8 h-8 rounded-full object-cover" src="${PROFILE_AVATAR}" />
        </a>
      </div>
    </div>
  </header>`;
};

export const renderFooter = (): string => `
  <footer class="w-full bg-surface-container-low border-t border-surface-variant mt-12">
    <div class="max-w-[1200px] mx-auto px-gutter py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
      <div class="md:col-span-2">
        <div class="flex items-center gap-3 mb-4">
          <img alt="深小狸校园 logo" class="w-8 h-8 rounded-full object-cover" src="${LOGO_AVATAR}" />
          <span class="font-headline-sm text-primary font-bold">深小狸校园</span>
        </div>
        <p class="text-body-md text-on-surface-variant max-w-md">
          服务于深圳理工大学（SUAT）同学的校园平台 — 评课、闲置、技能互助与树洞，一站式连接校园生活。
        </p>
      </div>
      <div>
        <h5 class="font-label-md text-on-surface mb-3">产品</h5>
        <ul class="flex flex-col gap-2 text-body-md text-on-surface-variant">
          <li><a class="hover:text-primary transition-colors" href="./course-evaluation.html">评课</a></li>
          <li><a class="hover:text-primary transition-colors" href="./market.html">集市</a></li>
          <li><a class="hover:text-primary transition-colors" href="./skill-mutual-aid.html">技能互助</a></li>
          <li><a class="hover:text-primary transition-colors" href="./tree-hole.html">树洞</a></li>
        </ul>
      </div>
      <div>
        <h5 class="font-label-md text-on-surface mb-3">关于</h5>
        <ul class="flex flex-col gap-2 text-body-md text-on-surface-variant">
          <li><a class="hover:text-primary transition-colors" href="#">项目主页</a></li>
          <li><a class="hover:text-primary transition-colors" href="#">设计规范</a></li>
          <li><a class="hover:text-primary transition-colors" href="#">隐私政策</a></li>
          <li><a class="hover:text-primary transition-colors" href="#">联系我们</a></li>
        </ul>
      </div>
    </div>
    <div class="border-t border-surface-variant">
      <div class="max-w-[1200px] mx-auto px-gutter py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-body-sm text-outline">
        <span>© <span data-current-year>${new Date().getFullYear()}</span> 深小狸校园 · Shenxiaoli Platform</span>
        <span>Built with Bun · Vite · Tailwind CSS</span>
      </div>
    </div>
  </footer>`;
