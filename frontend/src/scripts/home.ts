import {
  api,
  escapeHtml,
  imageUrl,
  type Listing,
  type SessionState,
  type SkillPost,
} from './api';

interface HomeData {
  counts: {
    courses: number;
    listings: number;
    skills: number;
    treePosts: number;
  };
  featuredCourses: {
    id: string;
    code: string;
    title: string;
    department: string;
    rating: number;
    review_count: number;
  }[];
  latestListings: Listing[];
  latestSkills: SkillPost[];
  latestTreePosts: {
    id: string;
    content: string;
    topic: string;
    created_at: string;
    author: string;
  }[];
  demoData: boolean;
}

function renderListing(listing: Listing): string {
  const image = imageUrl(listing.images[0]);
  return `<a href="./market.html?listing=${encodeURIComponent(listing.id)}" class="group flex min-w-0 items-center gap-3 border-b border-surface-variant py-3 last:border-0">
    ${image ? `<img src="${image}" alt="${escapeHtml(listing.title)}" class="h-14 w-14 rounded-lg object-cover">` : '<span class="material-symbols-outlined flex h-14 w-14 items-center justify-center rounded-lg bg-surface-container-low text-primary" aria-hidden="true">inventory_2</span>'}
    <span class="min-w-0 flex-1"><strong class="block truncate text-label-md text-primary group-hover:text-secondary">${escapeHtml(listing.title)}</strong><span class="text-body-sm text-outline">${escapeHtml(listing.category)} · ${escapeHtml(listing.condition)}</span></span>
    <span class="shrink-0 text-label-md font-semibold text-primary">¥${listing.price.toFixed(0)}</span>
  </a>`;
}

let listeningForSessionChanges = false;

export async function initHome(): Promise<void> {
  const footer = document.querySelector<HTMLElement>('footer');
  if (!footer) return;
  if (!listeningForSessionChanges) {
    listeningForSessionChanges = true;
    window.addEventListener(
      'shenxiaoli:session-changed',
      () => void initHome(),
    );
  }
  document
    .querySelectorAll(
      '#home-featured-courses, #home-featured-market, #home-social-feed, [data-home-feed]',
    )
    .forEach((sampleSection) => sampleSection.remove());
  const section = document.createElement('section');
  section.setAttribute('data-home-feed', '');
  section.className = 'mx-auto mb-20 w-full max-w-[1200px] px-gutter';
  section.setAttribute('aria-labelledby', 'campus-feed-title');
  section.innerHTML = `<div class="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h2 id="campus-feed-title" class="font-headline-lg text-primary">校园动态</h2><p class="mt-1 text-body-md text-on-surface-variant">把课程信息、闲置流转和同学互助汇在一起。</p></div><span class="hidden rounded-full bg-surface-container-low px-3 py-1 text-body-sm text-outline" data-demo-data-label>本地开发演示数据</span></div><div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-home-counts></div><div class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"><section class="rounded border border-surface-variant bg-surface p-5"><div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">课程口碑</h3><a href="./course-evaluation.html" class="text-label-sm text-secondary">查看评课</a></div><div data-home-courses></div></section><section class="rounded border border-surface-variant bg-surface p-5"><div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">最新闲置</h3><a href="./market.html" class="text-label-sm text-secondary">逛逛集市</a></div><div data-home-listings></div></section><section class="rounded border border-surface-variant bg-surface p-5"><div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">技能互助</h3><a href="./skill-mutual-aid.html" class="text-label-sm text-secondary">找搭子</a></div><div data-home-skills></div></section><section class="rounded border border-surface-variant bg-surface p-5"><div class="mb-2 flex items-center justify-between"><h3 class="font-headline-sm text-primary">树洞一角</h3><a href="./tree-hole.html" class="text-label-sm text-secondary">进入树洞</a></div><div data-home-tree></div></section></div>`;
  footer.before(section);

  try {
    const session = await api<SessionState>('/api/session');
    if (!session.authenticated) {
      section.innerHTML =
        '<div class="rounded border border-outline-variant bg-surface p-8"><h2 class="font-headline-md text-primary">校园内容仅向已登录成员开放</h2><p class="mt-2 text-body-md text-on-surface-variant">请使用邮箱验证登录；邮箱验证不代表学籍认证。</p><button type="button" class="mt-4 rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary" data-home-login data-open-login>邮箱登录</button></div>';
      return;
    }
    const data = await api<HomeData>('/api/home');
    const countLabels = [
      ['courses', '门课程'],
      ['listings', '件闲置'],
      ['skills', '条互助'],
      ['treePosts', '篇树洞'],
    ] as const;
    const counts = section.querySelector<HTMLElement>('[data-home-counts]');
    if (counts) {
      counts.innerHTML = countLabels
        .map(
          ([key, suffix]) =>
            `<div class="border-l-2 border-secondary pl-3"><strong class="font-headline-md text-primary">${data.counts[key]}</strong><span class="ml-2 text-body-sm text-outline">${suffix}</span></div>`,
        )
        .join('');
    }
    section
      .querySelector('[data-demo-data-label]')
      ?.classList.toggle('hidden', !data.demoData);
    const courses = section.querySelector<HTMLElement>('[data-home-courses]');
    if (courses) {
      courses.innerHTML = data.featuredCourses.length
        ? data.featuredCourses
            .map(
              (course) =>
                `<a href="./course-evaluation.html?course=${encodeURIComponent(course.id)}" class="flex items-start justify-between gap-4 border-b border-surface-variant py-3 last:border-0"><span><strong class="block text-label-md text-primary">${escapeHtml(course.title)}</strong><span class="text-body-sm text-outline">${escapeHtml(course.code)} · ${escapeHtml(course.department)}</span></span><span class="shrink-0 font-headline-sm text-secondary">${Number(course.rating).toFixed(1)}</span></a>`,
            )
            .join('')
        : '<p class="py-5 text-body-sm text-outline">暂时没有课程评价。</p>';
    }
    const listings = section.querySelector<HTMLElement>('[data-home-listings]');
    if (listings)
      listings.innerHTML = data.latestListings.length
        ? data.latestListings.map(renderListing).join('')
        : '<p class="py-5 text-body-sm text-outline">暂时没有在售闲置。</p>';
    const skills = section.querySelector<HTMLElement>('[data-home-skills]');
    if (skills) {
      skills.innerHTML = data.latestSkills.length
        ? data.latestSkills
            .map(
              (post) =>
                `<a href="./skill-mutual-aid.html?skill=${encodeURIComponent(post.id)}" class="block border-b border-surface-variant py-3 last:border-0"><span class="text-label-sm text-secondary">${escapeHtml(post.category)} · ${post.kind === 'offer' ? '技能分享' : '发起求助'}</span><strong class="mt-1 block text-label-md text-primary">${escapeHtml(post.title)}</strong><p class="mt-1 line-clamp-2 text-body-sm text-on-surface-variant">${escapeHtml(post.description)}</p></a>`,
            )
            .join('')
        : '<p class="py-5 text-body-sm text-outline">暂时没有技能互助内容。</p>';
    }
    const tree = section.querySelector<HTMLElement>('[data-home-tree]');
    if (tree) {
      tree.innerHTML = data.latestTreePosts.length
        ? data.latestTreePosts
            .map(
              (post) =>
                `<a href="./tree-hole.html?post=${encodeURIComponent(post.id)}" class="block border-b border-surface-variant py-3 last:border-0"><span class="text-label-sm text-secondary">${escapeHtml(post.topic)}</span><p class="mt-1 line-clamp-2 text-body-md text-on-surface">${escapeHtml(post.content)}</p></a>`,
            )
            .join('')
        : '<p class="py-5 text-body-sm text-outline">暂时没有公开内容。</p>';
    }
  } catch {
    section.innerHTML +=
      '<p class="mt-5 text-body-sm text-outline">API 暂不可用。启动后端后，这里会显示实时内容。</p>';
  }
}
