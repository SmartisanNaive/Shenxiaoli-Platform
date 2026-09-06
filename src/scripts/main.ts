/**
 * Entry script — resolves shared layout placeholders, wires up
 * simple interactivity (search focus, nav highlighting, smooth
 * scroll), and provides a small DOM-ready helper used by pages.
 */

import { renderFooter, renderHeader, type NavKey } from './layout';
import '../styles/main.css';

const isNavKey = (v: string | null): v is NavKey => {
  if (v === null) return false;
  return (
    v === 'home' ||
    v === 'course-evaluation' ||
    v === 'market' ||
    v === 'skill-mutual-aid' ||
    v === 'tree-hole'
  );
};

const mountLayout = (): void => {
  document.querySelectorAll<HTMLElement>('[data-layout]').forEach((el) => {
    const slot = el.dataset.layout;
    if (slot === 'header') {
      const activeAttr = el.dataset.active ?? null;
      const active = isNavKey(activeAttr) ? activeAttr : 'home';
      el.outerHTML = renderHeader(active);
    } else if (slot === 'footer') {
      el.outerHTML = renderFooter();
    }
  });
};

const enhanceSearch = (): void => {
  const searchInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="text"][placeholder^="搜索"]',
  );
  searchInputs.forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const query = input.value.trim();
        if (query.length > 0) {
          console.info('[search]', query);
        }
      }
    });
  });
};

const init = (): void => {
  mountLayout();
  enhanceSearch();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
