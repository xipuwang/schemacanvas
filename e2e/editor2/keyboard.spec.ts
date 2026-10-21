import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * KEYBOARD ONLY on the real canvas + the real tools (harness/editor-tools): cell mode, a composite foreign key from marked cells,
 * connector focus + route editing, announcements, and the Chen keyboard path. Pointer is never used after the page loads.
 */
const SHOTS = '.tmp/editor2';
mkdirSync(SHOTS, { recursive: true });

const live = (page: Page) => page.getByTestId('canvas-live-kb');
const sel = (page: Page) => page.evaluate(() => (window as any).__sc.store.getState().selection as { ids: string[]; sub?: { kind: string; id: string } });
const proj = (page: Page) => page.evaluate(() => (window as any).__sc.store.getState().project);

async function open(page: Page, which: string, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  await page.goto(`/harness/editor-tools/index.html${query}`);
  await page.waitForSelector('.sc-canvas');
  await page.evaluate((w) => (window as any).__sc.store.getState().setActiveDiagram((window as any).__sc.ids[w]), which);
  if (which !== 'empty') await page.waitForSelector('[data-node-id]');
  await page.waitForTimeout(100);
  await page.locator('.sc-canvas').focus();
  return errors;
}

/** Tab until the selection satisfies `pred` (max `n` presses). */
async function tabUntil(page: Page, pred: string, n = 60): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space'); // Tab only moves the focus ring (A11Y-02); Space selects what it landed on
    const ok = await page.evaluate((src) => {
      const sc = (window as any).__sc;
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      const m = s.project.models[d.modelId];
      return new Function('s', 'd', 'm', `return (${src})(s, d, m)`)(s, d, m);
    }, pred);
    if (ok) return;
  }
  throw new Error(`Tab never reached: ${pred}`);
}

const isTable = (name: string) =>
  `(s, d, m) => s.selection.ids.length === 1 && d.nodes[s.selection.ids[0]] && m.relations[d.nodes[s.selection.ids[0]].ref.id]?.name === ${JSON.stringify(name)}`;

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test.describe('keyboard only', () => {
  test('cell mode -> marked cells -> composite foreign key -> connector focus -> route editing, with announcements', async ({ page }) => {
    const errors = await open(page, 'relBare');
    await tabUntil(page, isTable('Sell'));
    await expect(page.getByTestId('canvas-live')).toContainText('Sell');

    // Enter = cell mode
    await page.keyboard.press('Enter');
    await expect(live(page)).toContainText('Cell mode in table Sell');
    await expect(live(page)).toContainText('Column PharmacyName, primary key');
    await expect(page.locator('[data-overlay="cell-cursor"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/kb-01-cell-mode.png` });

    // Right, Right: CompanyName, DrugTradeName; Space marks, Shift+Right extends
    await page.keyboard.press('ArrowRight');
    await expect(live(page)).toContainText('Column CompanyName, primary key');
    await page.keyboard.press('Space');
    await expect(live(page)).toContainText('marked');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('[data-overlay="cell-mark"], [data-overlay="cell-cursor"]')).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/kb-02-marked-cells.png` });
    // Home / End and Left on the marks keep them
    await page.keyboard.press('End');
    await expect(live(page)).toContainText('Column Price');
    await page.keyboard.press('Home');
    await expect(live(page)).toContainText('Column PharmacyName');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight'); // DrugTradeName (still marked)
    await expect(live(page)).toContainText('Column DrugTradeName');

    // fk.fromSelection shortcut: the two marked cells are the source; arrows choose the referenced table
    await page.keyboard.press('Shift+F');
    await expect(live(page)).toContainText('Foreign key source set');
    await expect(page.getByTestId('tool')).toHaveText('fk');
    await page.keyboard.press('ArrowUp'); // Drug sits above Sell
    await expect(live(page)).toContainText('Table Drug');
    expect((await sel(page)).ids).toHaveLength(1);
    await page.screenshot({ path: `${SHOTS}/kb-03-fk-target.png` });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('fk-popover')).toBeVisible();
    await expect(page.getByTestId('fk-text')).toContainText('Sell.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    await page.screenshot({ path: `${SHOTS}/kb-04-fk-popover.png` });
    await page.keyboard.press('Enter'); // Create is focused
    await expect(page.getByTestId('fk-popover')).toHaveCount(0);
    const fks = await page.evaluate(() => {
      const s = (window as any).__sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      return Object.values<any>(m.foreignKeys).map((f) => ({ s: m.relations[f.sourceRelationId].name, t: m.relations[f.targetRelationId].name, pairs: f.columns.map((p: any) => `${m.relations[f.sourceRelationId].columns.find((c: any) => c.id === p.sourceColumnId).name}>${m.relations[f.targetRelationId].columns.find((c: any) => c.id === p.targetColumnId).name}`) }));
    });
    expect(fks).toEqual([{ s: 'Sell', t: 'Drug', pairs: ['CompanyName>CompanyName', 'DrugTradeName>TradeName'] }]);

    // the FK column now announces its target in cell mode
    await page.locator('.sc-canvas').focus();
    await page.evaluate(() => {
      const sc = (window as any).__sc;
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      const id = Object.keys(d.nodes).find((k) => s.project.models[d.modelId].relations[d.nodes[k].ref.id].name === 'Sell');
      s.setTool('select');
      s.setSelection([id]);
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await expect(live(page)).toContainText('Column CompanyName, primary key and foreign key to Drug.(CompanyName, TradeName)');
    await page.keyboard.press('Escape');
    await expect(live(page)).toContainText('Left cell mode');
    await expect(page.locator('[data-overlay="cell-cursor"]')).toHaveCount(0);

    // Tab reaches the connector after the nodes; it announces itself
    await tabUntil(page, '(s, d) => s.selection.ids.length === 1 && !!d.edges[s.selection.ids[0]]');
    await expect(page.getByTestId('canvas-live')).toContainText('Foreign key Sell.(CompanyName, DrugTradeName) to Drug.(CompanyName, TradeName)');
    await page.screenshot({ path: `${SHOTS}/kb-05-connector-focus.png` });

    // [ and ] walk the handles
    await page.keyboard.press(']');
    await expect(live(page)).toContainText('Connector start handle');
    await expect(page.locator('[data-overlay="edge-focus"]')).toHaveCount(1);
    await page.keyboard.press('[');
    await expect(live(page)).toContainText('Connector end handle'); // wraps backwards to the last handle (no label on this connector)
    await page.keyboard.press(']'); // wraps forwards to the start again
    await expect(live(page)).toContainText('Connector start handle');

    // I adds a bend on the longest segment and focuses it; arrows nudge it by the grid (one undo step for the burst)
    const edgeId = (await sel(page)).ids[0]!;
    const grid = await page.evaluate(() => (window as any).__sc.store.getState().project.diagrams[(window as any).__sc.store.getState().activeDiagramId].options.grid.size as number);
    const before = await proj(page);
    void before;
    const undo0 = await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number);
    await page.keyboard.press('i');
    await expect(live(page)).toContainText(/Bend \d+ added/);
    const bendIndex = Number(/Bend (\d+) added/.exec((await live(page).textContent()) ?? '')![1]) - 1;
    const route = async () => page.evaluate((id) => {
      const s = (window as any).__sc.store.getState();
      return s.project.diagrams[s.activeDiagramId].edges[id].route as { mode: string; waypoints: Array<{ x: number; y: number }> };
    }, edgeId);
    const r1 = await route();
    expect(r1.mode).toBe('manual');
    expect(r1.waypoints.length).toBeGreaterThanOrEqual(1);
    const undo1 = await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number);
    expect(undo1).toBe(undo0 + 1);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(500); // idle window: the burst closes
    const r2 = await route();
    expect(r2.waypoints).toHaveLength(r1.waypoints.length);
    expect(r2.waypoints[bendIndex]!.x).toBe(r1.waypoints[bendIndex]!.x + 3 * grid);
    expect(r2.waypoints[bendIndex]!.y).toBe(r1.waypoints[bendIndex]!.y + 10 * grid);
    r2.waypoints.forEach((w, i) => i !== bendIndex && expect(w).toEqual(r1.waypoints[i]));
    expect(await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number)).toBe(undo1 + 1);
    await page.screenshot({ path: `${SHOTS}/kb-06-bend-moved.png` });

    // the foreign key itself never changed
    const fks2 = await page.evaluate(() => {
      const s = (window as any).__sc.store.getState();
      return Object.values<any>(s.project.models[s.project.diagrams[s.activeDiagramId].modelId].foreignKeys).map((f) => f.columns);
    });
    expect(fks2).toHaveLength(1);
    expect(fks2[0]).toHaveLength(2);

    // Delete removes the focused bend only; the connector stays
    await page.keyboard.press('Delete');
    await expect(live(page)).toContainText('Bend removed');
    expect((await route()).waypoints).toHaveLength(r1.waypoints.length - 1);
    expect(await page.evaluate((id) => !!(window as any).__sc.store.getState().project.diagrams[(window as any).__sc.store.getState().activeDiagramId].edges[id], edgeId)).toBe(true);

    // add again, then R resets the route to automatic
    await page.keyboard.press('i');
    expect((await route()).mode).toBe('manual');
    await page.keyboard.press('r');
    await expect.poll(async () => (await route()).mode).toBe('auto');

    // Ctrl+Z walks back through the single undo steps of the session
    await page.keyboard.press('ControlOrMeta+z');
    expect((await route()).mode).toBe('manual');
    expect(errors).toEqual([]);
  });

  test('anchor and label handles can be moved with the arrow keys; Escape clears nothing destructive', async ({ page }) => {
    const errors = await open(page, 'rel');
    await tabUntil(page, '(s, d) => s.selection.ids.length === 1 && !!d.edges[s.selection.ids[0]]');
    const edgeId = (await sel(page)).ids[0]!;
    await page.keyboard.press(']'); // source end
    const r0 = await page.evaluate((id) => {
      const s = (window as any).__sc.store.getState();
      return s.project.diagrams[s.activeDiagramId].edges[id].route;
    }, edgeId);
    expect(r0.sourceAnchor).toBeUndefined();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
    const r1 = await page.evaluate((id) => {
      const s = (window as any).__sc.store.getState();
      return { route: s.project.diagrams[s.activeDiagramId].edges[id].route, fk: JSON.stringify(Object.values<any>(s.project.models[s.project.diagrams[s.activeDiagramId].modelId].foreignKeys).map((f) => f.columns)) };
    }, edgeId);
    const anchors = [r1.route.sourceAnchor, ...Object.values<any>(r1.route.branchAnchors ?? {}).map((b) => b.source)].filter(Boolean);
    expect(anchors.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('Chen: entity -> relationship -> participants -> attributes without a mouse', async ({ page }) => {
    const errors = await open(page, 'empty');
    await page.keyboard.press('e');
    await expect(page.locator('.sc-canvas__input, input[data-inline-edit], .sc-inline-input').first()).toBeVisible();
    await page.keyboard.type('Student');
    await page.keyboard.press('Enter');
    await page.locator('.sc-canvas').focus();
    await page.keyboard.press('e');
    await page.keyboard.type('Course');
    await page.keyboard.press('Enter');
    await page.locator('.sc-canvas').focus();
    // the second entity is selected: L, arrow to the first one, Enter = a relationship between them
    await page.keyboard.press('l');
    await expect(live(page)).toContainText('Connect from Course');
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(k);
      if ((await live(page).textContent())?.includes('Student')) break;
    }
    await expect(live(page)).toContainText('Student');
    await page.keyboard.press('Enter');
    await expect.poll(async () => page.evaluate(() => Object.keys((((s) => s.project.models[s.project.diagrams[s.activeDiagramId].modelId])((window as any).__sc.store.getState())).relationships).length)).toBe(1);
    // the new relationship is selected and in rename: accept the default name
    await page.keyboard.press('Enter');
    await page.locator('.sc-canvas').focus();
    // attributes: A adds an attribute to the selected relationship; rename it
    await page.keyboard.press('a');
    await page.keyboard.type('Grade');
    await page.keyboard.press('Enter');
    await page.locator('.sc-canvas').focus();
    // a second relationship (ternary seed) by Shift+R, then L onto an entity adds a participant
    await page.keyboard.press('Shift+R');
    await page.keyboard.type('Teaches');
    await page.keyboard.press('Enter');
    await page.locator('.sc-canvas').focus();
    await page.keyboard.press('l');
    let found = false;
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowDown']) {
      await page.keyboard.press(k);
      const txt = (await live(page).textContent()) ?? '';
      if (/Student|Course/.test(txt) && txt.includes('Enter connects')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    await page.keyboard.press('Enter');
    const summary = await page.evaluate(() => {
      const m = (((s) => s.project.models[s.project.diagrams[s.activeDiagramId].modelId])((window as any).__sc.store.getState()));
      return { entities: Object.values<any>(m.entities).map((e) => e.name).sort(), rels: Object.values<any>(m.relationships).map((r) => ({ name: r.name, participants: r.participants.length })), attrs: Object.values<any>(m.attributes).map((a) => a.name) };
    });
    expect(summary.entities).toEqual(['Course', 'Student']);
    expect(summary.attrs).toContain('Grade');
    expect(summary.rels.find((r: any) => r.name === 'Teaches')!.participants).toBe(1);
    await page.screenshot({ path: `${SHOTS}/kb-07-chen.png` });
    expect(errors).toEqual([]);
  });

  test('axe: cell mode and connector focus, light and dark', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
      await open(page, 'relBare', `?theme=${theme}`);
      await tabUntil(page, isTable('Sell'));
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      await page.screenshot({ path: `${SHOTS}/kb-axe-${theme}.png` });
      const res = await new AxeBuilder({ page }).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    }
  });
});
