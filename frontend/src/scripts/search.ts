import { api, escapeHtml, type SearchResult } from './api';

type SearchType = SearchResult['type'];
type SearchCategory = SearchType | 'all';
const TYPES: SearchType[] = ['course', 'listing', 'skill', 'tree-hole'];
const TYPE_LABEL: Record<SearchType, string> = {
  course: '课程',
  listing: '集市',
  skill: '技能互助',
  'tree-hole': '树洞',
};
type SearchState = { items: SearchResult[]; total: number; page: number };

export function initSearch(): void {
  const results = document.querySelector<HTMLElement>('[data-search-results]');
  const termLabel = document.querySelector<HTMLElement>('[data-search-term]');
  const query = new URLSearchParams(location.search).get('q')?.trim() ?? '';
  if (!results || !termLabel) return;
  let category: SearchCategory = 'all';
  const state = new Map<SearchType, SearchState>();
  termLabel.textContent = query
    ? `“${query}” 的搜索结果`
    : '请从顶部搜索框输入关键词。';

  const hrefFor = (item: SearchResult): string => {
    if (item.type === 'course')
      return `./course-evaluation.html?course=${encodeURIComponent(item.id)}`;
    if (item.type === 'listing')
      return `./market.html?listing=${encodeURIComponent(item.id)}`;
    if (item.type === 'skill')
      return `./skill-mutual-aid.html?skill=${encodeURIComponent(item.id)}`;
    return `./tree-hole.html?post=${encodeURIComponent(item.id)}`;
  };
  const itemMarkup = (item: SearchResult): string =>
    `<a href="${hrefFor(item)}" class="block border-b border-surface-variant py-4 last:border-0"><div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-label-md text-primary">${item.identifier ? `${escapeHtml(item.identifier)} · ` : ''}${escapeHtml(item.title)}</strong><span class="text-xs text-outline">${TYPE_LABEL[item.type]} · ${escapeHtml(item.detail)}</span></div></a>`;

  const render = (): void => {
    const selectedTypes = category === 'all' ? TYPES : [category];
    results.innerHTML = selectedTypes
      .map((type) => {
        const page = state.get(type);
        if (!page)
          return `<section class="mb-8 last:mb-0"><h2 class="mb-2 font-headline-sm text-primary">${TYPE_LABEL[type]}</h2><p class="py-4 text-body-sm text-outline">正在加载…</p></section>`;
        const more =
          page.items.length < page.total
            ? `<button type="button" class="mt-3 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-search-more="${type}">加载更多（${page.items.length} / ${page.total}）</button>`
            : '';
        return `<section class="mb-8 last:mb-0"><div class="mb-2 flex items-center justify-between gap-2"><h2 class="font-headline-sm text-primary">${TYPE_LABEL[type]}</h2><span class="text-xs text-outline">${page.total} 条结果</span></div>${page.items.length ? page.items.map(itemMarkup).join('') : '<p class="py-4 text-body-sm text-outline">没有找到相关内容。</p>'}${more}</section>`;
      })
      .join('');
    results
      .querySelectorAll<HTMLButtonElement>('[data-search-more]')
      .forEach((button) => {
        button.addEventListener(
          'click',
          () => void loadType(button.dataset.searchMore as SearchType, true),
        );
      });
  };

  const loadType = async (type: SearchType, append = false): Promise<void> => {
    if (!query) return;
    const previous = state.get(type);
    const pageNumber = append ? (previous?.page ?? 0) + 1 : 1;
    try {
      const params = new URLSearchParams({
        q: query,
        type,
        page: String(pageNumber),
        pageSize: '20',
      });
      const response = await api<{
        results: SearchResult[];
        total: number;
        page: number;
      }>(`/api/search?${params}`);
      state.set(type, {
        items: append
          ? [...(previous?.items ?? []), ...response.results]
          : response.results,
        total: response.total,
        page: response.page,
      });
      render();
    } catch (error) {
      results.innerHTML = `<p class="rounded-lg bg-error-container p-4 text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '搜索失败')}</p>`;
    }
  };

  document
    .querySelectorAll<HTMLButtonElement>('[data-search-type]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        category = button.dataset.searchType as SearchCategory;
        document
          .querySelectorAll<HTMLButtonElement>('[data-search-type]')
          .forEach((item) => {
            const active = item === button;
            item.classList.toggle('bg-primary', active);
            item.classList.toggle('text-on-primary', active);
            item.classList.toggle('bg-surface-container', !active);
            item.classList.toggle('text-primary', !active);
          });
        render();
      }),
    );

  if (!query) {
    results.innerHTML =
      '<p class="py-8 text-center text-body-sm text-outline">请从顶部搜索框输入关键词，再查看完整结果。</p>';
    return;
  }
  render();
  void Promise.all(TYPES.map((type) => loadType(type)));
}
