import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildExample } from '../../src/examples';
import { serializeProject } from '../../src/model/io';
import type { Project } from '../../src/model/types';

export const SHOTS = '.tmp/panels-a';
mkdirSync(`${SHOTS}/fixtures`, { recursive: true });

/** Console errors and warnings fail the test (the real app must be silent). */
export function trackConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

export interface BootOptions {
  viewport?: { width: number; height: number };
  theme?: 'light' | 'dark';
  locale?: 'en' | 'zh';
}

/** Start the real app with the given preferences (stored before the page loads, exactly like a returning user). */
export async function boot(page: Page, opts: BootOptions = {}): Promise<void> {
  if (opts.viewport) await page.setViewportSize(opts.viewport);
  await page.addInitScript(
    ([theme, locale]) => {
      try {
        if (!localStorage.getItem('schemacanvas:settings:v1')) localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ theme, locale, panels: { library: true, properties: true, issues: false } }));
      } catch {
        /* ignore */
      }
    },
    [opts.theme ?? 'light', opts.locale ?? 'en'] as const,
  );
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.locator('.sc-canvas').first().waitFor();
}

/** Open a project through the shell's real "Open project file" flow (file chooser). */
export async function openProject(page: Page, project: Project, name: string, opts: { waitToastGone?: boolean } = {}): Promise<void> {
  const path = `${SHOTS}/fixtures/${name}.schemacanvas.json`;
  writeFileSync(path, serializeProject(project));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Open project file|打开项目文件/ }).click()]);
  await chooser.setFiles(path);
  await expect(page.getByText(/^(Opened|已打开) /).first()).toBeVisible();
  await page.mouse.move(640, 400); // no tooltip over the toolbar in later screenshots
  // screenshots must not contain the confirmation toast
  if (opts.waitToastGone) await expect(page.getByText(/^(Opened|已打开) /)).toHaveCount(0, { timeout: 9000 });
}

export const pharmacy = (): Project => buildExample('pharmacy');

export async function seriousViolations(page: Page, include: string[]) {
  let builder = new AxeBuilder({ page });
  for (const sel of include) builder = builder.include(sel);
  const result = await builder.analyze();
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

export const noHScroll = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));

/** Centre of a node on the sheet (client coordinates). */
export async function nodeCentre(page: Page, label: string | RegExp, exact = true): Promise<{ x: number; y: number }> {
  const node = page.locator('.sc-canvas [data-node-id]', { has: page.locator('text', { hasText: typeof label === 'string' && exact ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : label }) }).first();
  const box = await node.boundingBox();
  if (!box) throw new Error(`no node ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function clickNode(page: Page, label: string): Promise<void> {
  const c = await nodeCentre(page, label);
  await page.mouse.click(c.x, c.y);
}

export const props = (page: Page): Locator => page.getByTestId('properties-panel');

/** Client point on an edge (middle of its longest stroked segment, in screen px). */
export async function edgePoint(page: Page, edge: Locator): Promise<{ x: number; y: number }> {
  return edge.evaluate((g) => {
    const els = Array.from(g.querySelectorAll<SVGGeometryElement>('polyline,path,line')).filter((e) => e.getAttribute('stroke') && e.getAttribute('stroke') !== 'none' && typeof e.getTotalLength === 'function' && e.getTotalLength() > 12);
    const el = els.sort((a, b) => b.getTotalLength() - a.getTotalLength())[0]!;
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    const m = el.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
}

export async function gotoRelationalSheet(page: Page): Promise<void> {
  // default sheet names are shown in the UI language (src/i18n/defaultNames.ts), so the zh sweeps see 关系模式图
  await page.getByRole('tab', { name: /Relational schema|关系模式图/i }).click();
  await expect(page.locator('.sc-canvas [data-node-kind="h-table"]').first()).toBeVisible();
}

/** Click the relation-name label of a table (selects the table, not a cell). */
export async function selectTable(page: Page, name: string): Promise<void> {
  const label = page.locator('.sc-canvas [data-node-kind="h-table"] text', { hasText: new RegExp(`^${name}$`) }).first();
  const b = (await label.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
