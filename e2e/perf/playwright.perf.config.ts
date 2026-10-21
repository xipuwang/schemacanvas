import { defineConfig, devices } from '@playwright/test';

/**
 * Perf / hosting e2e. Modes (PERF_MODE):
 *   dev        vite dev server on E2E_PORT                          (default)
 *   preview    `vite preview` of dist/ (run `npm run build` first)  at the build base (/schemacanvas/)
 *   subfolder  scripts/serve-static.mjs of dist/ under the build base, GitHub Pages style (404.html, slash redirect)
 * Run: E2E_PORT=5223 PERF_MODE=subfolder npx playwright test -c e2e/perf/playwright.perf.config.ts --output=.tmp/perf/results
 */
const port = Number(process.env.E2E_PORT ?? 5223);
const mode = process.env.PERF_MODE ?? 'dev';
// production modes run at the base the build was made for (vite.config.ts BUILD_BASE / SC_BASE)
const prefix = mode === 'dev' ? '/' : (process.env.SC_BASE ?? '/schemacanvas/');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  outputDir: '../../.tmp/perf/results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `${origin}${prefix}`, viewport: { width: 1440, height: 900 }, acceptDownloads: true, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--enable-precise-memory-info'] } } }],
  metadata: { mode },
  webServer: {
    command:
      mode === 'dev'
        ? `npx vite --port ${port} --strictPort --host 127.0.0.1`
        : mode === 'preview'
          ? `npx vite preview --port ${port} --strictPort --host 127.0.0.1`
          : `node scripts/serve-static.mjs dist ${port} ${prefix}`,
    url: `${origin}${prefix}`,
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: '../..',
  },
});
