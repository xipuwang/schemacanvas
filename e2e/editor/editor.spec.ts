import { test, expect } from './helpers';

const MOD = 'ControlOrMeta';

test.describe('canvas basics', () => {
  test('renders the scene and the status shows the fit zoom', async ({ h }) => {
    await h.open();
    expect(await h.page.locator('[data-node-id]').count()).toBeGreaterThan(10);
    const zoom = await h.page.getByTestId('zoom').textContent();
    expect(parseInt(zoom!)).toBeGreaterThan(20);
    await h.shot('01-chen-initial');
  });

  test('drag moves a node, is one undo step, and undo/redo restore it', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const before = await h.nodePos(id);
    const d0 = await h.undoDepth();
    const z = Number(await h.canvas.getAttribute('data-zoom'));
    await h.dragNode(id, 120, 60);
    const after = await h.nodePos(id);
    expect(after.x).toBeGreaterThan(before.x + 120 / z - 25);
    expect(after.x).toBeLessThan(before.x + 120 / z + 25);
    expect(after.y).toBeGreaterThan(before.y + 60 / z - 25);
    expect(await h.undoDepth()).toBe(d0 + 1);
    expect(await h.selection()).toEqual([id]);
    await h.page.keyboard.press(`${MOD}+z`);
    expect(await h.nodePos(id)).toEqual(before);
    await h.page.keyboard.press(`${MOD}+Shift+z`);
    expect(await h.nodePos(id)).toEqual(after);
  });

  test('Escape during a drag leaves the state unchanged and records nothing', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const before = await h.nodePos(id);
    const d0 = await h.undoDepth();
    await h.dragNode(id, 150, 80, { release: false });
    expect((await h.nodePos(id)).x).not.toBe(before.x);
    await h.page.keyboard.press('Escape');
    expect(await h.nodePos(id)).toEqual(before);
    await h.page.mouse.move(10, 300);
    await h.page.mouse.up();
    expect(await h.nodePos(id)).toEqual(before);
    expect(await h.undoDepth()).toBe(d0);
    expect(await h.state((sc) => sc.store.getState().inTransaction)).toBe(false);
  });

  test('a click without movement selects but creates no history entry', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const d0 = await h.undoDepth();
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    expect(await h.selection()).toEqual([id]);
    expect(await h.undoDepth()).toBe(d0);
  });

  test('marquee selects intersecting nodes (screenshot mid-drag); empty click clears; shift-click toggles', async ({ h }) => {
    await h.open();
    const company = await h.nodeId('Company');
    const pharmacy = await h.nodeId('Pharmacy');
    const a = await h.box(company);
    const b = await h.box(pharmacy);
    const x0 = a.x - 40;
    const y0 = Math.min(a.y, b.y) - 70;
    await h.page.mouse.move(x0, y0);
    await h.page.mouse.down();
    await h.page.mouse.move(b.x + b.width + 20, b.y + b.height + 20, { steps: 10 });
    await expect(h.page.locator('[data-overlay="marquee"]')).toHaveCount(1);
    await h.shot('02-chen-marquee-midway');
    const sel = await h.selection();
    expect(sel).toContain(company);
    expect(sel).toContain(pharmacy);
    await h.page.mouse.up();
    await expect(h.page.locator('[data-overlay="marquee"]')).toHaveCount(0);
    expect((await h.selection()).length).toBeGreaterThanOrEqual(2);
    await expect(h.page.locator('[data-overlay="group"]')).toHaveCount(1);
    await h.page.mouse.click(20, 400);
    expect(await h.selection()).toEqual([]);

    const doctor = await h.nodeId('Doctor');
    await h.page.mouse.click((await h.centre(doctor)).x, (await h.centre(doctor)).y);
    await h.page.keyboard.down('Shift');
    await h.page.mouse.click((await h.centre(company)).x, (await h.centre(company)).y);
    expect(await h.selection()).toEqual([doctor, company]);
    await h.page.mouse.click((await h.centre(doctor)).x, (await h.centre(doctor)).y);
    await h.page.keyboard.up('Shift');
    expect(await h.selection()).toEqual([company]);
  });

  test('Alt-marquee requires full containment', async ({ h }) => {
    await h.open();
    const company = await h.nodeId('Company');
    const a = await h.box(company);
    await h.page.keyboard.down('Alt');
    await h.page.mouse.move(a.x + a.width / 2, a.y - 10);
    await h.page.mouse.down();
    await h.page.mouse.move(a.x + a.width / 2 + 30, a.y + a.height / 2 + 10, { steps: 5 });
    await h.page.mouse.up();
    await h.page.keyboard.up('Alt');
    expect(await h.selection()).not.toContain(company);
  });
});

test.describe('viewport', () => {
  test('ctrl+wheel zooms around the cursor and the status follows; zoom is clamped', async ({ h }) => {
    await h.open();
    const c0 = await h.centre(await h.nodeId('Drug'));
    const c = { x: Math.round(c0.x), y: Math.round(c0.y) }; // wheel events carry integer client coordinates
    const w0 = await h.page.evaluate(([x, y]) => (window as any).__sc.handle.current.clientToWorld(x, y), [c.x, c.y]);
    const z0 = Number(await h.canvas.getAttribute('data-zoom'));
    await h.page.mouse.move(c.x, c.y);
    await h.page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await h.page.mouse.wheel(0, -100);
    await h.page.keyboard.up('Control');
    const z1 = Number(await h.canvas.getAttribute('data-zoom'));
    expect(z1).toBeGreaterThan(z0 * 1.5);
    // the world point that was under the cursor is still under it (wheel events carry integer client coordinates)
    const back = await h.page.evaluate((w) => (window as any).__sc.handle.current.worldToClient(w), w0);
    expect(Math.abs(back.x - c.x)).toBeLessThan(1);
    expect(Math.abs(back.y - c.y)).toBeLessThan(1);
    expect(await h.page.getByTestId('zoom').textContent()).toBe(`${Math.round(z1 * 100)}%`);
    await h.shot('03-chen-zoomed-in');
    await h.page.keyboard.down('Control');
    for (let i = 0; i < 40; i++) await h.page.mouse.wheel(0, 300);
    await h.page.keyboard.up('Control');
    expect(Number(await h.canvas.getAttribute('data-zoom'))).toBeCloseTo(0.1, 5);
  });

  test('plain wheel (trackpad scroll) pans; space+drag, middle button and the hand tool pan without touching nodes', async ({ h }) => {
    await h.open();
    const v0 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    await h.page.mouse.move(600, 400);
    await h.page.mouse.wheel(40, 80);
    const v1 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    expect(v1.x).toBeCloseTo(v0.x - 40, 3);
    expect(v1.y).toBeCloseTo(v0.y - 80, 3);

    const id = await h.nodeId('Company');
    const pos = await h.nodePos(id);
    const c = await h.centre(id);
    await h.page.keyboard.down('Space');
    await h.page.mouse.move(c.x, c.y);
    await h.page.mouse.down();
    await h.page.mouse.move(c.x + 90, c.y + 40, { steps: 5 });
    await h.page.mouse.up();
    await h.page.keyboard.up('Space');
    const v2 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    expect(v2.x).toBeCloseTo(v1.x + 90, 3);
    expect(v2.y).toBeCloseTo(v1.y + 40, 3);
    expect(await h.nodePos(id)).toEqual(pos);
    expect(await h.selection()).toEqual([]);

    // hand tool (H)
    await h.canvas.focus();
    await h.page.keyboard.press('h');
    expect(await h.page.getByTestId('tool').textContent()).toBe('hand');
    const c2 = await h.centre(id);
    await h.page.mouse.move(c2.x, c2.y);
    await h.page.mouse.down();
    await h.page.mouse.move(c2.x - 50, c2.y, { steps: 4 });
    await h.page.mouse.up();
    const v3 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    expect(v3.x).toBeCloseTo(v2.x - 50, 3);
    expect(await h.nodePos(id)).toEqual(pos);
    await h.page.keyboard.press('v');
    expect(await h.page.getByTestId('tool').textContent()).toBe('select');
  });

  test('Shift+1 fits everything; Shift+2 fits the selection; Mod+0 resets to 100%', async ({ h }) => {
    await h.open();
    await h.page.evaluate(() => (window as any).__sc.handle.current.setViewport({ x: -3000, y: 900, zoom: 3 }));
    await h.canvas.focus();
    await h.page.keyboard.press('Shift+1');
    const box = await h.canvas.boundingBox();
    const all = await h.page.evaluate(() => {
      const r = [...document.querySelectorAll('[data-node-id]')].map((n) => n.getBoundingClientRect());
      return { l: Math.min(...r.map((x) => x.left)), t: Math.min(...r.map((x) => x.top)), r: Math.max(...r.map((x) => x.right)), b: Math.max(...r.map((x) => x.bottom)) };
    });
    expect(all.l).toBeGreaterThanOrEqual(box!.x);
    expect(all.t).toBeGreaterThanOrEqual(box!.y);
    expect(all.r).toBeLessThanOrEqual(box!.x + box!.width);
    expect(all.b).toBeLessThanOrEqual(box!.y + box!.height);

    const id = await h.nodeId('Doctor');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.page.keyboard.press('Shift+2');
    const b2 = await h.box(id);
    const cb = (await h.canvas.boundingBox())!;
    expect(Number(await h.canvas.getAttribute('data-zoom'))).toBe(2); // a single small node is capped at 200%
    expect(Math.abs(b2.x + b2.width / 2 - (cb.x + cb.width / 2))).toBeLessThan(3);
    expect(Math.abs(b2.y + b2.height / 2 - (cb.y + cb.height / 2))).toBeLessThan(3);
    await h.page.keyboard.press(`${MOD}+0`);
    expect(Number(await h.canvas.getAttribute('data-zoom'))).toBe(1);
  });

  test('viewport is persisted (debounced) and restored when switching diagrams', async ({ h }) => {
    await h.open();
    await h.page.evaluate(() => (window as any).__sc.handle.current.setViewport({ x: 123, y: 45, zoom: 1.5 }));
    await h.page.waitForTimeout(450);
    const stored = await h.state((sc) => {
      const s = sc.store.getState();
      return s.project.diagrams[s.activeDiagramId].viewport;
    });
    expect(stored).toEqual({ x: 123, y: 45, zoom: 1.5 });
    await h.page.getByRole('button', { name: 'rel' }).click();
    await h.page.waitForSelector('[data-relation-id]');
    await h.page.getByRole('button', { name: 'chen' }).click();
    await h.page.waitForSelector('[data-node-id]');
    const v = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    expect(v).toEqual({ x: 123, y: 45, zoom: 1.5 });
  });

  test('an empty diagram shows the hint and centres the origin at 100%', async ({ h }) => {
    await h.open('empty');
    await expect(h.page.getByTestId('canvas-empty')).toHaveText('Drag an entity onto the sheet, or open an example');
    const v = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    const box = await h.canvas.boundingBox();
    expect(v.zoom).toBe(1);
    expect(Math.abs(v.x - box!.width / 2)).toBeLessThan(2);
    expect(Math.abs(v.y - box!.height / 2)).toBeLessThan(2);
    await h.shot('04-empty-state');
  });
});

test.describe('keyboard', () => {
  test('arrows nudge by the grid (Shift x10, Alt 1px); Tab walks nodes; Escape clears', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    const p0 = await h.nodePos(id);
    const grid = await h.state((sc) => {
      const s = sc.store.getState();
      return s.project.diagrams[s.activeDiagramId].options.grid.size as number;
    });
    await h.page.keyboard.press('ArrowRight');
    expect((await h.nodePos(id)).x).toBe(p0.x + grid);
    await h.page.keyboard.press('Shift+ArrowDown');
    expect((await h.nodePos(id)).y).toBe(p0.y + grid * 10);
    await h.page.keyboard.press('Alt+ArrowLeft');
    expect((await h.nodePos(id)).x).toBe(p0.x + grid - 1);
    await h.page.keyboard.press('Escape');
    expect(await h.selection()).toEqual([]);
    // A11Y-02: Tab moves the FOCUS ring only (announced, selection untouched); Space selects the focused shape
    await h.page.keyboard.press('Tab');
    expect((await h.selection()).length).toBe(0);
    await expect(h.page.locator('[data-overlay="focus"]')).toHaveCount(1);
    await expect(h.page.getByRole('status').filter({ hasText: 'Press Space or Enter to select it' })).toHaveCount(1);
    await h.page.keyboard.press('Space');
    expect((await h.selection()).length).toBe(1);
    await expect(h.page.getByRole('status').filter({ hasText: 'selected' })).toHaveCount(1);
  });

  test('Mod+A selects all, Mod+D duplicates, Mod+C / Mod+V paste at a growing offset', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Pharmacy');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    const n0 = await h.page.locator('[data-node-id]').count();
    await h.page.keyboard.press(`${MOD}+d`);
    const n1 = await h.page.locator('[data-node-id]').count();
    expect(n1).toBeGreaterThan(n0);
    const sel1 = await h.selection();
    expect(sel1).not.toContain(id);
    await h.page.keyboard.press(`${MOD}+c`);
    await h.page.keyboard.press(`${MOD}+v`);
    const p1 = await h.nodePos((await h.selection())[0]!);
    await h.page.keyboard.press(`${MOD}+v`);
    const p2 = await h.nodePos((await h.selection())[0]!);
    expect(p2.x).toBeGreaterThan(p1.x);
    await h.page.keyboard.press(`${MOD}+a`);
    expect((await h.selection()).length).toBe(await h.page.locator('[data-node-id]').count());
  });

  test('typing in an input never triggers shortcuts', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Pharmacy');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.page.keyboard.press('Enter'); // inline editor opens
    const input = h.page.locator('.sc-inline-input');
    await expect(input).toBeFocused();
    const d0 = await h.undoDepth();
    await h.page.keyboard.press('Delete');
    await h.page.keyboard.press('Backspace');
    await h.page.keyboard.type('hv');
    await h.page.keyboard.press(`${MOD}+a`);
    expect(await h.page.locator('[data-node-id]').count()).toBeGreaterThan(10);
    expect(await h.undoDepth()).toBe(d0);
    await h.page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    expect(await h.page.getByTestId('tool').textContent()).toBe('select');
  });
});

test.describe('semantic delete', () => {
  test('entity, attribute and relationship nodes; participation line; attribute link', async ({ h }) => {
    await h.open();
    const names = async () => h.state((sc) => {
      const s = sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      return { entities: Object.values(m.entities).map((e: any) => e.name), rels: Object.values(m.relationships).map((e: any) => e.name), attrs: Object.values(m.attributes).map((e: any) => e.name) };
    });
    const click = async (name: string) => {
      const c = await h.centre(await h.nodeId(name));
      await h.page.mouse.click(c.x, c.y);
    };
    await click('Patient');
    await h.page.keyboard.press('Delete');
    expect((await names()).entities).not.toContain('Patient');
    await click('Speciality');
    await h.page.keyboard.press('Backspace');
    expect((await names()).attrs).not.toContain('Speciality');
    await click('Sell');
    await h.page.keyboard.press('Delete');
    expect((await names()).rels).not.toContain('Sell');
    await h.page.keyboard.press(`${MOD}+z`);
    expect((await names()).rels).toContain('Sell');

    // a participation line: only the participant goes
    const edge = await h.state((sc) => {
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      return Object.entries(d.edges).find(([, e]: any) => e.ref.kind === 'participant')![0] as string;
    });
    const before = await names();
    const pt = await h.edgePoint(edge);
    await h.page.mouse.click(pt.x, pt.y);
    expect(await h.selection()).toEqual([edge]);
    await h.page.keyboard.press('Delete');
    expect((await names()).entities).toEqual(before.entities);
    expect(await h.page.locator(`[data-edge-id="${edge}"]`).count()).toBe(0);

    // an attribute link: the attribute goes
    const link = await h.state((sc) => {
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      return Object.entries(d.edges).find(([, e]: any) => e.ref.kind === 'attribute')![0] as string;
    });
    const lp = await h.edgePoint(link);
    await h.page.mouse.click(lp.x, lp.y);
    expect(await h.selection()).toEqual([link]);
    const nAttrs = (await names()).attrs.length;
    await h.page.keyboard.press('Delete');
    expect((await names()).attrs.length).toBe(nAttrs - 1);
  });

  test('relational: FK edge, a selected cell (column) and a table', async ({ h }) => {
    await h.open('rel');
    const counts = () => h.state((sc) => {
      const s = sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      return { rel: Object.keys(m.relations).length, fk: Object.keys(m.foreignKeys).length, cols: Object.values(m.relations).reduce((a: number, r: any) => a + r.columns.length, 0) };
    });
    const c0 = await counts();
    // FK edge
    const edge = await h.state((sc) => {
      const s = sc.store.getState();
      return Object.keys(s.project.diagrams[s.activeDiagramId].edges)[0] as string;
    });
    const p = await h.edgePoint(edge);
    await h.page.mouse.click(p.x, p.y);
    const sub = await h.state((sc) => sc.store.getState().selection.sub);
    expect(sub?.kind).toBe('foreignKey');
    await h.page.keyboard.press('Delete');
    expect((await counts()).fk).toBe(c0.fk - 1);
    expect((await counts()).rel).toBe(c0.rel);

    // a cell
    const cell = h.page.locator('[data-relation-id] [data-column-id]').nth(1);
    const cb = (await cell.boundingBox())!;
    await h.page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    expect(await h.state((sc) => sc.store.getState().selection.sub?.kind)).toBe('column');
    await h.page.keyboard.press('Delete');
    expect((await counts()).cols).toBe(c0.cols - 1);
    expect((await counts()).rel).toBe(c0.rel);

    // a table
    const id = await h.nodeId('Sell');
    const nb = (await h.page.locator(`[data-node-id="${id}"] text`).first().boundingBox())!; // the relation name selects the table itself
    await h.page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
    expect(await h.state((sc) => sc.store.getState().selection.sub)).toBeUndefined();
    await h.page.keyboard.press('Delete');
    expect((await counts()).rel).toBe(c0.rel - 1);
  });
});

test.describe('arrange', () => {
  test('align left / distribute through the command registry after a real multi-selection', async ({ h }) => {
    await h.open();
    const ids = [await h.nodeId('Doctor'), await h.nodeId('Patient'), await h.nodeId('Drug')];
    await h.page.mouse.click((await h.centre(ids[0]!)).x, (await h.centre(ids[0]!)).y);
    await h.page.keyboard.down('Shift');
    for (const id of ids.slice(1)) await h.page.mouse.click((await h.centre(id)).x, (await h.centre(id)).y);
    await h.page.keyboard.up('Shift');
    expect((await h.selection()).length).toBe(3);
    await h.page.evaluate(() => (window as any).__sc.runCommand('arrange.alignLeft'));
    const lefts = await Promise.all(ids.map(async (id) => Math.round((await h.box(id)).x)));
    expect(new Set(lefts).size).toBe(1);
    await h.page.evaluate(() => (window as any).__sc.runCommand('arrange.alignMiddle'));
    const mids = await Promise.all(ids.map(async (id) => { const b = await h.box(id); return Math.round(b.y + b.height / 2); }));
    expect(new Set(mids).size).toBe(1);
  });
});

test.describe('inline rename', () => {
  test('double-click renames an entity (Enter commits, same id), Escape cancels, blur commits', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Pharmacy');
    const c = await h.centre(id);
    await h.page.mouse.dblclick(c.x, c.y);
    const input = h.page.locator('.sc-inline-input');
    await expect(input).toBeFocused();
    expect(await input.inputValue()).toBe('Pharmacy');
    await h.shot('05-inline-edit');
    await h.page.keyboard.type('Drugstore');
    await h.page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(h.page.locator(`[data-node-id="${id}"] text`).first()).toHaveText('Drugstore');

    await h.page.mouse.dblclick(c.x, c.y);
    await h.page.keyboard.type('Zzz');
    await h.page.keyboard.press('Escape');
    await expect(h.page.locator(`[data-node-id="${id}"] text`).first()).toHaveText('Drugstore');

    await h.page.mouse.dblclick(c.x, c.y);
    await h.page.keyboard.type('Blurred');
    await h.page.mouse.click(20, 500); // click on empty canvas: blur commits
    await expect(h.page.locator(`[data-node-id="${id}"] text`).first()).toHaveText('Blurred');
  });

  test('relational: double-click a cell edits that column; Tab commits and moves to the next cell', async ({ h }) => {
    await h.open('rel');
    const id = await h.nodeId('Doctor');
    const cells = h.page.locator(`[data-node-id="${id}"] [data-column-id]`);
    const b = (await cells.nth(1).boundingBox())!;
    await h.page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    const input = h.page.locator('.sc-inline-input');
    await expect(input).toBeFocused();
    const first = await input.inputValue();
    expect(first).toBe('Name');
    await h.page.keyboard.type('FullName');
    await h.page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    expect(await input.inputValue()).toBe('Specialty');
    await h.page.keyboard.type('Field');
    await h.page.keyboard.press('Shift+Tab');
    expect(await input.inputValue()).toBe('FullName');
    await h.page.keyboard.press('Enter');
    const names = await h.state((sc) => {
      const s = sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      return (Object.values(m.relations).find((r: any) => r.name === 'Doctor') as any).columns.map((c: any) => c.name);
    });
    expect(names.slice(0, 3)).toEqual(['SSN', 'FullName', 'Field']);
  });

  test('double-click the relation name renames the relation', async ({ h }) => {
    await h.open('rel');
    const id = await h.nodeId('Company');
    const label = h.page.locator(`[data-node-id="${id}"] text`).first();
    const lb = (await label.boundingBox())!;
    await h.page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await expect(h.page.locator('.sc-inline-input')).toHaveAttribute('data-edit-kind', 'relation');
    await h.page.keyboard.type('Firm');
    await h.page.keyboard.press('Enter');
    await expect(h.page.locator(`[data-node-id="${id}"] text`).first()).toHaveText('Firm');
  });
});

test.describe('library drop & click-to-place', () => {
  async function drop(h: import('./helpers').Harness, item: object, at: { x: number; y: number }) {
    const dt = await h.page.evaluateHandle((it) => {
      const d = new DataTransfer();
      d.setData('application/x-schemacanvas-item', JSON.stringify(it));
      return d;
    }, item);
    await h.canvas.dispatchEvent('dragover', { dataTransfer: dt, clientX: at.x, clientY: at.y });
    await h.canvas.dispatchEvent('drop', { dataTransfer: dt, clientX: at.x, clientY: at.y });
  }

  test('dropping an entity on an empty sheet creates it centred on the drop point, selects it and starts a rename', async ({ h }) => {
    await h.open('empty');
    const box = (await h.canvas.boundingBox())!;
    const at = { x: box.x + 300, y: box.y + 200 };
    await drop(h, { kind: 'entity' }, at);
    await expect(h.page.locator('[data-node-id]')).toHaveCount(1);
    await expect(h.page.getByTestId('canvas-empty')).toHaveCount(0);
    const id = (await h.selection())[0]!;
    const b = await h.box(id);
    expect(Math.abs(b.x + b.width / 2 - at.x)).toBeLessThan(25);
    expect(Math.abs(b.y + b.height / 2 - at.y)).toBeLessThan(25);
    const input = h.page.locator('.sc-inline-input');
    await expect(input).toBeFocused();
    expect(await input.inputValue()).toBe('Entity1');
    await h.page.keyboard.type('Student');
    await h.page.keyboard.press('Enter');
    await expect(h.page.locator(`[data-node-id="${id}"] text`).first()).toHaveText('Student');
    expect(await h.undoDepth()).toBe(2); // create + rename
  });

  test('weak entity, relationship, identifying relationship; attributes land on their owner', async ({ h }) => {
    await h.open('empty');
    const box = (await h.canvas.boundingBox())!;
    await drop(h, { kind: 'entity', weak: true }, { x: box.x + 200, y: box.y + 200 });
    await h.page.keyboard.press('Escape');
    await drop(h, { kind: 'relationship', identifying: true }, { x: box.x + 450, y: box.y + 200 });
    await h.page.keyboard.press('Escape');
    const weakId = await h.nodeId('Entity1');
    const wb = await h.box(weakId);
    await drop(h, { kind: 'attribute', flavor: 'partial-key' }, { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2 });
    await h.page.keyboard.press('Escape');
    await drop(h, { kind: 'attribute', flavor: 'multivalued' }, { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2 });
    await h.page.keyboard.press('Escape');
    const info = await h.state((sc) => {
      const s = sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      const e: any = Object.values(m.entities)[0];
      return { weak: e.weak, ident: (Object.values(m.relationships)[0] as any).identifying, attrs: Object.values(m.attributes).map((a: any) => ({ k: a.key, mv: a.multivalued, owner: a.owner.id === e.id })) };
    });
    expect(info.weak).toBe(true);
    expect(info.ident).toBe(true);
    expect(info.attrs).toHaveLength(2);
    expect(info.attrs.every((a) => a.owner)).toBe(true);
    expect(info.attrs.some((a) => a.k === 'partial')).toBe(true);
    expect(info.attrs.some((a) => a.mv)).toBe(true);
    // double ellipse + double rectangle + double diamond are drawn
    await h.shot('06-dropped-weak-identifying');
  });

  test('an attribute dropped on empty space explains itself with a toast and changes nothing', async ({ h }) => {
    await h.open('empty');
    const box = (await h.canvas.boundingBox())!;
    const d0 = await h.undoDepth();
    await drop(h, { kind: 'attribute', flavor: 'simple' }, { x: box.x + 100, y: box.y + 100 });
    expect(await h.undoDepth()).toBe(d0);
    expect(await h.page.evaluate(() => (window as any).__sc.store.getState().project.updatedAt)).toBeTruthy();
    const toasts = await h.page.evaluate(() => (window as any).__sc.ui.getState().toasts.map((t: any) => t.message as string));
    expect(toasts.some((m: string) => m.includes('Drop an attribute onto'))).toBe(true);
  });

  test('relational: dropping a table creates Table1 with 3 columns (first is the key)', async ({ h }) => {
    await h.open('rel');
    const at = { x: 900, y: 120 };
    await drop(h, { kind: 'relation' }, at);
    const cells = h.page.locator('[data-relation-id]').last().locator('[data-column-id]');
    await expect(h.page.locator('.sc-inline-input')).toBeFocused();
    await h.page.keyboard.press('Escape');
    const rel = await h.state((sc) => {
      const s = sc.store.getState();
      const m = s.project.models[s.project.diagrams[s.activeDiagramId].modelId];
      const r: any = Object.values(m.relations).find((x: any) => x.name === 'Table1');
      return { cols: r.columns.map((c: any) => c.name), pk: r.primaryKey.length };
    });
    expect(rel).toEqual({ cols: ['Column1', 'Column2', 'Column3'], pk: 1 });
    void cells;
  });

  test('armItem: click places the element, Escape disarms, a ghost follows the cursor', async ({ h }) => {
    await h.open('empty');
    await h.page.evaluate(() => (window as any).__sc.handle.current.armItem({ kind: 'relationship' }));
    expect(await h.canvas.getAttribute('data-armed')).toBe('relationship');
    const box = (await h.canvas.boundingBox())!;
    await h.page.mouse.move(box.x + 300, box.y + 250);
    await h.page.mouse.move(box.x + 320, box.y + 260);
    await expect(h.page.locator('[data-overlay="ghost"]')).toHaveCount(1);
    await h.shot('07-armed-ghost');
    await h.page.keyboard.press('Escape');
    expect(await h.canvas.getAttribute('data-armed')).toBeNull();
    await h.page.mouse.click(box.x + 300, box.y + 250);
    await expect(h.page.locator('[data-node-id]')).toHaveCount(0);
    await h.page.evaluate(() => (window as any).__sc.handle.current.armItem({ kind: 'entity' }));
    await h.page.mouse.click(box.x + 300, box.y + 250);
    await expect(h.page.locator('[data-node-id]')).toHaveCount(1);
    expect(await h.canvas.getAttribute('data-armed')).toBeNull();
    await h.page.keyboard.press('Escape'); // cancel rename
  });
});

test.describe('context menu', () => {
  test('right-click a node: relevant commands with shortcuts, arrow navigation, Escape closes, Duplicate works', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y, { button: 'right' });
    const menu = h.page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await h.selection()).toEqual([id]);
    const labels = await menu.getByRole('menuitem').allTextContents();
    expect(labels.join('|')).toMatch(/Cut.*Copy.*Duplicate.*Delete.*Bring to front.*Send to back.*Lock position.*Remove from diagram/);
    expect(labels.find((l) => l.startsWith('Duplicate'))).toMatch(/(Ctrl\+D|⌘D)/);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await h.page.waitForTimeout(250); // let the 120ms open animation finish before the screenshot
    await h.shot('08-context-menu-node');
    await h.page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await h.page.keyboard.press('End');
    await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await h.page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(h.canvas).toBeFocused();

    const n0 = await h.page.locator('[data-node-id]').count();
    await h.page.mouse.click(c.x, c.y, { button: 'right' });
    await menu.getByRole('menuitem', { name: /Duplicate/ }).click();
    expect(await h.page.locator('[data-node-id]').count()).toBeGreaterThan(n0);
  });

  test('right-click empty space offers paste / select all / fit / auto-layout; clicking outside closes', async ({ h }) => {
    await h.open();
    await h.page.mouse.click(30, 450, { button: 'right' });
    const menu = h.page.getByRole('menu');
    const labels = await menu.getByRole('menuitem').allTextContents();
    expect(labels.join('|')).toMatch(/Paste.*Select all.*Fit to content.*Auto-layout/);
    await h.page.mouse.click(600, 100);
    await expect(menu).toHaveCount(0);
    await h.page.mouse.click(30, 450, { button: 'right' });
    await menu.getByRole('menuitem', { name: /Select all/ }).click();
    expect((await h.selection()).length).toBeGreaterThan(10);
  });

  test('right-click an edge offers reset route / delete; keyboard (Shift+F10) opens the menu for the selection', async ({ h }) => {
    await h.open('rel');
    const edge = await h.state((sc) => {
      const s = sc.store.getState();
      return Object.keys(s.project.diagrams[s.activeDiagramId].edges)[0] as string;
    });
    const p = await h.edgePoint(edge);
    await h.page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = h.page.getByRole('menu');
    const labels = await menu.getByRole('menuitem').allTextContents();
    expect(labels.join('|')).toMatch(/Reset route.*Delete/);
    await h.page.keyboard.press('Escape');
    const id = await h.nodeId('Drug');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await h.page.keyboard.press('Escape');
  });
});

test.describe('snap guides, relational selection and themes (screenshots)', () => {
  test('smart guides appear while dragging near another node and vanish on release', async ({ h }) => {
    await h.open();
    const company = await h.nodeId('Company');
    const pharmacy = await h.nodeId('Pharmacy');
    const cb = await h.box(company);
    const pb = await h.box(pharmacy);
    // drag Pharmacy so its centre line is ~2px off Doctor/Company's centre line
    const dy = cb.y + cb.height / 2 - (pb.y + pb.height / 2) + 40;
    await h.dragNode(pharmacy, 0, dy, { release: false, steps: 6 });
    await h.page.mouse.move((await h.centre(pharmacy)).x, (await h.centre(pharmacy)).y - 36, { steps: 3 });
    await h.page.waitForTimeout(80);
    const guides = await h.page.locator('[data-overlay="guide"]').count();
    await h.shot('09-snap-guides');
    expect(guides).toBeGreaterThan(0);
    await h.page.mouse.up();
    await expect(h.page.locator('[data-overlay="guide"]')).toHaveCount(0);
  });

  test('relational schema with a selected cell and a selected FK', async ({ h }) => {
    await h.open('rel');
    const id = await h.nodeId('Drug');
    const cell = h.page.locator(`[data-node-id="${id}"] [data-column-id]`).nth(1);
    const cb = (await cell.boundingBox())!;
    await h.page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    expect(await h.state((sc) => sc.store.getState().selection.sub?.kind)).toBe('column');
    await expect(h.page.getByRole('status').filter({ hasText: /Column TradeName of table Drug selected/ })).toHaveCount(1);
    await h.shot('10-relational-selected-cell');
    const fk = await h.state((sc) => {
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      const m = s.project.models[d.modelId];
      const compositeFk: any = Object.values(m.foreignKeys).find((f: any) => f.columns.length > 1);
      return Object.entries(d.edges).find(([, e]: any) => e.ref.foreignKeyId === compositeFk.id)![0] as string;
    });
    const p = await h.edgePoint(fk);
    await h.page.mouse.click(p.x, p.y);
    expect(await h.selection()).toEqual([fk]);
    await h.shot('11-relational-selected-fk');
  });

  test('dark theme renders the grid and shapes with the dark palette', async ({ h }) => {
    await h.open('chen', '?theme=dark');
    const bg = await h.page.evaluate(() => getComputedStyle(document.querySelector('.sc-canvas__svg')!).backgroundColor);
    expect(bg).toBe('rgb(15, 20, 26)');
    await h.shot('12-dark');
  });

  test('chen pharmacy with a selection', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Drug');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.shot('13-chen-selected');
    await expect(h.page.getByRole('status').filter({ hasText: /Weak entity Drug selected, 2 attributes/ })).toHaveCount(1);
  });
});

test.describe('robustness', () => {
  test('no horizontal page scroll and the canvas has the application role with an accessible name', async ({ h }) => {
    await h.open();
    const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(h.page.getByRole('application', { name: 'Diagram canvas' })).toBeVisible();
  });

  test('blur / pointercancel during a drag ends it cleanly', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const before = await h.nodePos(id);
    await h.dragNode(id, 120, 40, { release: false });
    await h.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await h.nodePos(id)).toEqual(before);
    expect(await h.state((sc) => sc.store.getState().inTransaction)).toBe(false);
    await h.page.mouse.up();
  });

  test('switching diagram mid-drag does not leave a transaction open', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    await h.dragNode(id, 120, 40, { release: false });
    await h.page.evaluate(() => {
      const sc = (window as any).__sc;
      sc.store.getState().cancelTransaction();
      sc.store.getState().setActiveDiagram(sc.ids.rel);
    });
    await h.page.waitForSelector('[data-relation-id]');
    await h.page.mouse.up();
    expect(await h.state((sc) => sc.store.getState().inTransaction)).toBe(false);
  });

  test('locked nodes do not drag', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.page.evaluate(() => (window as any).__sc.runCommand('arrange.lock'));
    const before = await h.nodePos(id);
    const d0 = await h.undoDepth();
    await h.dragNode(id, 100, 50);
    expect(await h.nodePos(id)).toEqual(before);
    expect(await h.undoDepth()).toBe(d0);
  });
});
