import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Cross-browser tier: the acceptance suite (product specification "Definition of Done" as user scenarios) in Firefox and WebKit.
// The default config stays Chromium-only; run with `npm run e2e:cross` (needs `npx playwright install firefox webkit`).
export default defineConfig({
  ...base,
  testDir: './e2e/acceptance',
  outputDir: './e2e/.results-cross',
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
});
