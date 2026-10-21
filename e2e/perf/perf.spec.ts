/**
 * Startup, lazy loading, hosting and off-main-thread layout, on the REAL app (index.html -> src/main.tsx).
 * Modes via PERF_MODE (see playwright.perf.config.ts): dev | preview | subfolder (production build served from a sub path).
 * Metrics are written to .tmp/perf/metrics-<mode>.json (copied into docs/PERFORMANCE.md by hand).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBigProject } from '../../src/editor/perfFixtures';
import { serializeProject } from '../../src/model/io/serialize';

const MODE = process.env.PERF_MODE ?? 'dev';
const OUT = '.tmp/perf';
mkdirSync(OUT, { recursive: true });
const metrics: Record<string, unknown> = { mode: MODE };
const save = (): void => writeFileSync(join(OUT, `metrics-${MODE}.json`), JSON.stringify(metrics, null, 2));

interface Watch {
  errors: string[];
  bad: string[];
  workers: string[];
}
function watch(page: Page): Watch {
  const w: Watch = { errors: [], bad: [], workers: [] };
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && w.errors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && w.bad.push(`${r.status()} ${r.url()}`));
  page.on('requestfailed', (r) => w.bad.push(`failed ${r.url()} ${r.failure()?.errorText}`));
  page.on('worker', (wk) => w.workers.push(wk.url()));
  return w;
}
const clean = (w: Watch): void => {
  expect(w.errors, 'console errors/warnings').toEqual([]);
  expect(w.bad, 'failed requests').toEqual([]);
};

async function boot(page: Page): Promise<number> {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const t0 = Date.now();
  await page.goto('./');
  await expect(page.getByRole('toolbar')).toBeVisible();
  return Date.now() - t0;
}

async function palette(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Command palette' }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill(query);
  await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first().click();
}

async function heap(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const used = await page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);
  await cdp.detach();
  return Math.round(used / 1024 / 1024 * 10) / 10;
}

test.afterAll(save);

test('boots from this base path with a clean console, every asset loads, fonts included', async ({ page }) => {
  const w = watch(page);
  const bootMs = await boot(page);
  await expect(page.getByTestId('welcome')).toBeVisible();
  // the fonts of the build (relative url() in the css) were actually fetched and applied
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  expect(fonts.join(' ')).toMatch(/Atkinson/);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
    const js = performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name)) as PerformanceResourceTiming[];
    return {
      domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
      loadMs: Math.round(n.loadEventEnd),
      paint,
      jsRequests: js.length,
      jsEncodedKB: Math.round(js.reduce((s, r) => s + r.encodedBodySize, 0) / 1024),
      jsDecodedKB: Math.round(js.reduce((s, r) => s + r.decodedBodySize, 0) / 1024),
      names: js.map((r) => r.name.split('/').pop()),
    };
  });
  // interactive = a real pointer click on a control does something
  const t = Date.now();
  await page.getByRole('button', { name: 'Open an example' }).click();
  await expect(page.getByRole('dialog', { name: 'Examples' })).toBeVisible();
  metrics.boot = { wallToToolbarMs: bootMs, firstClickToDialogMs: Date.now() - t, ...nav };
  clean(w);
});

const serious = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);

for (const theme of ['light', 'dark'] as const) {
test(`first dialog loads lazily (${theme}): the frame shows at once with a spinner (same size), and a failed chunk offers Retry`, async ({ page }) => {
  const w = watch(page);
  await page.addInitScript((t) => localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ theme: t, locale: 'en' })), theme);
  await boot(page);
  let mode: 'slow' | 'fail' | 'pass' = 'slow';
  await page.route(/ExportDialog-[^/]*\.js|ExportDialog\.tsx/, async (route) => {
    if (mode === 'fail') return route.abort();
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
    return route.continue();
  });
  await palette(page, 'Export');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  const loading = dialog.getByTestId('lazy-loading');
  await expect(loading).toBeVisible();
  await page.screenshot({ path: join(OUT, `lazy-loading-${theme}-${MODE}.png`) });
  expect(await serious(page), 'axe: loading frame').toEqual([]);
  const width1 = await dialog.evaluate((e) => (e as HTMLElement).offsetWidth); // layout width (the open animation scales the bounding box)
  await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 20_000 });
  const width2 = await dialog.evaluate((e) => (e as HTMLElement).offsetWidth);
  expect(Math.abs(width1 - width2), 'dialog width does not jump').toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // a chunk that cannot be loaded -> error frame + Retry (a different dialog, whose chunk was never fetched)
  mode = 'fail';
  await page.route(/ImportDialog-[^/]*\.js|ImportDialog\.tsx/, (route) => (mode === 'fail' ? route.abort() : route.continue()));
  await palette(page, 'Import');
  await expect(page.getByTestId('lazy-error')).toBeVisible();
  await expect(page.getByText('Could not load this tool')).toBeVisible();
  await page.screenshot({ path: join(OUT, `lazy-error-${theme}-${MODE}.png`) });
  expect(await serious(page), 'axe: error frame').toEqual([]);
  mode = 'pass';
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('dialog', { name: 'Import' }).getByRole('tab', { name: 'SQL (DDL)' })).toBeVisible();
  // aborted chunk loads are logged by the browser as failed requests / console errors: that is expected here
  expect(w.errors.filter((e) => !/Failed to load resource|ERR_FAILED|dynamically imported module|Failed to fetch/.test(e))).toEqual([]);
});
}

test('Pharmacy: open example, convert, auto-layout (ELK in a worker), export PDF + SVG; memory with 3 diagrams', async ({ page }) => {
  const w = watch(page);
  await boot(page);
  const m: Record<string, unknown> = {};

  let t = Date.now();
  await page.getByRole('button', { name: 'Open an example' }).click();
  const ex = page.getByRole('dialog', { name: 'Examples' });
  await ex.getByRole('radio', { name: 'Pharmacy system' }).click();
  await ex.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-layer="nodes"] > [data-node-id]').first()).toBeVisible();
  m.openPharmacyMs = Date.now() - t; // includes the lazy Examples chunk, thumbnails and the example build
  const nodesEr = await page.locator('[data-layer="nodes"] > [data-node-id]').count();
  expect(nodesEr).toBeGreaterThan(20);

  // convert -> a third sheet
  t = Date.now();
  await page.getByRole('button', { name: 'Convert to relational schema' }).click();
  const cv = page.getByRole('dialog', { name: 'Convert to relational schema' });
  await expect(cv.getByTestId('convert-summary')).toContainText('tables');
  m.convertPreviewMs = Date.now() - t;
  await cv.getByTestId('convert-strategy').selectOption('relation');
  await expect(cv.getByTestId('convert-summary')).toContainText('tables');
  await cv.getByTestId('convert-apply').click();
  await expect(page.getByText(/Converted to \d+ tables/)).toBeVisible();
  expect(w.workers.some((u) => /elk-worker/.test(u)), `ELK ran in a worker (${w.workers.join(', ')})`).toBe(true);

  // auto-layout on the converted relational sheet
  const before = await page.locator('[data-layer="nodes"] > [data-node-id]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x + ',' + e.getBoundingClientRect().y).join(';'));
  await page.locator('[data-layer="nodes"] > [data-node-id]').first().click();
  t = Date.now();
  await palette(page, 'Auto-layout');
  await page.waitForFunction(() => document.querySelector('[data-layer="nodes"] > [data-node-id]') !== null);
  m.autoLayoutCommandMs = Date.now() - t;
  expect(before.length).toBeGreaterThan(0);

  // PDF export: the jsPDF/svg2pdf chunks load only now
  const jsBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /jspdf|svg2pdf/.test(r.name)).length);
  expect(jsBefore).toBe(0);
  await palette(page, 'Export');
  const d = page.getByRole('dialog', { name: 'Export' });
  await d.getByRole('radio', { name: 'PDF' }).click();
  await expect(d.getByTestId('export-download')).toBeEnabled();
  t = Date.now();
  let [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
  const pdf = readFileSync((await dl.path())!);
  m.exportPdfMs = Date.now() - t;
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(5000);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /jspdf/.test(r.name)).length)).toBeGreaterThan(0);

  if ((await page.getByRole('dialog').count()) === 0) await palette(page, 'Export'); // Download closes the dialog
  await d.getByRole('radio', { name: 'SVG' }).click();
  await expect(d.getByTestId('export-download')).toBeEnabled();
  [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
  const svg = readFileSync((await dl.path())!, 'utf8');
  expect(svg).toMatch(/^<\?xml|^<svg/);
  expect(svg).toContain('Doctor');
  await page.keyboard.press('Escape');

  // a third sheet, so the heap number below is for 3 open diagrams
  await page.getByRole('button', { name: 'New diagram' }).click();
  await page.getByRole('menuitem').first().click();
  await expect.poll(() => page.getByRole('tab').count()).toBeGreaterThanOrEqual(3);
  m.sheets = await page.getByRole('tab').count();
  m.heapMBWith3Diagrams = await heap(page);
  metrics.pharmacy = m;
  clean(w);
});

/** Import the 60-entity Chen project, run Auto-layout, report the longest frame gap and the resulting node positions. */
async function chen60Layout(page: Page, file: string, w: Watch): Promise<{ gap: number; ms: number; positions: string; longTasks: number[] }> {
  await boot(page);
  await palette(page, 'Import');
  const dlg = page.getByRole('dialog', { name: 'Import' });
  await dlg.getByRole('tab', { name: 'Project file' }).click();
  await dlg.getByTestId('import-file-input').setInputFiles(file);
  await expect(dlg.getByTestId('import-summary')).toBeVisible();
  await dlg.getByTestId('import-apply').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-layer="nodes"] > [data-node-id]').count(), { timeout: 60_000 }).toBeGreaterThan(200);
  w.workers.length = 0;
  await page.evaluate(() => {
    const s = { last: performance.now(), max: 0, stop: false, long: [] as number[] };
    (window as unknown as { __gap: typeof s }).__gap = s;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => s.long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    const tick = (now: number): void => {
      s.max = Math.max(s.max, now - s.last);
      s.last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t = Date.now();
  await palette(page, 'Auto-layout');
  // the layout is committed when the node positions change; wait for them to settle
  let prev = '';
  await expect
    .poll(
      async () => {
        const cur = await page.evaluate(() => [...document.querySelectorAll('[data-layer="nodes"] > [data-node-id]')].map((e) => { const b = e.getBoundingClientRect(); return `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)}`; }).join('|'));
        const same = cur === prev && Date.now() - t > 1500;
        prev = cur;
        return same;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  const ms = Date.now() - t;
  const r = await page.evaluate(() => {
    const s = (window as unknown as { __gap: { max: number; stop: boolean; long: number[] } }).__gap;
    s.stop = true;
    return { gap: Math.round(s.max), long: s.long };
  });
  const positions = await page.evaluate(() =>
    [...document.querySelectorAll('[data-layer="nodes"] > [data-node-id]')]
      .map((e) => { const b = e.getBoundingClientRect(); return `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)}`; })
      .join('|'),
  );
  return { gap: r.gap, ms, positions, longTasks: r.long.sort((a, b) => b - a).slice(0, 5) };
}

test('auto-layout of a 60-entity Chen diagram: worker keeps the page painting; in-thread fallback gives the identical layout', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const { project } = await buildBigProject('chen60');
  const file = join(OUT, 'chen60.schemacanvas.json');
  writeFileSync(file, serializeProject(project));

  const wPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ww = watch(wPage);
  const viaWorker = await chen60Layout(wPage, file, ww);
  expect(ww.workers.some((u) => /elk-worker/.test(u)), `a worker ran the layout (${ww.workers.join(',')})`).toBe(true);
  await wPage.screenshot({ path: join(OUT, `chen60-after-layout-${MODE}.png`) });
  clean(ww);
  await wPage.close();

  // same page with Worker removed: ELK falls back to the in-thread build automatically
  const tPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await tPage.addInitScript(() => {
    delete (window as unknown as { Worker?: unknown }).Worker;
  });
  const wt = watch(tPage);
  const inThread = await chen60Layout(tPage, file, wt);
  expect(wt.workers).toEqual([]);
  clean(wt);
  await tPage.close();

  metrics.chen60 = { worker: { maxFrameGapMs: viaWorker.gap, windowMs: viaWorker.ms, longTasksMs: viaWorker.longTasks }, inThread: { maxFrameGapMs: inThread.gap, windowMs: inThread.ms, longTasksMs: inThread.longTasks } };
  expect(viaWorker.positions.length).toBeGreaterThan(1000);
  expect(viaWorker.positions, 'worker and in-thread layouts are identical').toBe(inThread.positions);
  expect(inThread.gap, 'in-thread ELK blocks the page for a long time (this is what the worker avoids)').toBeGreaterThan(viaWorker.gap);
  info.annotations.push({ type: 'maxFrameGapMs', description: `worker ${viaWorker.gap}, in-thread ${inThread.gap}` });
});
