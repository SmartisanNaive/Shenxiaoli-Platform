/**
 * Entry script — page wiring for the multi-page frontend.
 *
 * Layout (header / footer / active nav state) is pre-rendered into
 * each HTML entry by `vite.config.ts → shenxiaoli:inject-layout`,
 * so this script only handles runtime interactivity:
 *
 *   - Search input → Enter logs the query (placeholder for the real
 *     search backend).
 */

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

const updateFooterYear = (): void => {
  const currentYear = String(new Date().getFullYear());
  document
    .querySelectorAll<HTMLElement>('[data-current-year]')
    .forEach((el) => {
      el.textContent = currentYear;
    });
};

const init = (): void => {
  updateFooterYear();
  enhanceSearchInputs();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
