import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { i18nSplit } from './scripts/vite-i18n-split.ts';
import { metaCsp } from './scripts/vite-csp.ts';

const src = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Where the production build is served. GitHub Pages project site: https://xipuwang.github.io/schemacanvas/ -> '/schemacanvas/'.
 * Override for another host with SC_BASE, e.g. `SC_BASE=/ npm run build` (domain root) or `SC_BASE=./` (relative URLs, any
 * folder). The dev server and the e2e suites always run at '/'.
 */
export const BUILD_BASE = process.env.SC_BASE ?? '/schemacanvas/';

export default defineConfig(({ command, isPreview }) => ({
  plugins: [i18nSplit(), react(), metaCsp()],
  resolve: {
    alias: { '@': src },
  },
  base: command === 'build' || isPreview ? BUILD_BASE : '/',
  build: {
    rolldownOptions: {
      // 404.html goes through Vite (not public/) so its link gets the base path (%BASE_URL%); GitHub Pages serves it for misses.
      input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), notFound: fileURLToPath(new URL('./404.html', import.meta.url)) },
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)\/(?!.*server)/, priority: 20 },
            { name: 'react-dom-server', test: /node_modules\/react-dom\/(cjs\/react-dom-server|server)/, priority: 20 },
            { name: 'render-standalone', test: /src\/render\/standalone(Core)?\.tsx/, priority: 15, includeDependenciesRecursively: false },
            { name: 'vendor-state', test: /node_modules\/(zustand|immer)\//, priority: 20 },
          ],
        },
      },
      // react-dom/server (~190 KB) is only used by explicit renderToStaticMarkup calls; modules that import it must
      // not drag it into the entry just because `@/render` re-exports them.
      treeshake: { moduleSideEffects: [{ test: /node_modules\/react-dom\/(cjs\/react-dom-server|server)|src\/render\/standalone(Core)?\.tsx/, sideEffects: false }] },
    },
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // Playwright traces / screenshots land in these folders; watching them reloads open pages mid-test.
    watch: { ignored: ['**/.tmp/**', '**/e2e/.results/**', '**/dist/**', '**/.vitest/**', '**/*.log'] },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Component/DOM tests opt in with a `// @vitest-environment jsdom` docblock.
    globals: false,
    // Tests see both languages: the app loads zh on demand, tests load it up front.
    setupFiles: ['src/i18n/testSetup.ts'],
    testTimeout: 20_000,
  },
}));
