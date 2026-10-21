/**
 * Chinese UI sweep: the real app in zh at 1440 / 900 / 390 px, light and dark, through every surface, with a
 * programmatic text-overflow detector (e2e/i18n/overflow.ts), axe, a clean console and screenshots under .tmp/i18n/.
 * Regression test for the "Chinese UI does not overflow" goal; a failure names the surface, selector and text.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { detectOverflow } from './overflow';

const SHOTS = '.tmp/i18n';
mkdirSync(SHOTS, { recursive: true });

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '900', width: 900, height: 700 },
  { name: '390', width: 390, height: 780 },
] as const;
// The dev server is shared with workers who edit sources while this runs; an HMR full reload mid-run is retried once.
test.describe.configure({ retries: 1 });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

interface Ctx {
  page: Page;
  tag: string;
  problems: string[];
  console: string[];
}

async function check(c: Ctx, surface: string, opts: { scope?: string; axe?: boolean; shot?: boolean } = {}): Promise<void> {
  const { page } = c;
  if (process.env.SWEEP_LOG) console.log(`${c.tag} ${surface}`);
  await page.waitForTimeout(150);
  const found = await detectOverflow(page, opts.scope ?? 'body');
  for (const f of found) c.problems.push(`[${c.tag}] ${surface}: ${f.kind} ${f.selector} "${f.text}" (${f.detail})`);
  const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (doc > 0) c.problems.push(`[${c.tag}] ${surface}: page scrolls horizontally by ${doc}px`);
  if (opts.axe !== false) {
    let b = new AxeBuilder({ page });
    if (opts.scope) b = b.include(opts.scope);
    const r = await b.analyze();
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) c.problems.push(`[${c.tag}] ${surface}: axe ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ').slice(0, 200)}`);
  }
  if (opts.shot !== false) await page.screenshot({ path: `${SHOTS}/${c.tag}-${surface.replace(/[^\w-]+/g, '_')}.png` });
}

/** Run a command through the command palette (works at every width). */
async function runCommand(page: Page, label: string): Promise<void> {
  const input = page.getByPlaceholder('输入命令名称');
  for (let attempt = 0; attempt < 3 && !(await input.isVisible().catch(() => false)); attempt++) {
    // a focused text field (e.g. after a dialog closed) can swallow the shortcut: leave it first
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press(`${mod}+k`);
    await input.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined);
  }
  await expect(input).toBeVisible();
  await input.fill(label);
  await page.locator('.shell-palette-item', { has: page.locator(`.sc-menu-text:text-is("${label}")`) }).first().click();
  await expect(input).toHaveCount(0);
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  if ((await page.getByRole('dialog').count()) > 0) {
    // a focused text field consumes the first Escape (it cancels the edit): use the footer button
    await page.getByRole('dialog').getByRole('button', { name: /^(关闭|取消)$/ }).last().click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function boot(page: Page, scheme: 'light' | 'dark', width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ locale: 'zh', theme: 'system', panels: { library: true, properties: true, issues: false } }));
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.locator('.sc-canvas').first().waitFor();
}

const nodeBy = (page: Page, label: RegExp): Locator => page.locator('.sc-canvas [data-node-id]', { has: page.locator('text', { hasText: label }) }).first();

async function clickNode(page: Page, label: RegExp, extra: { modifiers?: Array<'Shift'> } = {}): Promise<void> {
  const n = nodeBy(page, label);
  await n.scrollIntoViewIfNeeded();
  const b = (await n.boundingBox())!;
  if (extra.modifiers) await page.keyboard.down('Shift');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  if (extra.modifiers) await page.keyboard.up('Shift');
}

/** Narrow layouts show the panels as drawers; open one when it is not visible. */
async function showPanel(page: Page, which: 'library' | 'properties'): Promise<void> {
  const name = which === 'library' ? '显示组件库' : '显示属性';
  const aside = page.getByRole('complementary').filter({ hasText: which === 'library' ? /搜索组件|组件/ : /图表|名称|选择/ }).first();
  if (!(await aside.isVisible().catch(() => false))) {
    const btn = page.getByRole('button', { name });
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test(`zh ${size.name} ${scheme}`, async ({ page }) => {
      test.setTimeout(240_000);
      const c: Ctx = { page, tag: `${size.name}-${scheme}`, problems: [], console: [] };
      page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && c.console.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', (e) => c.console.push(`pageerror: ${e.message}`));
      await boot(page, scheme, size.width, size.height);
      const wide = size.width >= 1100;

      // ----- empty state, toolbar, tabs, status bar
      await check(c, 'empty-state');
      if (wide) {
        for (const b of await page.getByRole('toolbar').getByRole('button').all()) {
          if (!(await b.isVisible())) continue;
          await b.hover();
          await page.waitForTimeout(450);
          const tip = page.getByRole('tooltip');
          if (await tip.count()) {
            const label = (await b.getAttribute('aria-label')) ?? 'btn';
            await check(c, `tooltip-${label}`, { shot: false, axe: false });
          }
        }
        await page.mouse.move(700, 400);
      }

      // ----- library (drawer on narrow) incl. search with no matches
      await showPanel(page, 'library');
      await check(c, 'library');
      const search = page.getByRole('searchbox').or(page.getByPlaceholder('搜索组件')).first();
      if (await search.isVisible().catch(() => false)) {
        await search.fill('zzzz');
        await check(c, 'library-nomatch', { shot: false, axe: false });
        await search.fill('');
      }
      if (!wide) await page.keyboard.press('Escape');

      // ----- examples dialog
      await runCommand(page, '打开示例');
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(c, 'dialog-examples', { scope: '[role=dialog]' });
      const card = page.getByRole('dialog').getByText('药房系统').first();
      await card.click();
      await page.waitForTimeout(200);
      await check(c, 'dialog-examples-selected', { scope: '[role=dialog]', shot: false });
      const openers = page.getByRole('dialog').getByRole('button', { name: /^(打开|在)/ });
      await openers.first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.waitForSelector('.sc-canvas [data-node-id]');
      await page.waitForTimeout(400);
      await check(c, 'er-open');

      // ----- properties for each ER selection kind
      await showPanel(page, 'properties');
      const kinds: Array<[string, RegExp]> = [
        ['sel-entity', /^Doctor$/],
        ['sel-weak-entity', /^Drug$/],
        ['sel-relationship', /^Contact$|^Sell$/],
        ['sel-identifying', /^Makes$/],
        ['sel-attribute', /^SSN$/],
      ];
      for (const [name, re] of kinds) {
        if (!wide) await page.keyboard.press('Escape');
        if ((await nodeBy(page, re).count()) === 0) continue;
        await clickNode(page, re);
        await showPanel(page, 'properties');
        await check(c, name, { scope: wide ? '[data-testid=properties-panel]' : undefined });
      }
      if (wide) {
        await clickNode(page, /^Doctor$/);
        await clickNode(page, /^Drug$/, { modifiers: ['Shift'] });
        await check(c, 'sel-multi', { scope: '[data-testid=properties-panel]' });
        const edge = page.locator('.sc-canvas [data-edge-id]').first();
        const box = await edge.boundingBox();
        if (box) {
          await edge.click({ force: true, position: { x: box.width / 2, y: box.height / 2 } }).catch(() => undefined);
          await check(c, 'sel-edge', { scope: '[data-testid=properties-panel]' });
        }
        // context menu
        await page.mouse.click(1000, 800);
        await clickNode(page, /^Doctor$/);
        const b = (await nodeBy(page, /^Doctor$/).boundingBox())!;
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
        await expect(page.getByRole('menu')).toBeVisible();
        await check(c, 'context-menu', { shot: true });
        await page.keyboard.press('Escape');
        // canvas context menu
        await page.mouse.click(1000, 800, { button: 'right' });
        if (await page.getByRole('menu').count()) await check(c, 'context-menu-canvas', { shot: false, axe: false });
        await page.keyboard.press('Escape');
      }

      // ----- validate -> issues dock; convert dialog and its tabs
      await page.keyboard.press('Escape');
      await runCommand(page, '检查模型');
      await page.waitForTimeout(500);
      await check(c, 'issues-dock');
      await runCommand(page, '转换为关系模式');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(600);
      await check(c, 'dialog-convert', { scope: '[role=dialog]' });
      for (const [ti, tab] of ['决策', '警告', '映射', '结果'].entries()) {
        const t = page.getByRole('dialog').getByRole('tab', { name: new RegExp(tab) }).first();
        if (await t.isVisible().catch(() => false)) {
          await t.click();
          await check(c, `dialog-convert-tab${ti}`, { scope: '[role=dialog]', shot: tab === '决策' || tab === '映射' });
        }
      }
      await page.getByRole('dialog').getByRole('button', { name: /^转换$/ }).first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
      await page.waitForTimeout(500);
      await check(c, 'toast-converted'); // the confirmation toast is visible right after converting

      // ----- relational sheet: table / column / fk selections, SQL dock
      await page.waitForSelector('.sc-canvas [data-node-kind="h-table"]');
      await showPanel(page, 'properties');
      const tbl = page.locator('.sc-canvas [data-node-kind="h-table"]').first();
      await tbl.scrollIntoViewIfNeeded();
      const tb = (await tbl.boundingBox())!;
      await page.mouse.click(tb.x + 6, tb.y + 6);
      await check(c, 'sel-table', { scope: wide ? '[data-testid=properties-panel]' : undefined });
      const cell = tbl.locator('text').nth(1);
      const cb = (await cell.boundingBox())!;
      await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await check(c, 'sel-column', { scope: wide ? '[data-testid=properties-panel]' : undefined });
      if (wide) {
        const fk = page.locator('.sc-canvas [data-edge-id]').first();
        const fb = await fk.boundingBox();
        if (fb) {
          await fk.click({ force: true, position: { x: fb.width / 2, y: fb.height / 2 } }).catch(() => undefined);
          await check(c, 'sel-fk', { scope: '[data-testid=properties-panel]' });
        }
      }
      await page.keyboard.press('Escape');

      await runCommand(page, '显示 SQL 面板');
      await page.waitForTimeout(500);
      await check(c, 'sql-dock');
      await runCommand(page, '查看 SQL 与 DBML');
      await expect(page.getByRole('dialog')).toBeVisible(); // dialog bodies are lazy chunks
      await page.waitForTimeout(400);
      await check(c, 'dialog-sql', { scope: '[role=dialog]' });
      await closeDialog(page);

      // ----- remaining dialogs
      for (const [label, name] of [
        ['导出图表', 'dialog-export'],
        ['导入', 'dialog-import'],
        ['图表选项', 'dialog-diagram-options'],
        ['键盘快捷键', 'dialog-shortcuts'],
        ['设置', 'dialog-settings'],
        ['关于 SchemaCanvas', 'dialog-about'],
      ] as const) {
        await runCommand(page, label);
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(500);
        await check(c, name, { scope: '[role=dialog]' });
        // every tab / format option inside export and import
        if (name === 'dialog-export' || name === 'dialog-import') {
          const opts = page.getByRole('dialog').getByRole('tab').or(page.getByRole('dialog').getByRole('radio'));
          const n = await opts.count();
          for (let i = 0; i < n; i++) {
            const o = opts.nth(i);
            if (!(await o.isVisible().catch(() => false))) continue;
            await o.click({ force: true }).catch(() => undefined);
            await check(c, `${name}-${i}`, { scope: '[role=dialog]', shot: i < 6 });
          }
        }
        await closeDialog(page);
      }

      // ----- palette itself, new-project dialog, recent projects
      await page.keyboard.press(`${mod}+k`);
      await check(c, 'palette');
      await page.keyboard.press('Escape');
      await runCommand(page, '新建项目');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(400);
      await check(c, 'dialog-new-project', { scope: '[role=dialog]' });
      await closeDialog(page);
      await check(c, 'final');

      writeFileSync(`${SHOTS}/problems-${c.tag}.txt`, [...c.console, ...[...new Set(c.problems)]].join('\n'));
      expect(c.console, 'console must be clean').toEqual([]);
      expect([...new Set(c.problems)]).toEqual([]);
    });
  }
}
