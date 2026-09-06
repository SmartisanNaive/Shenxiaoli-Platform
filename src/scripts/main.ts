/**
 * Entry script — page wiring for the multi-page frontend.
 *
 * Layout (header / footer / active nav state) is pre-rendered into
 * each HTML entry by `vite.config.ts → shenxiaoli:inject-layout`,
 * so this script only handles runtime interactivity:
 *
 *   - Search input → Enter logs the query (placeholder for the real
 *     search backend; the placeholder divs in `layout.ts` stay in the
 *     DOM so a real client-side router can hook into them later).
 */

import '../styles/main.css';

const enhanceSearchInputs = (): void => {
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
  enhanceSearchInputs();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
