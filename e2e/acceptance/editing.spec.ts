/**
 * The product specification section 11 "Visual Editing" and "Horizontal Schemas", through real pointer / keyboard / HTML5 drag events only.
 *
 *   E2E_PORT=5232 npx playwright test e2e/acceptance/editing.spec.ts --output=.tmp/acceptance/results
 */
import type { Page } from '@playwright/test';
import {
  cellLocator,
  cellRect,
  centre,
  clickCentre,
  col,
  colNames,
  convertViaDialog,
  dragMouse,
  dropPart,
  expect,
  expectTipsOnTargets,
  fkStrings,
  fkTips,
  library,
  modelOf,
  nodeBoxes,
  nodeByText,
  nodeIdOf,
  nodeIdOfRelation,
  openApp,
  overlaps,
  openExample,
  pkNames,
  properties,
  relation,
  relationalDiagram,
  renameInline,
  saveProject,
  settle,
  sheet,
  shot,
  switchSheet,
  test,
  type PFile,
  type PProject,
} from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const undo = (page: Page) => page.locator('[data-command="edit.undo"]');
const redo = (page: Page) => page.locator('[data-command="edit.redo"]');
const chenCount = (page: Page, shape: 'entity' | 'relationship' | 'attribute') => sheet(page).locator(`[data-chen-shape="${shape}"]`);

/** Drop a library part so that its pointer lands on the centre of `onto` (needed for attributes: they need an owner). */
async function dropOnto(page: Page, partId: string, onto: import('@playwright/test').Locator): Promise<void> {
  const c = await centre(onto);
  const sb = (await sheet(page).boundingBox())!;
  await dropPart(page, partId, { x: c.x - sb.x, y: c.y - sb.y });
}

async function nameInline(page: Page, name: string): Promise<void> {
  await expect(page.locator('.sc-inline-input')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.sc-inline-input')).toHaveCount(0);
}

// =====================================================================================================================
test.describe('Visual editing (Chen)', () => {
  test('dragging every library part onto the sheet draws the correct notation', async ({ app: page }) => {
    await openApp(page);
    const cv = sheet(page);
    // strong entity + weak entity
    await dropPart(page, 'entity', { x: 130, y: 140 });
    await nameInline(page, 'Strong');
    await dropPart(page, 'weak-entity', { x: 130, y: 560 });
    await nameInline(page, 'Weak');
    // relationship + identifying relationship (diamonds)
    await dropPart(page, 'relationship', { x: 560, y: 150 });
    await nameInline(page, 'Rel');
    await dropPart(page, 'identifying-relationship', { x: 560, y: 560 });
    await nameInline(page, 'IdRel');

    const strong = cv.locator('[data-chen-shape="entity"]').filter({ hasText: 'Strong' });
    const weak = cv.locator('[data-chen-shape="entity"]').filter({ hasText: 'Weak' });
    await expect(strong).toHaveAttribute('data-weak', 'false');
    await expect(strong.locator('rect')).toHaveCount(1); // single rectangle
    await expect(weak).toHaveAttribute('data-weak', 'true');
    await expect(weak.locator('rect')).toHaveCount(2); // double rectangle
    const rel = cv.locator('[data-chen-shape="relationship"]').filter({ hasText: /^Rel$/ });
    const idRel = cv.locator('[data-chen-shape="relationship"]').filter({ hasText: 'IdRel' });
    await expect(rel.locator('polygon')).toHaveCount(1); // single diamond
    await expect(idRel.locator('polygon')).toHaveCount(2); // double diamond
    await expect(idRel).toHaveAttribute('data-identifying', 'true');
    await expect(rel).toHaveAttribute('data-identifying', 'false');

    // attributes need an owner: drop them onto the strong entity, one flavour after the other
    const flavours: Array<{ part: string; name: string }> = [
      { part: 'attribute', name: 'simple' },
      { part: 'key-attribute', name: 'keyed' },
      { part: 'partial-key', name: 'partial' },
      { part: 'multivalued', name: 'multi' },
      { part: 'derived', name: 'derivd' },
    ];
    for (const f of flavours) {
      await dropOnto(page, f.part, strong);
      await nameInline(page, f.name);
    }
    const attr = (name: string) => cv.locator('[data-chen-shape="attribute"]').filter({ hasText: new RegExp(`^${name}$`) });
    await expect(attr('simple')).toHaveAttribute('data-key', 'none');
    await expect(attr('simple').locator('ellipse')).toHaveCount(1);
    await expect(attr('simple').locator('line')).toHaveCount(0);
    await expect(attr('keyed')).toHaveAttribute('data-key', 'solid');
    await expect(attr('keyed').locator('line:not([stroke-dasharray])')).toHaveCount(1);
    await expect(attr('partial')).toHaveAttribute('data-key', 'dashed');
    await expect(attr('partial').locator('line[stroke-dasharray]')).toHaveCount(1);
    await expect(attr('multi')).toHaveAttribute('data-multivalued', 'true');
    await expect(attr('multi').locator('ellipse')).toHaveCount(2); // double ellipse
    await expect(attr('derivd')).toHaveAttribute('data-derived', 'true');
    await expect(attr('derivd').locator('ellipse[stroke-dasharray]')).toHaveCount(1); // dashed ellipse

    // composite: an attribute with sub-attributes (hierarchy), linked by lines
    const before = await cv.locator('[data-chen-shape="attribute"]').count();
    await dropOnto(page, 'composite', strong);
    if (await page.locator('.sc-inline-input').count()) await page.keyboard.press('Escape');
    expect(await cv.locator('[data-chen-shape="attribute"]').count(), 'composite adds the composite attribute and its sub-attributes').toBeGreaterThanOrEqual(before + 3);

    // every attribute is attached by a line to its owner (no floating attributes)
    const attrLinks = await cv.locator('[data-chen-line]').count();
    expect(attrLinks).toBeGreaterThanOrEqual(before + 3);
    await shot(page, 'edit-01-library-notation');
    const boxes = await nodeBoxes(page);
    expect(overlaps(boxes), 'dropped parts do not overlap each other').toEqual([]);
  });

  test('connect, edit cardinality / participation / roles, recursive relationship, n-ary participant', async ({ app: page }) => {
    await openApp(page);
    const cv = sheet(page);
    const props = properties(page);
    await dropPart(page, 'entity', { x: 110, y: 330 });
    await nameInline(page, 'Employee');
    await dropPart(page, 'entity', { x: 660, y: 330 });
    await nameInline(page, 'Department');

    await page.getByRole('button', { name: 'Connect' }).click();
    await dragMouse(page, await centre(nodeByText(page, 'Employee')), await centre(nodeByText(page, 'Department')));
    await nameInline(page, 'WorksFor');
    await page.keyboard.press('Escape');
    const worksFor = cv.locator('[data-chen-shape="relationship"]').filter({ hasText: 'WorksFor' });
    await expect(worksFor).toHaveCount(1);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(2); // one participation line per entity

    // edit afterwards: M:N -> Employee many/total, Department one/partial, role text
    await worksFor.click();
    const row = async (entity: string): Promise<number> => {
      for (const n of [1, 2]) {
        const sel = props.getByRole('combobox', { name: `Entity, participant ${n}` });
        if ((await sel.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.textContent)) === entity) return n;
      }
      throw new Error('no row');
    };
    const emp = await row('Employee');
    const dep = await row('Department');
    await expect(props.getByText('Many to many')).toBeVisible();
    await props.getByRole('combobox', { name: `Cardinality, participant ${dep}` }).selectOption({ label: 'One (1)' });
    await expect(props.getByText('Many to one').or(props.getByText('One to many'))).toBeVisible();
    await props.getByRole('combobox', { name: `Participation, participant ${emp}` }).selectOption({ label: 'Total' });
    await expect(cv.locator('[data-chen-line][data-double="true"]')).toHaveCount(1);
    await props.getByRole('combobox', { name: `Participation, participant ${emp}` }).selectOption({ label: 'Partial' });
    await expect(cv.locator('[data-chen-line][data-double="true"]')).toHaveCount(0);
    await props.getByRole('combobox', { name: `Participation, participant ${emp}` }).selectOption({ label: 'Total' });
    await props.getByRole('textbox', { name: `Role, participant ${emp}` }).fill('worker');
    await page.keyboard.press('Tab');
    await expect(cv.locator('text', { hasText: 'worker' })).toBeVisible();
    // letter cardinalities appear on the canvas next to the participating entities
    await expect(cv.locator('text', { hasText: /^1$/ })).toHaveCount(1);
    await expect(cv.locator('text', { hasText: /^[NM]$/ })).toHaveCount(1);
    await shot(page, 'edit-02-connected');

    // recursive relationship: Connect tool from the entity back onto itself
    await page.getByRole('button', { name: 'Connect' }).click();
    const e = (await nodeByText(page, 'Employee').boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 - 60, e.y + e.height + 70, { steps: 8 });
    // the canvas coalesces pointermoves to one per animation frame; a synthetic drag can finish both legs inside a single frame (WebKit),
    // so the excursion outside the entity would never be observed. Let a frame render at the far point, as a human hand always does.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.mouse.move(e.x + e.width / 2 + 5, e.y + e.height / 2 + 5, { steps: 8 });
    await page.mouse.up();
    const rec = page.locator('.sc-inline-input');
    if (await rec.count()) await nameInline(page, 'Manages');
    await page.keyboard.press('Escape');
    await expect(cv.locator('[data-chen-line][data-recursive="true"]').first()).toBeAttached();
    await expect(cv.locator('[data-chen-shape="relationship"]').filter({ hasText: 'Manages' })).toHaveCount(1);
    await shot(page, 'edit-03-recursive');

    // n-ary: add a third participant to WorksFor in the panel
    await worksFor.click();
    await props.getByRole('button', { name: 'Add participant' }).click();
    await expect(props.getByRole('combobox', { name: 'Entity, participant 3' })).toBeVisible();
  });

  test('relationships keep their semantic connections when objects move', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity');
    await page.keyboard.press('Shift+1');
    await settle(page, 500);
    const before = (await saveProject(page)).file.project;
    const diagram = Object.values(before.diagrams).find((d) => d.type === 'chen')!;
    const er = before.models[diagram.modelId]!;
    const makes = Object.values(er.relationships!).find((r) => r.name === 'Makes')!;

    // drag the owner entity, the diamond and an attribute somewhere else
    const cv = sheet(page);
    const targets = ['Company', 'Makes', 'TradeName'];
    const startPos = Object.fromEntries(await Promise.all(targets.map(async (t) => [t, await centre(nodeByText(page, new RegExp(`^${t}`)))] as const)));
    const cb = (await cv.boundingBox())!;
    const dest: Record<string, { x: number; y: number }> = {
      Company: { x: cb.x + 140, y: cb.y + cb.height - 120 },
      Makes: { x: cb.x + cb.width / 2 + 40, y: cb.y + cb.height - 200 },
      TradeName: { x: cb.x + cb.width - 150, y: cb.y + 90 },
    };
    for (const t of targets) await dragMouse(page, startPos[t]!, dest[t]!, 14);
    await settle(page, 300);

    const after = (await saveProject(page)).file.project;
    const d2 = Object.values(after.diagrams).find((d) => d.type === 'chen')!;
    // semantics identical (ids, names, cardinalities, participation, identifying, keys)
    expect(after.models[d2.modelId]).toEqual(before.models[diagram.modelId]);
    expect(Object.keys(d2.edges).sort()).toEqual(Object.keys(diagram.edges).sort());
    for (const [id, e] of Object.entries(d2.edges)) expect(e.ref).toEqual(diagram.edges[id]!.ref);
    // the three nodes really moved; the other nodes did not
    const moved = Object.values(d2.nodes).filter((n) => {
      const o = diagram.nodes[n.id]!;
      return o.x !== n.x || o.y !== n.y;
    });
    expect(moved.length).toBe(3);
    // and the model still says Makes is identifying with Company (one, partial) and Drug (many, total)
    const m2 = Object.values(after.models[d2.modelId]!.relationships!).find((r) => r.name === 'Makes')!;
    expect(m2.participants).toEqual(makes.participants);
    expect(m2.identifying).toBe(true);

    // rendered: every Chen line still ends on the border of two different shapes (no dangling connector)
    const dangling = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.sc-canvas [data-node-id]')].map((g) => g.getBoundingClientRect());
      const near = (x: number, y: number): number => boxes.filter((b) => x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 4 && y <= b.bottom + 4).length;
      const out: string[] = [];
      document.querySelectorAll<SVGGElement>('.sc-canvas [data-chen-line]').forEach((g, i) => {
        const pl = g.querySelector('polyline')!;
        const m = pl.getScreenCTM()!;
        const n = pl.points.numberOfItems;
        for (const idx of [0, n - 1]) {
          const p = pl.points.getItem(idx);
          const x = p.x * m.a + p.y * m.c + m.e;
          const y = p.x * m.b + p.y * m.d + m.f;
          if (near(x, y) < 1) out.push(`line ${i} end ${idx}`);
        }
      });
      return out;
    });
    expect(dangling).toEqual([]);
    await shot(page, 'edit-04-moved-chen');
  });

  test('undo / redo of create, rename, move, connect, delete (toolbar buttons and Ctrl+Z)', async ({ app: page }) => {
    await openApp(page);
    const cv = sheet(page);
    await expect(undo(page)).toBeDisabled();

    // create
    await dropPart(page, 'entity', { x: 150, y: 300 });
    await nameInline(page, 'First');
    await dropPart(page, 'entity', { x: 650, y: 300 });
    await nameInline(page, 'Second');
    await expect(chenCount(page, 'entity')).toHaveCount(2);
    await undo(page).click(); // the rename of Second
    await expect(nodeByText(page, 'Entity2').or(nodeByText(page, 'Entity1'))).toHaveCount(1);
    await redo(page).click();
    await expect(nodeByText(page, 'Second')).toHaveCount(1);
    await undo(page).click();
    await undo(page).click(); // create Second
    await expect(chenCount(page, 'entity')).toHaveCount(1);
    await redo(page).click();
    await redo(page).click();
    await expect(chenCount(page, 'entity')).toHaveCount(2);
    await expect(nodeByText(page, 'Second')).toHaveCount(1);

    // rename (inline, one undo step)
    await renameInline(page, nodeByText(page, 'First'), 'Primary');
    await expect(nodeByText(page, 'Primary')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(nodeByText(page, 'First')).toHaveCount(1);
    await expect(nodeByText(page, 'Primary')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(nodeByText(page, 'Primary')).toHaveCount(1);

    // move (one drag = ONE undo step)
    const b0 = (await nodeByText(page, 'Primary').boundingBox())!;
    await dragMouse(page, await centre(nodeByText(page, 'Primary')), { x: b0.x + b0.width / 2 + 120, y: b0.y + b0.height / 2 + 100 }, 10);
    const b1 = (await nodeByText(page, 'Primary').boundingBox())!;
    expect(b1.x).toBeGreaterThan(b0.x + 80);
    await undo(page).click();
    const b2 = (await nodeByText(page, 'Primary').boundingBox())!;
    expect(Math.abs(b2.x - b0.x) + Math.abs(b2.y - b0.y)).toBeLessThan(1);
    await redo(page).click();
    const b3 = (await nodeByText(page, 'Primary').boundingBox())!;
    expect(Math.abs(b3.x - b1.x) + Math.abs(b3.y - b1.y)).toBeLessThan(1);

    // connect: creating the relationship (with its two participation lines) is undone in one step, the rename is a second one
    await page.getByRole('button', { name: 'Connect' }).click();
    await dragMouse(page, await centre(nodeByText(page, 'Primary')), await centre(nodeByText(page, 'Second')));
    await nameInline(page, 'Links');
    await page.keyboard.press('Escape');
    await expect(chenCount(page, 'relationship')).toHaveCount(1);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(2);
    await undo(page).click(); // rename
    await undo(page).click(); // connect
    await expect(chenCount(page, 'relationship')).toHaveCount(0);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(0);
    await redo(page).click();
    await redo(page).click();
    await expect(chenCount(page, 'relationship')).toHaveCount(1);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(2);

    // delete (semantic delete removes the shape AND its lines; one undo step brings everything back)
    await nodeByText(page, 'Links').click();
    await page.keyboard.press('Delete');
    await expect(chenCount(page, 'relationship')).toHaveCount(0);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(0);
    await undo(page).click();
    await expect(chenCount(page, 'relationship')).toHaveCount(1);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(2);
    // delete an entity: its relationship loses a participant (or goes away) and everything is restored by undo
    await nodeByText(page, 'Second').click();
    await page.keyboard.press('Delete');
    await expect(nodeByText(page, 'Second')).toHaveCount(0);
    await undo(page).click();
    await expect(nodeByText(page, 'Second')).toHaveCount(1);
    await expect(cv.locator('[data-chen-line]')).toHaveCount(2);
    const { file } = await saveProject(page);
    const model = Object.values(file.project.models)[0]!;
    expect(Object.values(model.entities!).map((e) => e.name).sort()).toEqual(['Primary', 'Second']);
    expect(Object.values(model.relationships!)[0]!.participants).toHaveLength(2);
  });

  test('undo / redo of the conversion: one step creates and removes the generated schema', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Recursive 1:N');
    await page.getByRole('tab', { name: 'Relational schema' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveCount(0);
    const before = (await saveProject(page)).file.project;
    await switchSheet(page, 'ER diagram');
    await convertViaDialog(page);
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveAttribute('aria-selected', 'true');
    const converted = (await saveProject(page)).file.project;
    expect(Object.keys(converted.conversions).length).toBe(Object.keys(before.conversions).length + 1);
    await undo(page).click();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveCount(0);
    const undone = (await saveProject(page)).file.project;
    expect(Object.keys(undone.conversions)).toEqual(Object.keys(before.conversions));
    expect(undone.diagramOrder.length).toBe(before.diagramOrder.length);
    await redo(page).click();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
    const redone = (await saveProject(page)).file.project;
    expect(Object.keys(redone.conversions).length).toBe(Object.keys(converted.conversions).length);
    expect(fkStrings(Object.values(redone.models).filter((m) => m.kind === 'relational')[0]!)).toEqual(['Employee.(ManagerEid) -> Employee.(Eid)']);
  });

  test('D1/UX-1/SA-11: a part placed by click-to-arm placement keeps the inline rename editor open, and typing names it', async ({ app: page }) => {
    // Library button (arm) + click on the sheet creates the entity; the browser's mousedown focus move must not blur the
    // rename input, so typing a name right away renames the entity instead of firing single-key shortcuts (A, E, C ...).
    await openApp(page);
    await page.locator('[data-part-id="entity"]').click();
    await page.mouse.move(500, 340);
    await page.mouse.click(510, 340);
    await expect(page.locator('.sc-inline-input')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('.sc-inline-input')).toBeFocused();
    await page.keyboard.type('Patient');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sc-inline-input')).toHaveCount(0);
    await expect(chenCount(page, 'entity')).toHaveCount(1);
    await expect(chenCount(page, 'attribute')).toHaveCount(0);
    await expect(sheet(page).getByText('Patient', { exact: true })).toBeVisible();
    await expect(page.locator('.sc-canvas')).toHaveAttribute('data-tool', 'select');
  });
});

// =====================================================================================================================
test.describe('Horizontal schemas (relational diagram)', () => {
  async function pharmacy(page: Page): Promise<{ file: PFile; p: PProject; d: ReturnType<typeof relationalDiagram>; m: ReturnType<typeof modelOf> }> {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'relational');
    await page.keyboard.press('Shift+1');
    await settle(page, 600);
    const { file } = await saveProject(page);
    const d = relationalDiagram(file.project);
    return { file, p: file.project, d, m: modelOf(file.project, d) };
  }

  test('every table is one horizontal row; PK, FK, PK+FK and plain cells are distinguishable; composite keys are underlined', async ({ app: page }) => {
    const { m, d } = await pharmacy(page);
    const cv = sheet(page);
    let pkPlusFk = 0;
    for (const r of Object.values(m.relations!)) {
      const fkCols = new Set(Object.values(m.foreignKeys!).filter((f) => f.sourceRelationId === r.id).flatMap((f) => f.columns.map((c) => c.sourceColumnId)));
      const node = cv.locator(`[data-node-id="${nodeIdOfRelation(d, r.id)}"]`);
      const cells = node.locator('[data-column-id]');
      await expect(cells, `${r.name} cell count`).toHaveCount(r.columns.length);
      // single row, left to right in column order
      const rects = await cells.evaluateAll((els) => els.map((e) => { const q = e.querySelector('rect,polygon')!.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, id: e.getAttribute('data-column-id') }; }));
      expect(new Set(rects.map((q) => Math.round(q.y))).size, `${r.name} is a single row`).toBe(1);
      expect(rects.map((q) => q.id)).toEqual(r.columns.map((c) => c.id));
      for (let i = 1; i < rects.length; i++) expect(rects[i]!.x).toBeGreaterThanOrEqual(rects[i - 1]!.x + rects[i - 1]!.w - 1);
      for (const c of r.columns) {
        const isPk = r.primaryKey.includes(c.id);
        const isFk = fkCols.has(c.id);
        const role = isPk && isFk ? 'pk+fk' : isPk ? 'pk' : isFk ? 'fk' : 'plain';
        if (role === 'pk+fk') pkPlusFk++;
        const cell = node.locator(`[data-column-id="${c.id}"]`);
        await expect(cell, `${r.name}.${c.name} role`).toHaveAttribute('data-role', role);
        await expect(cell.locator('line'), `${r.name}.${c.name} underline iff part of the PK`).toHaveCount(isPk ? 1 : 0);
        await expect(cell.locator('text').first(), `${r.name}.${c.name} italic iff part of an FK`).toHaveCSS('font-style', isFk ? 'italic' : 'normal');
      }
      // relation name is shown above the row
      await expect(node.locator('text', { hasText: new RegExp(`^${r.name}$`) })).toHaveCount(1);
    }
    expect(pkPlusFk, 'the example has PK+FK cells (Drug, Contact, Sell, Prescription)').toBeGreaterThanOrEqual(10);
    // the composite keys: Prescription has 5 underlined cells, Contact 2, Sell 3, Drug 2
    const underlined = async (name: string) => cv.locator(`[data-node-id="${nodeIdOfRelation(d, relation(m, name).id)}"] [data-column-id] line`).count();
    expect(await underlined('Prescription')).toBe(5);
    expect(await underlined('Sell')).toBe(3);
    expect(await underlined('Contact')).toBe(2);
    expect(await underlined('Drug')).toBe(2);
    expect(await underlined('Patient')).toBe(1);
    await shot(page, 'edit-05-pharmacy-rel');
  });

  test('a composite foreign key is ONE logical constraint: one connector, one card with ordered pairs', async ({ app: page }) => {
    const { m, d } = await pharmacy(page);
    const presc = relation(m, 'Prescription');
    const drug = relation(m, 'Drug');
    const srcCol = col(presc, 'CompanyName').id;
    // the connector of that FK in the DOM (the first pair's source column identifies it)
    const edgeId = await page.evaluate((cid) => [...document.querySelectorAll('.sc-canvas [data-edge-id]')].find((e) => e.querySelector(`[data-fk-branch="${cid}"]`))!.getAttribute('data-edge-id')!, srcCol);
    const tips = await fkTips(page, { edgeId });
    expect(tips, 'one grouped connector for the composite FK').toHaveLength(1);
    // click it with the mouse (a point on its first stroke)
    const pt = await page.evaluate((id) => {
      const g = document.querySelector(`.sc-canvas [data-edge-id="${id}"]`)!;
      const el = g.querySelector('polyline') as SVGPolylineElement;
      const p = el.getPointAtLength(el.getTotalLength() * 0.5);
      const m = el.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    }, edgeId);
    await page.mouse.click(pt.x, pt.y);
    const props = properties(page);
    await expect(props.getByText('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)').first()).toBeVisible();
    await expect(props.getByText('Composite, 2 columns')).toBeVisible();
    // ONE card: exactly two pairs, in order
    await expect(props.getByRole('combobox', { name: /^Column \d+ in this table$/ })).toHaveCount(2);
    await expect(props.getByRole('combobox', { name: /^Referenced column \d+$/ })).toHaveCount(2);
    await expect(props.getByRole('combobox', { name: 'Column 1 in this table' })).toHaveValue(srcCol);
    await expect(props.getByRole('combobox', { name: 'Column 2 in this table' })).toHaveValue(col(presc, 'DrugTradeName').id);
    await expect(props.getByRole('combobox', { name: 'Referenced column 1' })).toHaveValue(col(drug, 'CompanyName').id);
    await expect(props.getByRole('combobox', { name: 'Referenced column 2' })).toHaveValue(col(drug, 'TradeName').id);
    // the model holds ONE ForeignKey with two ordered pairs
    const fks = Object.values(m.foreignKeys!).filter((f) => f.sourceRelationId === presc.id && f.targetRelationId === drug.id);
    expect(fks).toHaveLength(1);
    expect(fks[0]!.columns.map((c) => [c.sourceColumnId, c.targetColumnId])).toEqual([
      [col(presc, 'CompanyName').id, col(drug, 'CompanyName').id],
      [col(presc, 'DrugTradeName').id, col(drug, 'TradeName').id],
    ]);
    // selecting the connector highlights it as a whole
    await expect(sheet(page).locator(`[data-edge-id="${edgeId}"] polyline`).first()).toHaveAttribute('stroke', /#[0-9a-f]{6}/i);
    await shot(page, 'edit-06-composite-fk-selected');
    expect(d.edges[edgeId] ?? true).toBeTruthy();
  });

  test('connectors never jump to unrelated fields: move EVERY table of the pharmacy example in turn', async ({ app: page }) => {
    const { m, d } = await pharmacy(page);
    const cv = sheet(page);
    const expected = new Set<string>();
    for (const fk of Object.values(m.foreignKeys!)) expected.add(`${fk.columns[0]!.sourceColumnId}>${fk.columns[0]!.targetColumnId}`); // a connector's branch = its first pair
    expect(expected.size).toBe(9);
    const readPairs = async (): Promise<Set<string>> => new Set((await fkTips(page)).map((t) => `${t.source}>${t.target}`));
    expect(await readPairs()).toEqual(expected);
    await expectTipsOnTargets(page, 9);

    // every table is moved in turn into a FREE slot (two bands above / below the unmoved tables), packed left to right
    const names = Object.values(m.relations!).map((r) => r.name);
    const cb = (await cv.boundingBox())!;
    const slotRows = [cb.y + 40, cb.y + cb.height - 110];
    let row = 0;
    let cursorX = cb.x + 24;
    for (const name of names) {
      const r = relation(m, name);
      const node = cv.locator(`[data-node-id="${nodeIdOfRelation(d, r.id)}"]`);
      const box = (await node.boundingBox())!;
      const first = await cellRect(page, r.columns[0]!.id);
      if (cursorX + box.width > cb.x + cb.width - 24) {
        row = 1;
        cursorX = cb.x + 24;
      }
      const grab = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
      const dest = { x: cursorX + (grab.x - box.x), y: slotRows[row]! + (grab.y - box.y) };
      cursorX += box.width + 24;
      await dragMouse(page, grab, dest, 14);
      await settle(page, 200);
      const after = await cellRect(page, r.columns[0]!.id);
      expect(Math.abs(after.x - first.x) + Math.abs(after.y - first.y), `${name} moved`).toBeGreaterThan(10);
      expect(await readPairs(), `after moving ${name}: every connector still links its own source and referenced columns`).toEqual(expected);
      await expectTipsOnTargets(page, 9);
    }
    expect(overlaps(await nodeBoxes(page)), 'the tables ended up in free slots').toEqual([]);
    for (const t of await fkTips(page)) expect(t.distToOther, 'no arrow tip touches an unrelated cell').toBeGreaterThan(1.5);
    // semantics survive: reopen the saved file and compare constraints
    const { file } = await saveProject(page);
    expect(fkStrings(modelOf(file.project, relationalDiagram(file.project)))).toEqual(fkStrings(m));
    for (const r of Object.values(m.relations!)) expect(pkNames(relation(modelOf(file.project, relationalDiagram(file.project)), r.name))).toEqual(pkNames(r));
    // all eight tables are in different places now
    const moved = Object.values(relationalDiagram(file.project).nodes).filter((n) => d.nodes[n.id]!.x !== n.x || d.nodes[n.id]!.y !== n.y);
    expect(moved).toHaveLength(8);
    await shot(page, 'edit-07-all-moved');
  });

  test('adjust: column width handle, row height handle, reorder columns, add a column to a PK, row height + font in the options', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity', 'relational');
    await page.keyboard.press('ControlOrMeta+0');
    await settle(page, 500);
    const f0 = (await saveProject(page)).file.project;
    const d = relationalDiagram(f0);
    const m = modelOf(f0, d);
    const drug = relation(m, 'Drug');
    const company = relation(m, 'Company');
    const drugNode = nodeIdOfRelation(d, drug.id);
    const props = properties(page);

    // --- column width: drag the right border handle of Formula ---------------------------------------------------------
    await cellLocator(page, col(drug, 'Formula').id).click();
    const handle = sheet(page).locator(`[data-handle^="col-border:${drugNode}:${col(drug, 'Formula').id}:right"]`);
    await expect(handle).toBeVisible();
    const w0 = (await cellRect(page, col(drug, 'Formula').id)).w;
    const hc = await centre(handle);
    await dragMouse(page, hc, { x: hc.x + 60, y: hc.y }, 8);
    const w1 = (await cellRect(page, col(drug, 'Formula').id)).w;
    expect(w1).toBeGreaterThan(w0 + 40);
    // FK arrow still on its referenced cell after the table got wider
    await expectTipsOnTargets(page, 1);
    // undo restores the width
    await undo(page).click();
    expect(Math.abs((await cellRect(page, col(drug, 'Formula').id)).w - w0)).toBeLessThan(1);
    await redo(page).click();
    expect((await cellRect(page, col(drug, 'Formula').id)).w).toBeGreaterThan(w0 + 40);
    // the width is stored on the diagram node, not in the model
    const f1 = (await saveProject(page)).file.project;
    expect(relationalDiagram(f1).nodes[drugNode]!.columnWidths![col(drug, 'Formula').id]).toBeGreaterThan(w0 + 40);
    expect(modelOf(f1, relationalDiagram(f1))).toEqual(m);

    // --- row height via the handle -------------------------------------------------------------------------------------
    const h0 = (await cellRect(page, col(drug, 'Formula').id)).h;
    await cellLocator(page, col(drug, 'Formula').id).click();
    const rh = await centre(sheet(page).locator(`[data-handle^="row-height:${drugNode}"]`));
    await dragMouse(page, rh, { x: rh.x, y: rh.y + 24 }, 6);
    expect((await cellRect(page, col(drug, 'Formula').id)).h).toBeGreaterThan(h0 + 10);

    // --- diagram options: row height and font size apply to every table --------------------------------------------
    await page.locator('.sc-canvas').click({ position: { x: 20, y: 20 } });
    await expect(props.getByText('Notation options')).toBeVisible();
    const rowField = props.getByLabel('Row height');
    await rowField.fill('48');
    await rowField.press('Enter');
    await settle(page, 300);
    const companyCell = col(company, 'name').id;
    expect((await cellRect(page, companyCell)).h).toBeGreaterThan(44);
    const fontSize = props.getByLabel('Size', { exact: true });
    await fontSize.fill('20');
    await fontSize.press('Enter');
    await settle(page, 300);
    const fs = await cellLocator(page, col(company, 'name').id).locator('text').first().evaluate((t) => parseFloat(getComputedStyle(t).fontSize));
    expect(fs).toBeGreaterThanOrEqual(19);
    await expectTipsOnTargets(page, 1);

    // --- reorder: move Formula to the first position with the panel buttons; PK / FK / arrow follow the cells, not the positions
    await page.getByRole('button', { name: 'Undo' }).click(); // font size
    await page.getByRole('button', { name: 'Undo' }).click(); // row height
    await nodeByText(page, 'Drug').first().click({ position: { x: 3, y: 3 } }).catch(() => undefined);
    await clickCentre(page, sheet(page).locator(`[data-node-id="${drugNode}"] text`, { hasText: /^Drug$/ }));
    await expect(props.getByRole('button', { name: 'Add column' })).toBeVisible();
    await props.getByRole('button', { name: 'Move Formula left' }).click();
    await props.getByRole('button', { name: 'Move Formula left' }).click();
    const order = await sheet(page).locator(`[data-node-id="${drugNode}"] [data-column-id]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-column-id')));
    expect(order).toEqual([col(drug, 'Formula').id, col(drug, 'CompanyName').id, col(drug, 'TradeName').id]);
    // roles stay with the columns
    await expect(cellLocator(page, col(drug, 'Formula').id)).toHaveAttribute('data-role', 'plain');
    await expect(cellLocator(page, col(drug, 'CompanyName').id)).toHaveAttribute('data-role', 'pk+fk');
    await expectTipsOnTargets(page, 1);
    const f2 = (await saveProject(page)).file.project;
    expect(colNames(relation(modelOf(f2, relationalDiagram(f2)), 'Drug'))).toEqual(['Formula', 'CompanyName', 'TradeName']);
    expect(pkNames(relation(modelOf(f2, relationalDiagram(f2)), 'Drug'))).toEqual(['CompanyName', 'TradeName']); // PK order is the key's, not the column order
    expect(fkStrings(modelOf(f2, relationalDiagram(f2)))).toEqual(['Drug.(CompanyName) -> Company.(name)']);
    await shot(page, 'edit-08-adjusted');

    // --- add a column to a PK: Formula joins the key (3-column composite PK, third underline appears)
    const formulaRow = props.locator('.pp-col-row, [data-column-row]').filter({ has: page.getByLabel('Column name') });
    void formulaRow;
    await cellLocator(page, col(drug, 'Formula').id).click();
    await props.getByRole('checkbox', { name: 'Primary key' }).check();
    await expect(cellLocator(page, col(drug, 'Formula').id)).toHaveAttribute('data-role', 'pk');
    await expect(sheet(page).locator(`[data-node-id="${drugNode}"] [data-column-id] line`)).toHaveCount(3);
    const f3 = (await saveProject(page)).file.project;
    expect(pkNames(relation(modelOf(f3, relationalDiagram(f3)), 'Drug'))).toEqual(['CompanyName', 'TradeName', 'Formula']);
    await undo(page).click();
  });

  test('undo / redo of column edits: add, rename, toggle PK, reorder, remove', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity', 'relational');
    const props = properties(page);
    const f0 = (await saveProject(page)).file.project;
    const d = relationalDiagram(f0);
    const drug = relation(modelOf(f0, d), 'Drug');
    const node = sheet(page).locator(`[data-node-id="${nodeIdOfRelation(d, drug.id)}"]`);
    const cells = node.locator('[data-column-id]');
    await expect(cells).toHaveCount(3);

    await clickCentre(page, node.locator('text', { hasText: /^Drug$/ }));
    // add a column
    await props.getByRole('button', { name: 'Add column' }).click();
    await expect(cells).toHaveCount(4);
    await undo(page).click();
    await expect(cells).toHaveCount(3);
    await redo(page).click();
    await expect(cells).toHaveCount(4);
    // rename the new column inline (double click on its cell)
    const newCell = cells.nth(3);
    await renameInline(page, newCell, 'Strength');
    await expect(node.locator('text', { hasText: /^Strength$/ })).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(node.locator('text', { hasText: /^Strength$/ })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(node.locator('text', { hasText: /^Strength$/ })).toHaveCount(1);
    // toggle PK of Formula
    await cellLocator(page, col(drug, 'Formula').id).click();
    await props.getByRole('checkbox', { name: 'Primary key' }).check();
    await expect(cellLocator(page, col(drug, 'Formula').id)).toHaveAttribute('data-role', 'pk');
    await undo(page).click();
    await expect(cellLocator(page, col(drug, 'Formula').id)).toHaveAttribute('data-role', 'plain');
    await redo(page).click();
    await expect(cellLocator(page, col(drug, 'Formula').id)).toHaveAttribute('data-role', 'pk');
    // remove the new column with Delete (cell selected)
    await newCell.click();
    await page.keyboard.press('Delete');
    await expect(cells).toHaveCount(3);
    await undo(page).click();
    await expect(cells).toHaveCount(4);
    const { file } = await saveProject(page);
    const dr = relation(modelOf(file.project, relationalDiagram(file.project)), 'Drug');
    expect(colNames(dr)).toEqual(['CompanyName', 'TradeName', 'Formula', 'Strength']);
    expect(pkNames(dr)).toEqual(['CompanyName', 'TradeName', 'Formula']);
  });

  test('a PK that no longer matches a composite FK is reported (incomplete composite key), undo clears it', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'relational');
    const props = properties(page);
    const f0 = (await saveProject(page)).file.project;
    const d = relationalDiagram(f0);
    const m = modelOf(f0, d);
    const drug = relation(m, 'Drug');
    await page.getByRole('button', { name: 'Validate model' }).click();
    await expect(page.getByText('No issues').first()).toBeVisible(); // the unmodified example is clean
    await cellLocator(page, col(drug, 'Formula').id).click();
    await props.getByRole('checkbox', { name: 'Primary key' }).check(); // Drug's key is now (CompanyName, TradeName, Formula)
    await page.getByRole('button', { name: 'Validate model' }).click();
    const err = page.getByTestId('issues-dock').locator('.issue-row[data-severity="error"]');
    await expect(err.first()).toBeVisible();
    await expect(err.filter({ hasText: /Drug/ }).first()).toBeVisible();
    await err.first().click();
    await expect(page.getByTestId('issues-dock').locator('li.is-open .issue-sugg')).toContainText('Suggestion');
    await shot(page, 'edit-09-incomplete-key');
    await undo(page).click();
    await page.getByRole('button', { name: 'Validate model' }).click();
    await expect(page.getByTestId('issues-dock').locator('.issue-row[data-severity="error"]')).toHaveCount(0);
    void nodeIdOf;
    void library;
  });
});
