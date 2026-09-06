import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  base: './',

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
