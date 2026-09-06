import { defineConfig } from 'vite';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, IndexHtmlTransformHook } from 'vite';
import { renderFooter, renderHeader, type NavKey } from './src/scripts/layout';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Maps an HTML entry filename (without the `.html` extension) to the
 * `NavKey` used by `layout.ts` to mark the active nav item.
 *
 * Falls back to `'home'` for any unknown file (notably `index.html`),
 * so the page chrome always renders correctly even when the mapping
 * is incomplete.
 */
const filenameToNavKey = (filename: string): NavKey => {
  switch (filename) {
    case 'index':
      return 'home';
    case 'course-evaluation':
      return 'course-evaluation';
    case 'market':
      return 'market';
    case 'skill-mutual-aid':
      return 'skill-mutual-aid';
    case 'tree-hole':
      return 'tree-hole';
    default:
      return 'home';
  }
};

const HEADER_PLACEHOLDER_RE =
  /<div[^>]*\bdata-layout="header"[^>]*>\s*<\/div>/i;
const FOOTER_PLACEHOLDER_RE =
  /<div[^>]*\bdata-layout="footer"[^>]*>\s*<\/div>/i;

/**
 * Vite plugin: pre-renders the shared header/footer into each HTML
 * entry at serve time so the browser sees a complete page on first
 * paint (no flash of un-styled chrome while the module script loads).
 *
 * The `data-layout="…"` placeholders on disk are still useful as a
 * single source of truth — they get swapped out before the response
 * leaves the dev server / build pipeline.
 */
const injectLayoutPlugin = (): Plugin => {
  const transform: IndexHtmlTransformHook = (html, ctx) => {
    const filename = basename(ctx.filename, '.html');
    const activeKey = filenameToNavKey(filename);
    const header = renderHeader(activeKey).trim();
    const footer = renderFooter().trim();

    let next = html;
    if (HEADER_PLACEHOLDER_RE.test(next)) {
      next = next.replace(HEADER_PLACEHOLDER_RE, header);
    }
    if (FOOTER_PLACEHOLDER_RE.test(next)) {
      next = next.replace(FOOTER_PLACEHOLDER_RE, footer);
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
