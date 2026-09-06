import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IndexHtmlTransformHook, Plugin } from 'vite';
import {
  NAV_ITEMS,
  renderFooter,
  renderHeader,
  type NavKey,
} from './src/scripts/layout';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const HEADER_PLACEHOLDER_RE =
  /<div[^>]*\bdata-layout="header"[^>]*>\s*<\/div>/i;
const ACTIVE_NAV_KEY_RE = /\bdata-active="([^"]+)"/i;
const FOOTER_PLACEHOLDER_RE =
  /<div[^>]*\bdata-layout="footer"[^>]*>\s*<\/div>/i;
const MAIN_SCRIPT_RE =
  /<script type="module" src="\.\/scripts\/main\.ts"><\/script>/i;
const RENDER_BLOCKING_STYLESHEET =
  '<link rel="stylesheet" href="./styles/main.css?direct" />';
const NAVIGATION_ANCHOR_RE = /<a\b[^>]*>/gi;
const DATA_PATH_RE = /\bdata-path="([^"]+)"/i;
const EMPTY_HREF_RE = /\bhref="#"/i;

const navItemFor = (value: string) =>
  NAV_ITEMS.find(({ key }) => key === value);

const isNavKey = (value: string): value is NavKey =>
  navItemFor(value) !== undefined;

const resolveNavigationLinks = (html: string): string =>
  html.replace(NAVIGATION_ANCHOR_RE, (anchor) => {
    if (!EMPTY_HREF_RE.test(anchor)) return anchor;

    const dataPath = anchor.match(DATA_PATH_RE)?.[1];
    if (dataPath === undefined) return anchor;

    const navItem = navItemFor(dataPath);
    return navItem === undefined
      ? anchor
      : anchor.replace(EMPTY_HREF_RE, `href="${navItem.href}"`);
  });

/**
 * Vite plugin: pre-renders shared document chrome into each HTML entry
 * at serve time so the browser sees a complete, styled page on first paint.
 *
 * The plugin injects the CSS link ahead of the client module and replaces
 * the `data-layout="…"` placeholders. Keeping both behaviours here avoids
 * per-page head drift: a new entry gets the same first-paint guarantees
 * automatically.
 */
const injectLayoutPlugin = (): Plugin => {
  const transform: IndexHtmlTransformHook = (html) => {
    let next = resolveNavigationLinks(html);
    if (MAIN_SCRIPT_RE.test(next)) {
      next = next.replace(
        MAIN_SCRIPT_RE,
        `${RENDER_BLOCKING_STYLESHEET}\n    $&`,
      );
    }

    const headerMatch = next.match(HEADER_PLACEHOLDER_RE);
    if (headerMatch !== null) {
      const activeKey = headerMatch[0]?.match(ACTIVE_NAV_KEY_RE)?.[1];
      if (activeKey !== undefined && !isNavKey(activeKey)) {
        throw new Error(
          `Unknown data-active value "${activeKey}" on a shared layout placeholder.`,
        );
      }
      next = next.replace(
        HEADER_PLACEHOLDER_RE,
        renderHeader(activeKey).trim(),
      );
    }
    if (FOOTER_PLACEHOLDER_RE.test(next)) {
      next = next.replace(FOOTER_PLACEHOLDER_RE, renderFooter().trim());
    }
    return next;
  };

  return {
    name: 'shenxiaoli:inject-layout',
    transformIndexHtml: {
      order: 'pre',
      handler: transform,
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  base: './',

  plugins: [injectLayoutPlugin()],

  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
        'course-evaluation': resolve(__dirname, 'src/course-evaluation.html'),
        market: resolve(__dirname, 'src/market.html'),
        'skill-mutual-aid': resolve(__dirname, 'src/skill-mutual-aid.html'),
        'tree-hole': resolve(__dirname, 'src/tree-hole.html'),
      },
    },
  },

  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    open: true,
    host: '127.0.0.1',
  },

  preview: {
    port: 4173,
    strictPort: false,
    host: '127.0.0.1',
  },
});
