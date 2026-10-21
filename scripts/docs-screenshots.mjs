#!/usr/bin/env node
// Regenerates the screenshots used by README.md and docs/USER-GUIDE.md into docs/img/.
//
//   npm run dev                                   # in one terminal (or: npm run build && npm run preview)
//   node scripts/docs-screenshots.mjs [baseUrl]   # default http://127.0.0.1:5173 ; DOCS_URL also works
//
// Deterministic by construction: a fresh browser context (empty IndexedDB/localStorage), fixed 1440x900 viewport at
// device scale factor 1, light theme, English UI, reduced motion, the bundled Pharmacy example, no clock-dependent
// content in the captured regions. Re-running over an unchanged app yields visually identical PNGs. It never touches
// anything outside docs/img/ and only talks to the URL you give it.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const base = (process.argv[2] ?? process.env.DOCS_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '') + '/';
const out = join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'img');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
  reducedMotion: 'reduce',
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('schemacanvas:welcome:v1', 'dismissed');
    localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ theme: 'light', locale: 'en', panels: { library: true, properties: true, issues: false } }));
  } catch {
    /* storage blocked: the screenshots just show the welcome card */
  }
});
const page = await ctx.newPage();
page.setDefaultTimeout(120_000); // generous: a busy machine must slow the script down, not break it
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const settle = (ms = 500) => page.waitForTimeout(ms);
const shot = async (name, target = page) => {
  await settle();
  // transient toasts ("Opened ...", "Saved") would sit on top of the properties panel: dismiss them first
  for (const b of await page.locator('[role=status] button[aria-label="Dismiss"]').all()) await b.click().catch(() => {});
  await page.mouse.move(2, 2); // no hover tooltips / hover states in the captures
  await settle(700);
  await target.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
  console.log('wrote docs/img/' + name + '.png');
};

await page.goto(base);
await page.getByRole('toolbar').waitFor();
await page.locator('.sc-canvas').waitFor();

// 0. empty app
await shot('empty-app');

const openExample = async (view) => {
  await page.getByRole('button', { name: 'Command palette' }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('examples');
  await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first().click();
  const ex = page.getByRole('dialog', { name: 'Examples' });
  await ex.getByRole('radio', { name: view === 'relational' ? 'Relational schema' : 'ER diagram' }).first().click();
  await ex.getByRole('radio', { name: /Pharmacy system/ }).click();
  await ex.getByRole('button', { name: 'Open example' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: view === 'relational' ? 'Relational schema' : 'ER diagram' }).waitFor();
  await settle(800);
};
const fit = async () => {
  await page.locator('.sc-canvas').click({ position: { x: 5, y: 5 } }); // empty corner: clears the selection, focuses the sheet
  await page.keyboard.press('Shift+1');
  await settle(600);
};
const select = async (text, y = 4) => {
  await page.locator('.sc-canvas [data-node-id]').filter({ hasText: text }).first().click({ position: { x: 4, y } });
  await settle(300);
};

// 1. Chen ER of the Pharmacy example, then an entity selected (the properties panel shows its form)
await openExample('er');
await fit();
await shot('er-pharmacy');
await select(/^Drug/);
await shot('properties-entity');

// 2. convert dialog (the real preview; cancelled afterwards so the example stays as shipped)
await page.getByRole('button', { name: 'Convert to relational schema' }).click();
const cv = page.getByRole('dialog', { name: 'Convert to relational schema' });
await cv.getByTestId('convert-summary').waitFor({ timeout: 120000 }); // first use loads the lazy convert chunk
await settle(1000);
await shot('convert-dialog');
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' });

// 3. the example's own horizontal relational schema (hand-tuned layout), a table selected
await openExample('relational');
await fit();
await shot('relational-pharmacy');
await select(/Prescription/, 14);
await shot('properties-relation');
// zoom on the selection: the Prescription table with its composite keys and the arrows leaving it
await page.keyboard.press('Shift+2');
await settle(800);
await shot('relational-zoom');

// 4. issues dock
await page.getByRole('button', { name: 'Validate model' }).click();
await settle(1000);
await shot('issues-dock');

// 5. export dialog
await page.getByRole('button', { name: 'Export diagram' }).click();
await page.getByRole('dialog', { name: 'Export' }).waitFor();
await shot('export-dialog');
await page.keyboard.press('Escape');

await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
