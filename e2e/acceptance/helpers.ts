/**
 * Shared page-object helpers of the acceptance suite.
 *
 * RULE: everything here drives the REAL app (index.html -> src/main.tsx) through the user interface only: real pointer and
 * keyboard events, HTML5 drag and drop from the parts library, file chooser, downloads. State is READ either from the DOM
 * (rendered geometry) or from files the app DOWNLOADED (project JSON, SVG, PNG, PDF, SQL), which is how a user's work leaves the
 * app. No window hooks are used.
 */
import { expect, test as base, type Browser, type Download, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

export const OUT = '.tmp/acceptance';
export const SHOTS = OUT;
export const DOWNLOADS = `${OUT}/downloads`;
mkdirSync(DOWNLOADS, { recursive: true });

export const VIEWPORT = { width: 1440, height: 900 } as const;

// ---------------------------------------------------------------------------------------------------------------------
// minimal view of the saved project (only what the assertions read)
// ---------------------------------------------------------------------------------------------------------------------

export interface PRef {
  kind: string;
  id: string;
  relationId?: string;
  relationshipId?: string;
}
export interface PCol {
  id: string;
  name: string;
  nullable: boolean;
  dataType?: string;
}
export interface PRelation {
  id: string;
  name: string;
  columns: PCol[];
  primaryKey: string[];
  uniques: Array<{ id: string; columnIds: string[] }>;
}
export interface PFk {
  id: string;
  sourceRelationId: string;
  targetRelationId: string;
  columns: Array<{ sourceColumnId: string; targetColumnId: string }>;
}
export interface PModel {
  id: string;
  kind: 'er' | 'relational';
  name: string;
  entities?: Record<string, { id: string; name: string; weak: boolean }>;
  attributes?: Record<string, { id: string; name: string; owner: PRef; key: string; multivalued: boolean; derived: boolean; optional?: boolean }>;
  relationships?: Record<
    string,
    {
      id: string;
      name: string;
      identifying: boolean;
      participants: Array<{ id: string; entityId: string; max: 'one' | 'many'; participation: 'partial' | 'total'; role?: string; identified?: boolean }>;
    }
  >;
  relations?: Record<string, PRelation>;
  foreignKeys?: Record<string, PFk>;
}
export interface PDiagram {
  id: string;
  name: string;
  type: string;
  modelId: string;
  nodes: Record<string, { id: string; ref: PRef; x: number; y: number; width?: number; height?: number; columnWidths?: Record<string, number> }>;
  edges: Record<string, { id: string; ref: { kind: string; foreignKeyId?: string; participantId?: string; attributeId?: string }; route: { mode: string; waypoints: Array<{ x: number; y: number }> } }>;
  options: Record<string, any>;
}
export interface PProject {
  id: string;
  name: string;
  models: Record<string, PModel>;
  diagrams: Record<string, PDiagram>;
  diagramOrder: string[];
  conversions: Record<string, { id: string; erModelId: string; relationalModelId: string; options: any; trace: any[]; decisions: Array<{ id: string; ruleId: string; title: string; explanation: string; level: string }>; warnings: any[] }>;
}
export interface PFile {
  format: string;
  schemaVersion: number;
  project: PProject;
}

export const relModels = (p: PProject): PModel[] => Object.values(p.models).filter((m) => m.kind === 'relational');
export const erModels = (p: PProject): PModel[] => Object.values(p.models).filter((m) => m.kind === 'er');
export const diagramOfType = (p: PProject, type: string): PDiagram | undefined => p.diagramOrder.map((id) => p.diagrams[id]!).find((d) => d.type === type);
export const relationalDiagram = (p: PProject): PDiagram => diagramOfType(p, 'relational-schema')!;
export const chenDiagram = (p: PProject): PDiagram => diagramOfType(p, 'chen')!;
export const modelOf = (p: PProject, d: PDiagram): PModel => p.models[d.modelId]!;
export function relation(m: PModel, name: string): PRelation {
  const r = Object.values(m.relations ?? {}).find((x) => x.name === name);
  if (!r) throw new Error(`no relation ${name}; have ${Object.values(m.relations ?? {}).map((x) => x.name).join(', ')}`);
  return r;
}
export const col = (r: PRelation, name: string): PCol => {
  const c = r.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${r.name}.${name}; have ${r.columns.map((x) => x.name).join(', ')}`);
  return c;
};
export const colNames = (r: PRelation): string[] => r.columns.map((c) => c.name);
export const pkNames = (r: PRelation): string[] => r.primaryKey.map((id) => r.columns.find((c) => c.id === id)!.name);
/** `Src.(a,b) -> Tgt.(c,d)` strings of every FK of the model, sorted. */
export function fkStrings(m: PModel): string[] {
  const rels = m.relations ?? {};
  return Object.values(m.foreignKeys ?? {})
    .map((fk) => {
      const s = rels[fk.sourceRelationId]!;
      const t = rels[fk.targetRelationId]!;
      const n = (r: PRelation, id: string) => r.columns.find((c) => c.id === id)!.name;
      const a = fk.columns.map((p) => n(s, p.sourceColumnId)).join(',');
      const b = fk.columns.map((p) => n(t, p.targetColumnId)).join(',');
      return `${s.name}.(${a}) -> ${t.name}.(${b})`;
    })
    .sort();
}
export const nodeIdOfRelation = (d: PDiagram, relationId: string): string => {
  const n = Object.values(d.nodes).find((x) => x.ref.kind === 'relation' && x.ref.id === relationId);
  if (!n) throw new Error(`relation ${relationId} is not on diagram ${d.name}`);
  return n.id;
};

// ---------------------------------------------------------------------------------------------------------------------
// console + session
// ---------------------------------------------------------------------------------------------------------------------

/** Console errors and warnings fail the test (the real app must be silent). */
export function trackConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** Per-test page fixture: fresh context, console tracked, fails on any console error or warning. */
export const test = base.extend<{ app: Page }>({
  app: async ({ browser }, use, info) => {
    const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, baseURL: info.project.use.baseURL });
    const page = await context.newPage();
    const errors = trackConsole(page);
    await use(page);
    await context.close();
    expect(errors, 'console errors / warnings').toEqual([]);
  },
});
export { expect };

/** For `test.describe.serial` flows that share ONE page. Call inside the describe block. */
export function sharedSession(testApi: typeof base): { page(): Page; errors: string[] } {
  let page: Page | undefined;
  let ctxClose: (() => Promise<void>) | undefined;
  const errors: string[] = [];
  testApi.beforeAll(async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, baseURL: info.project.use.baseURL });
    page = await context.newPage();
    errors.length = 0;
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    ctxClose = () => context.close();
  });
  testApi.afterEach(() => {
    expect(errors.splice(0), 'console errors / warnings').toEqual([]);
  });
  testApi.afterAll(async () => {
    await ctxClose?.();
  });
  return {
    page: () => {
      if (!page) throw new Error('session page not ready');
      return page;
    },
    errors,
  };
}

export async function newSession(browser: Browser, baseURL: string): Promise<{ page: Page; errors: string[]; close(): Promise<void> }> {
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, baseURL });
  const page = await context.newPage();
  const errors = trackConsole(page);
  return { page, errors, close: () => context.close() };
}

// ---------------------------------------------------------------------------------------------------------------------
// app page objects
// ---------------------------------------------------------------------------------------------------------------------

/** Opens the app on a clean origin (no stored project) and waits until the shell is ready. */
export async function openApp(page: Page, opts: { welcome?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.locator('.sc-canvas')).toBeVisible();
  if (!opts.welcome) {
    const dismiss = page.getByRole('button', { name: 'Hide' });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }
}

export const sheet = (page: Page): Locator => page.locator('.sc-canvas');
export const library = (page: Page): Locator => page.getByRole('complementary', { name: 'Parts library' });
export const properties = (page: Page): Locator => page.getByRole('complementary', { name: 'Properties' });

/** Run a command from the command palette. */
export async function palette(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Command palette' }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill(query);
  await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first().click();
}

/** Examples dialog -> choose card -> Open. `view` decides which sheet becomes active (the dialog's own toggle). */
export async function openExample(page: Page, title: string, view: 'er' | 'relational' = 'er'): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Open an example' });
  if (await trigger.isVisible().catch(() => false)) await trigger.click();
  else await palette(page, 'Open an example');
  const dialog = page.getByRole('dialog', { name: 'Examples' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: view === 'relational' ? 'Relational schema' : 'ER diagram' }).first().click();
  await dialog.getByRole('radio', { name: title }).click();
  await dialog.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: view === 'relational' ? 'Relational schema' : 'ER diagram' })).toHaveAttribute('aria-selected', 'true');
  await settle(page);
}

export async function switchSheet(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await settle(page);
}

/** Lets the canvas finish its eased view changes and the 120 ms dialog fade. */
export async function settle(page: Page, ms = 350): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Toolbar Convert -> (optionally pick a 1:1 strategy / tick derived) -> Convert. Returns the decisions tab text before apply. */
export async function convertViaDialog(
  page: Page,
  opts: { materialize?: string[]; apply?: boolean; tab?: 'Decisions' | 'Warnings' | 'Mapping' | 'Result' } = {},
): Promise<{ decisionsText: string; summary: string }> {
  await page.getByRole('button', { name: 'Convert to relational schema' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to relational schema' });
  await expect(dialog).toBeVisible();
  for (const name of opts.materialize ?? []) {
    await dialog.getByRole('group', { name: 'Derived attributes' }).getByRole('checkbox', { name: new RegExp(name) }).check();
  }
  // wait for the debounced live preview of THIS plan
  const apply = dialog.getByTestId('convert-apply');
  await expect(apply).toBeEnabled({ timeout: 20_000 });
  await expect(dialog.getByTestId('convert-summary')).toContainText(/table/);
  await page.waitForTimeout(500);
  await expect(apply).toBeEnabled({ timeout: 20_000 });
  const decisionsText = (await dialog.getByTestId('convert-panel-decisions').innerText().catch(() => '')) ?? '';
  const summary = await dialog.getByTestId('convert-summary').innerText();
  if (opts.apply !== false) {
    await apply.click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await settle(page);
  }
  return { decisionsText, summary };
}

// ---------------------------------------------------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------------------------------------------------

export interface Downloaded {
  name: string;
  path: string;
  bytes: Buffer;
  text(): string;
}

/** Runs `trigger`, waits for the browser download, stores it in a private directory and returns the bytes. */
export async function download(page: Page, trigger: () => Promise<unknown>, dir = DOWNLOADS): Promise<Downloaded> {
  mkdirSync(dir, { recursive: true });
  const [dl]: [Download, unknown] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), trigger()]);
  const name = dl.suggestedFilename();
  const path = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${name.replace(/[^\w.\- ()]/g, '_')}`);
  await dl.saveAs(path);
  const bytes = readFileSync(path);
  return { name, path, bytes, text: () => bytes.toString('utf8') };
}

/** Toolbar "Save project file": returns the parsed envelope of the file the user would keep. */
export async function saveProject(page: Page): Promise<{ file: PFile; dl: Downloaded }> {
  const dl = await download(page, () => page.getByRole('button', { name: 'Save project file' }).click());
  const file = JSON.parse(dl.text()) as PFile;
  expect(file.format).toBe('schemacanvas-project');
  return { file, dl };
}

/** Export dialog: pick format, adjust, press Download; resolves with the downloaded file. */
export async function exportVia(
  page: Page,
  kind: 'SVG' | 'PNG' | 'PDF' | 'Project file' | 'SQL' | 'DBML',
  adjust?: (dialog: Locator) => Promise<void>,
): Promise<Downloaded> {
  await page.getByRole('button', { name: 'Export diagram' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${kind}`) }).click();
  if (adjust) await adjust(dialog);
  const btn = dialog.getByRole('button', { name: 'Download' });
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  const dl = await download(page, () => btn.click());
  await page.keyboard.press('Escape').catch(() => undefined);
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: /Close|Cancel/ }).first().click().catch(() => undefined);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return dl;
}

/** Real file chooser: File > Open project file (toolbar button) with a file from disk. */
export async function openProjectFile(page: Page, path: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open project file' }).click()]);
  await chooser.setFiles(path);
}

// ---------------------------------------------------------------------------------------------------------------------
// pointer helpers
// ---------------------------------------------------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}
export async function centre(loc: Locator): Promise<Pt> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no bounding box for ${loc}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/**
 * Click the centre of an element with a real mouse press, positioned from the element's in-page getBoundingClientRect. Used for
 * SVG <text>: the canvas does its own hit-testing from the pointer position, and in Playwright's WebKit both `boundingBox()` and
 * the actionability hit target are wrong for SVG text inside transformed groups (boundingBox ignores the group transform, so it
 * points at empty sheet; elementFromPoint reports the root <svg>), so `locator.click()` never succeeds there although a real
 * click on the text works.
 */
export async function clickCentre(page: Page, loc: Locator): Promise<void> {
  const c = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
}
export async function dragMouse(page: Page, from: Pt, to: Pt, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

/** The node group (`[data-node-id]`) of the canvas that contains the given text label. */
export const nodeByText = (page: Page, text: string | RegExp): Locator => sheet(page).locator('[data-node-id]').filter({ hasText: text });

export async function nodeIdOf(loc: Locator): Promise<string> {
  const id = await loc.first().evaluate((e) => (e.closest('[data-node-id]') ?? e).getAttribute('data-node-id'));
  if (!id) throw new Error('no node id');
  return id;
}

/**
 * Playwright's WebKit keeps its synthetic HTML5 drag session alive after `dragTo`: the NEXT mouse press is consumed to end that
 * session and never produces a pointerdown (verified: events after a drop were mousedown/pointerup/click without pointerdown, and
 * the next click worked). It matters only when the next step is a press on an existing shape (not for `dropPart`, whose follow-up is the
 * inline-name input that a stray press would blur). Real Safari ends the session natively, so this is test mechanics, not an app bug. One throw-away press on
 * the status bar (outside the sheet, so the selection is untouched) ends it; a no-op in the other engines.
 */
export async function endDragSession(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() !== 'webkit') return;
  const vp = page.viewportSize() ?? VIEWPORT;
  await page.mouse.click(vp.width / 2, vp.height - 6);
}

/** Drag a library part onto the sheet with real HTML5 drag events. */
export async function dropPart(page: Page, partId: string, at: Pt): Promise<void> {
  await library(page).locator(`[data-part-id="${partId}"]`).dragTo(sheet(page), { targetPosition: at });
  await page.waitForTimeout(150);
}

/** Select the node (click its centre) then use its "+" port to add an attribute, and name it in the inline editor. */
export async function addAttributeViaPort(page: Page, owner: Locator, name: string): Promise<void> {
  await owner.click();
  const nid = await nodeIdOf(owner);
  const port = sheet(page).locator(`[data-port-id="port:add:${nid}"]`);
  await expect(port).toBeVisible();
  const c = await centre(port);
  await page.mouse.click(c.x, c.y);
  const input = page.locator('.sc-inline-input');
  await expect(input).toBeVisible();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
}

/** Inline-rename by double click, then type. */
export async function renameInline(page: Page, target: Locator, name: string): Promise<void> {
  await target.dblclick();
  const input = page.locator('.sc-inline-input');
  await expect(input).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
}

export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<string> {
  const path = `${SHOTS}/${name}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path, fullPage: opts.fullPage ?? true });
  return path;
}

// ---------------------------------------------------------------------------------------------------------------------
// DOM geometry
// ---------------------------------------------------------------------------------------------------------------------

export interface TipReport {
  /** target column id */
  target: string;
  /** distance (client px) from the arrow tip to the border of the referenced cell */
  distToTarget: number;
  /** smallest distance from the tip to any OTHER cell of the page */
  distToOther: number;
  /** the tip lies strictly inside the extent of the referenced cell along the border it touches */
  inside: boolean;
  tip: Pt;
}

/**
 * For every FK branch drawn on the canvas (or only `edgeId`'s): the arrowhead tip and how it relates to the REFERENCED cell
 * (`data-fk-target`) and to every other cell. The tip of an arrow polygon is the vertex nearest to the target rect.
 */
export async function fkTips(page: Page, opts: { edgeId?: string } = {}): Promise<Array<TipReport & { source: string; edge: string }>> {
  return page.evaluate((edgeId) => {
    const canvas = document.querySelector('.sc-canvas')!;
    const dist = (p: { x: number; y: number }, r: DOMRect): number => {
      const dx = Math.max(r.left - p.x, 0, p.x - r.right);
      const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
      return Math.hypot(dx, dy);
    };
    const cells = new Map<string, DOMRect>();
    canvas.querySelectorAll<SVGGElement>('[data-node-id] [data-column-id]').forEach((g) => {
      const r = g.querySelector('rect,polygon')!.getBoundingClientRect();
      cells.set(g.getAttribute('data-column-id')!, r);
    });
    const out: Array<TipReport & { source: string; edge: string }> = [];
    canvas.querySelectorAll<SVGGElement>('[data-edge-id]').forEach((eg) => {
      const eid = eg.getAttribute('data-edge-id')!;
      if (edgeId && eid !== edgeId) return;
      eg.querySelectorAll<SVGGElement>('[data-fk-branch]').forEach((br) => {
        const target = br.getAttribute('data-fk-target')!;
        const poly = br.querySelector<SVGPolygonElement>('polygon')!;
        const ctm = poly.getScreenCTM()!;
        const pts = Array.from({ length: poly.points.numberOfItems }, (_, i) => {
          const p = poly.points.getItem(i);
          return { x: p.x * ctm.a + p.y * ctm.c + ctm.e, y: p.x * ctm.b + p.y * ctm.d + ctm.f };
        });
        const tr = cells.get(target)!;
        let tip = pts[0]!;
        for (const p of pts) if (dist(p, tr) < dist(tip, tr)) tip = p;
        const dT = dist(tip, tr);
        let dO = Infinity;
        cells.forEach((r, id) => {
          if (id === target) return;
          dO = Math.min(dO, dist(tip, r));
        });
        // which border does it touch; is it inside that border's extent
        const onVert = Math.abs(tip.y - tr.top) < 3 || Math.abs(tip.y - tr.bottom) < 3;
        const inside = onVert ? tip.x > tr.left + 1 && tip.x < tr.right - 1 : tip.y > tr.top + 1 && tip.y < tr.bottom - 1;
        out.push({ target, distToTarget: dT, distToOther: dO, inside, tip, source: br.getAttribute('data-fk-branch')!, edge: eid });
      });
    });
    return out;
  }, opts.edgeId ?? null);
}

/** Every drawn FK arrow tip touches ITS referenced cell and lies inside that cell's extent. */
export async function expectTipsOnTargets(page: Page, min = 1): Promise<void> {
  const tips = await fkTips(page);
  expect(tips.length).toBeGreaterThanOrEqual(min);
  for (const t of tips) {
    expect(t.distToTarget, `tip of branch ${t.source} -> ${t.target} touches the referenced cell`).toBeLessThan(2);
    expect(t.inside, `tip of ${t.source} -> ${t.target} lies inside the referenced cell's extent`).toBe(true);
  }
}

/** The cell (column) rect in client px. */
export async function cellRect(page: Page, columnId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate((id) => {
    const g = document.querySelector(`.sc-canvas [data-node-id] [data-column-id="${id}"]`)!;
    const r = g.querySelector('rect,polygon')!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, columnId);
}

export const cellLocator = (page: Page, columnId: string): Locator => sheet(page).locator(`[data-node-id] [data-column-id="${columnId}"]`);

/** Painted bounding box (client px) of everything below `.sc-canvas` svg's node layer. */
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
export function writeText(path: string, text: string): void {
  writeFileSync(path, text);
}

/** Which Chen diagram nodes (by data-node-id) contain a text; returns ids in DOM order. */
export async function nodeIdsWithText(page: Page, text: string): Promise<string[]> {
  return sheet(page)
    .locator('[data-node-id]')
    .filter({ hasText: text })
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')!));
}

// ---------------------------------------------------------------------------------------------------------------------
// exported-SVG inspection (pure computation on the DOWNLOADED text; DOMParser runs inside a blank page)
// ---------------------------------------------------------------------------------------------------------------------

export interface SvgChenFacts {
  viewBox: [number, number, number, number];
  /** nested rect pairs (outer contains inner with a 2..8 px gap) */
  doubleRects: number;
  singleRects: number;
  /** nested diamond pairs */
  doubleDiamonds: number;
  singleDiamonds: number;
  /** pairs of parallel 2-point polylines 2..8 px apart */
  doubleLines: number;
  underlines: Array<{ text: string; dashed: boolean }>;
  textsWithoutUnderline: string[];
}

export async function analyseChenSvg(page: Page, svgText: string): Promise<SvgChenFacts> {
  return page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG does not parse');
    const svg = doc.documentElement;
    const vb = (svg.getAttribute('viewBox') ?? '').split(/[ ,]+/).map(Number) as [number, number, number, number];
    const num = (e: Element, a: string): number => Number(e.getAttribute(a));
    const rects = Array.from(svg.querySelectorAll('rect')).filter((r) => r.getAttribute('stroke') && r.getAttribute('stroke') !== 'none' && r.getAttribute('fill') !== 'none' || (r.getAttribute('stroke') && r.getAttribute('fill') === 'none'));
    const boxes = rects.map((r) => ({ x: num(r, 'x'), y: num(r, 'y'), w: num(r, 'width'), h: num(r, 'height') })).filter((b) => b.w > 0 && b.h > 0 && b.w < vb[2] - 1);
    let doubleRects = 0;
    const innerUsed = new Set<number>();
    boxes.forEach((o, i) =>
      boxes.forEach((n, j) => {
        if (i === j) return;
        const gx = n.x - o.x;
        const gy = n.y - o.y;
        if (gx >= 2 && gx <= 8 && gy >= 2 && gy <= 8 && Math.abs(o.w - n.w - 2 * gx) < 1 && Math.abs(o.h - n.h - 2 * gy) < 1) {
          doubleRects++;
          innerUsed.add(j);
          innerUsed.add(i);
        }
      }),
    );
    const singleRects = boxes.length - innerUsed.size;
    const polys = Array.from(svg.querySelectorAll('polygon')).map((p) =>
      (p.getAttribute('points') ?? '').trim().split(/\s+/).map((q) => q.split(',').map(Number) as [number, number]),
    );
    const diamonds = polys.filter((pts) => pts.length === 4).map((pts) => {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });
    let doubleDiamonds = 0;
    const dUsed = new Set<number>();
    diamonds.forEach((o, i) =>
      diamonds.forEach((n, j) => {
        if (i !== j && o.w > n.w + 2 && o.h > n.h + 2 && Math.abs(n.x + n.w / 2 - (o.x + o.w / 2)) < 1 && Math.abs(n.y + n.h / 2 - (o.y + o.h / 2)) < 1) {
          doubleDiamonds++;
          dUsed.add(i);
          dUsed.add(j);
        }
      }),
    );
    const singleDiamonds = diamonds.length - dUsed.size;
    const lines = Array.from(svg.querySelectorAll('polyline'))
      .map((p) => (p.getAttribute('points') ?? '').trim().split(/\s+/).map((q) => q.split(',').map(Number) as [number, number]))
      .filter((pts) => pts.length === 2);
    let doubleLines = 0;
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const [a1, a2] = lines[i]!;
        const [b1, b2] = lines[j]!;
        const ax = a2[0] - a1[0];
        const ay = a2[1] - a1[1];
        const len = Math.hypot(ax, ay);
        if (len < 5) continue;
        const cross = Math.abs((b2[0] - b1[0]) * ay - (b2[1] - b1[1]) * ax) / (len * Math.hypot(b2[0] - b1[0], b2[1] - b1[1]));
        const d = Math.abs((b1[0] - a1[0]) * ay - (b1[1] - a1[1]) * ax) / len;
        // a real double line = two rails of the SAME length, side by side (aligned end points), 2..8 px apart
        const lenB = Math.hypot(b2[0] - b1[0], b2[1] - b1[1]);
        const along = (q: [number, number]): number => ((q[0] - a1[0]) * ax + (q[1] - a1[1]) * ay) / len;
        const aligned = Math.abs(len - lenB) < 9 && ((Math.abs(along(b1)) < 9 && Math.abs(along(b2) - len) < 9) || (Math.abs(along(b1) - len) < 9 && Math.abs(along(b2)) < 9));
        if (cross < 0.02 && d >= 2 && d <= 8 && aligned) doubleLines++;
      }
    // underlines: horizontal <line> directly beneath a <text>
    const texts = Array.from(svg.querySelectorAll('text'));
    const lns = Array.from(svg.querySelectorAll('line')).filter((l) => num(l, 'y1') === num(l, 'y2'));
    const underlines: Array<{ text: string; dashed: boolean }> = [];
    const plain: string[] = [];
    for (const t of texts) {
      const ty = num(t, 'y');
      const tx = num(t, 'x');
      const hit = lns.find((l) => {
        const y = num(l, 'y1');
        const x1 = Math.min(num(l, 'x1'), num(l, 'x2'));
        const x2 = Math.max(num(l, 'x1'), num(l, 'x2'));
        return y > ty && y - ty < 8 && tx >= x1 - 1 && tx <= x2 + 1;
      });
      if (hit) underlines.push({ text: t.textContent ?? '', dashed: !!hit.getAttribute('stroke-dasharray') });
      else plain.push(t.textContent ?? '');
    }
    return { viewBox: vb, doubleRects, singleRects, doubleDiamonds, singleDiamonds, doubleLines, underlines, textsWithoutUnderline: plain };
  }, svgText);
}

// ---------------------------------------------------------------------------------------------------------------------
// downloaded-file inspection: SVG painted box, PNG pixels, PDF structure
// ---------------------------------------------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Loads the SVG text into a blank page and measures its painted union (stroke included) against its viewBox. */
export async function svgPaintedBox(page: Page, svgText: string): Promise<{ parsed: boolean; viewBox: Rect; painted: Rect; texts: string[]; width: number; height: number }> {
  const scratch = await page.context().newPage();
  try {
    await scratch.setContent(`<!doctype html><html><body style="margin:0">${svgText.replace(/^<\?xml[^>]*\?>/, '')}</body></html>`);
    return await scratch.evaluate(() => {
      const svg = document.querySelector('svg') as SVGSVGElement | null;
      if (!svg) return { parsed: false, viewBox: { x: 0, y: 0, w: 0, h: 0 }, painted: { x: 0, y: 0, w: 0, h: 0 }, texts: [], width: 0, height: 0 };
      const vb = svg.viewBox.baseVal;
      const inv = svg.getScreenCTM()!.inverse();
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      const els = svg.querySelectorAll<SVGGraphicsElement>('text,rect,polygon,polyline,line,path,ellipse,circle');
      els.forEach((el) => {
        const b = el.getBBox();
        if (b.width >= vb.width * 0.99 && b.height >= vb.height * 0.99) return; // background plate
        if (b.width === 0 && b.height === 0) return;
        const m = inv.multiply(el.getScreenCTM()!);
        const sw = Number(el.getAttribute('stroke-width') ?? (el.getAttribute('stroke') ? 1 : 0)) / 2;
        for (const [px, py] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]] as const) {
          const qx = m.a * px + m.c * py + m.e;
          const qy = m.b * px + m.d * py + m.f;
          x1 = Math.min(x1, qx - sw);
          y1 = Math.min(y1, qy - sw);
          x2 = Math.max(x2, qx + sw);
          y2 = Math.max(y2, qy + sw);
        }
      });
      const r = svg.getBoundingClientRect();
      return {
        parsed: true,
        viewBox: { x: vb.x, y: vb.y, w: vb.width, h: vb.height },
        painted: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
        texts: Array.from(svg.querySelectorAll('text')).map((t) => t.textContent ?? ''),
        width: r.width,
        height: r.height,
      };
    });
  } finally {
    await scratch.close();
  }
}

export interface PngInfo {
  width: number;
  height: number;
  /** non-white pixels in the outermost 1px frame */
  edgeNonWhite: number;
  /** pixels that are not (near) white / transparent */
  inkPixels: number;
  inkBox: Rect;
  /** pixels with alpha < 255 */
  transparentPixels: number;
  /** sampled RGBA of the top-left pixel */
  corner: [number, number, number, number];
}

export async function decodePng(page: Page, bytes: Buffer): Promise<PngInfo> {
  expect(bytes.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  const scratch = await page.context().newPage();
  try {
    await scratch.setContent('<!doctype html><body></body>');
    return await scratch.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let edge = 0;
      let ink = 0;
      let tr = 0;
      let x1 = c.width;
      let y1 = c.height;
      let x2 = -1;
      let y2 = -1;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const a = d[i + 3]!;
          if (a < 255) tr++;
          const white = a === 0 || (d[i]! >= 250 && d[i + 1]! >= 250 && d[i + 2]! >= 250);
          if (!white) {
            ink++;
            if (x === 0 || y === 0 || x === c.width - 1 || y === c.height - 1) edge++;
            x1 = Math.min(x1, x);
            y1 = Math.min(y1, y);
            x2 = Math.max(x2, x);
            y2 = Math.max(y2, y);
          }
        }
      return { width: c.width, height: c.height, edgeNonWhite: edge, inkPixels: ink, inkBox: { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }, transparentPixels: tr, corner: [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number] };
    }, bytes.toString('base64'));
  } finally {
    await scratch.close();
  }
}

export interface PdfInfo {
  header: string;
  mediaBox: number[];
  pages: number;
  fonts: string[];
  imageCount: number;
  /** every string shown by Tj / TJ operators of every (inflated) content stream, one entry per operator */
  texts: string[];
  /** all of `texts` joined, for `toContain` */
  text: string;
}

export function inspectPdf(bytes: Buffer): PdfInfo {
  const latin = bytes.toString('latin1');
  const mb = /\/MediaBox\s*\[([^\]]+)\]/.exec(latin);
  const mediaBox = mb ? mb[1]!.trim().split(/\s+/).map(Number) : [];
  const fonts = [...latin.matchAll(/\/BaseFont\s*\/([^\s/>\]]+)/g)].map((m) => m[1]!);
  const imageCount = [...latin.matchAll(/\/Subtype\s*\/Image/g)].length;
  const pages = [...latin.matchAll(/\/Type\s*\/Page[^s]/g)].length;
  const texts: string[] = [];
  let pos = 0;
  for (;;) {
    const s = latin.indexOf('stream', pos);
    if (s < 0) break;
    const e = latin.indexOf('endstream', s + 6);
    if (e < 0) break;
    let start = s + 6;
    if (latin[start] === '\r') start++;
    if (latin[start] === '\n') start++;
    const raw = bytes.subarray(start, e);
    pos = e + 9;
    let content = '';
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1');
    }
    for (const m of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) texts.push(unescapePdf(m[1]!));
    for (const m of content.matchAll(/\[((?:\\.|[^\]\\])*)\]\s*TJ/g)) {
      const parts = [...m[1]!.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((q) => unescapePdf(q[1]!));
      texts.push(parts.join(''));
    }
  }
  return { header: latin.slice(0, 5), mediaBox, pages, fonts, imageCount, texts, text: texts.join('\n') };
}
const unescapePdf = (s: string): string => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c));

// ---------------------------------------------------------------------------------------------------------------------
// layout checks on the rendered canvas
// ---------------------------------------------------------------------------------------------------------------------

export interface NodeBox extends Rect {
  id: string;
  text: string;
}
export async function nodeBoxes(page: Page): Promise<NodeBox[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.sc-canvas [data-node-id]')).map((g) => {
      const r = g.getBoundingClientRect();
      return { id: g.getAttribute('data-node-id')!, text: (g.textContent ?? '').trim(), x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
}
export async function canvasBox(page: Page): Promise<Rect> {
  const b = (await sheet(page).boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
export function overlaps(boxes: NodeBox[], tolerance = 1): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > tolerance && iy > tolerance) out.push([a.text, b.text]);
    }
  return out;
}
export const insideCanvas = (b: Rect, c: Rect): boolean => b.x >= c.x - 0.5 && b.y >= c.y - 0.5 && b.x + b.w <= c.x + c.w + 0.5 && b.y + b.h <= c.y + c.h + 0.5;

/** What must survive save -> reload / import: semantics, presentation geometry, routes, conversion record. */
export function comparable(p: PProject): unknown {
  const diagrams = Object.fromEntries(
    Object.entries(p.diagrams).map(([id, d]) => {
      const { viewport: _v, ...rest } = d as PDiagram & { viewport?: unknown };
      return [id, rest];
    }),
  );
  return { name: p.name, models: p.models, diagrams, diagramOrder: p.diagramOrder, conversions: p.conversions };
}
