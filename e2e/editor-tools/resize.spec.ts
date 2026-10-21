import { test, expect, type Tools } from './helpers';

const nodeOf = (t: Tools, id: string) => t.page.evaluate((nid) => {
  const st = (window as any).__sc.store.getState();
  return st.project.diagrams[st.activeDiagramId].nodes[nid];
}, id);
const box = async (t: Tools, id: string) => (await t.page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
const cursor = (t: Tools) => t.page.locator('.sc-canvas__svg').evaluate((e) => (e as HTMLElement).style.cursor);

test.describe('resize handles', () => {
  test('Chen entity: eight handles, live resize with read-out, clamp at the text fit, Shift keeps aspect, undo/redo, Escape, double-click reset', async ({ t }) => {
    await t.open('chen');
    await t.select('Doctor');
    await expect(t.page.locator('[data-handle^="resize:"]')).toHaveCount(8);
    const id = await t.nodeId('Doctor');
    const b0 = await box(t, id);
    await t.shot('resize-01-handles');

    // cursor feedback on hover
    const e = await t.handle(`resize:${id}:e`);
    await t.page.mouse.move(e.x, e.y);
    expect(await cursor(t)).toBe('ew-resize');
    const se = await t.handle(`resize:${id}:se`);
    await t.page.mouse.move(se.x, se.y);
    expect(await cursor(t)).toBe('nwse-resize');

    // drag east edge: live preview + read-out bubble
    await t.drag(e, { x: e.x + 70, y: e.y }, { release: false });
    await expect(t.page.locator('[data-overlay="readout"]')).toBeVisible();
    await t.shot('resize-02-mid-drag-readout');
    await t.page.mouse.up();
    const b1 = await box(t, id);
    expect(b1.width).toBeGreaterThan(b0.width + 55);
    expect(b1.x).toBeCloseTo(b0.x, 0);
    expect((await nodeOf(t, id)).width).toBeGreaterThan(0);
    expect(await t.undoDepth()).toBe(1);

    // west/north keep the opposite edge: the right edge stays where it is
    const nw = await t.handle(`resize:${id}:nw`);
    await t.drag(nw, { x: nw.x - 30, y: nw.y - 20 });
    const b2 = await box(t, id);
    expect(b2.x + b2.width).toBeCloseTo(b1.x + b1.width, 0);
    expect(b2.y + b2.height).toBeCloseTo(b1.y + b1.height, 0);
    expect(b2.width).toBeGreaterThan(b1.width + 25);

    // shrink far below the text: clamps (the label is never clipped), the box never inverts
    const se2 = await t.handle(`resize:${id}:se`);
    await t.drag(se2, { x: se2.x - 600, y: se2.y - 400 });
    const b3 = await box(t, id);
    expect(b3.width).toBeGreaterThan(30);
    expect(b3.height).toBeGreaterThan(20);
    expect(b3.width).toBeLessThan(b0.width + 1);
    await t.shot('resize-03-clamped');

    // Shift keeps the aspect ratio
    const se3 = await t.handle(`resize:${id}:se`);
    const n3 = await nodeOf(t, id);
    const ratio = n3.width / n3.height;
    await t.drag(se3, { x: se3.x + 90, y: se3.y + 5 }, { shift: true });
    const b4 = await box(t, id);
    const n4 = await nodeOf(t, id);
    expect(n4.width).toBeGreaterThan(n3.width + 20);
    expect(n4.width / n4.height).toBeCloseTo(ratio, 3);

    // Escape cancels
    const depth = await t.undoDepth();
    const e2 = await t.handle(`resize:${id}:e`);
    await t.drag(e2, { x: e2.x + 60, y: e2.y }, { release: false });
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    expect((await box(t, id)).width).toBeCloseTo(b4.width, 0);
    expect(await t.undoDepth()).toBe(depth);

    // double-click a handle resets to auto size; undo brings the manual size back
    const e3 = await t.handle(`resize:${id}:e`);
    await t.page.mouse.dblclick(e3.x, e3.y);
    const node = await nodeOf(t, id);
    expect(node.width).toBeUndefined();
    expect(node.height).toBeUndefined();
    expect((await box(t, id)).width).toBeCloseTo(b0.width, 0);
    await t.page.keyboard.press('ControlOrMeta+z');
    expect((await box(t, id)).width).toBeCloseTo(b4.width, 0);
    await t.page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await box(t, id)).width).toBeCloseTo(b0.width, 0);
  });

  test('handles stay grabbable when zoomed out; weak entity, relationship and attribute resize too', async ({ t }) => {
    await t.open('chen');
    await t.state((sc) => sc.handle.current.zoomTo(0.4));
    await t.page.waitForTimeout(50);
    for (const name of ['Drug', 'Sell', 'Speciality']) {
      await t.select(name);
      const id = await t.nodeId(name);
      const b0 = await box(t, id);
      const se = await t.handle(`resize:${id}:se`);
      await t.drag(se, { x: se.x + 30, y: se.y + 20 });
      const b1 = await box(t, id);
      expect(b1.width, name).toBeGreaterThan(b0.width + 20);
      expect(b1.height, name).toBeGreaterThan(b0.height + 10);
    }
    await t.shot('resize-04-zoomed-out');
  });

  test('horizontal table: column border drags (live, clamped), row height, reset widths; semantics untouched', async ({ t }) => {
    await t.open('rel');
    const cell = await t.cellCentre('Patient', 'Address');
    await t.page.mouse.click(cell.x, cell.y);
    const id = await t.nodeId('Patient');
    const col = await t.columnId('Patient', 'Address');
    await expect(t.page.locator('[data-handle^="col-border:"]').first()).toBeVisible();
    await expect(t.page.locator(`[data-handle^="row-height:"]`)).toHaveCount(1);
    await t.shot('resize-05-table-handles');
    const cellBox = async () => (await t.page.locator(`[data-node-id="${id}"] [data-column-id="${col}"]`).first().boundingBox())!;
    const c0 = await cellBox();
    const border = await t.handle(`col-border:${id}:${col}:right`);
    await t.page.mouse.move(border.x, border.y);
    expect(await cursor(t)).toBe('ew-resize');
    const modelBefore = await t.state((sc) => { const s = sc.store.getState(); return JSON.stringify(s.project.models[s.project.diagrams[s.activeDiagramId].modelId]); });
    await t.drag(border, { x: border.x + 50, y: border.y }, { release: false });
    await expect(t.page.locator('[data-overlay="readout"]')).toBeVisible();
    await t.shot('resize-06-column-mid-drag');
    await t.page.mouse.up();
    const c1 = await cellBox();
    expect(c1.width).toBeGreaterThan(c0.width + 40);
    expect((await nodeOf(t, id)).columnWidths[col]).toBeGreaterThan(0);
    expect(await t.undoDepth()).toBe(1);
    // clamp at the text fit
    const border2 = await t.handle(`col-border:${id}:${col}:right`);
    await t.drag(border2, { x: border2.x - 400, y: border2.y });
    const c2 = await cellBox();
    expect(c2.width).toBeGreaterThan(20);
    expect(c2.width).toBeLessThan(c0.width + 1);
    // row height
    const rowB = async () => (await t.page.locator(`[data-node-id="${id}"] [data-column-id="${col}"]`).first().boundingBox())!.height;
    const h0 = await rowB();
    const rh = await t.handle(`row-height:${id}`);
    await t.page.mouse.move(rh.x, rh.y);
    expect(await cursor(t)).toBe('ns-resize');
    await t.drag(rh, { x: rh.x, y: rh.y + 18 });
    expect(await rowB()).toBeGreaterThan(h0 + 12);
    // Escape cancels a column drag
    const depth = await t.undoDepth();
    const bb = await t.handle(`col-border:${id}:${col}:right`);
    await t.drag(bb, { x: bb.x + 80, y: bb.y }, { release: false });
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    expect(await t.undoDepth()).toBe(depth);
    // reset widths (command): column widths cleared in one step, row height is kept
    await t.page.evaluate(() => (window as any).__sc.runCommand('table.resetWidths'));
    expect((await nodeOf(t, id)).columnWidths).toBeUndefined();
    expect((await cellBox()).width).toBeCloseTo(c0.width, 0);
    // the model is exactly as before
    expect(await t.state((sc) => { const s = sc.store.getState(); return JSON.stringify(s.project.models[s.project.diagrams[s.activeDiagramId].modelId]); })).toBe(modelBefore);
    // connectors still end on their cells after the resizes
    const { expectArrowsOnCells } = await import('./helpers');
    await expectArrowsOnCells(t.page, 9);
  });

  test('vertical table (crow\'s foot): the width handle resizes the table', async ({ t }) => {
    await t.open('cf');
    await t.select('Doctor');
    const id = await t.nodeId('Doctor');
    const h = await t.handle(`table-width:${id}`);
    const b0 = await box(t, id);
    await t.drag(h, { x: h.x + 60, y: h.y });
    const b1 = await box(t, id);
    expect(b1.width).toBeGreaterThan(b0.width + 45);
    await t.shot('resize-07-vertical-table');
    await t.page.mouse.dblclick((await t.handle(`table-width:${id}`)).x, (await t.handle(`table-width:${id}`)).y);
    expect((await nodeOf(t, id)).width).toBeUndefined();
  });
});

test.describe('resize: keyboard and touch', () => {
  test('Alt+Shift+Arrows resize the selected node / column / row by one grid step (one undo step each, announced)', async ({ t }) => {
    await t.open('chen');
    await t.select('Doctor');
    const id = await t.nodeId('Doctor');
    const w0 = (await box(t, id)).width;
    await t.page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(t.page.getByTestId('tools-live')).toContainText('Size');
    const w1 = (await box(t, id)).width;
    expect(w1).toBeGreaterThan(w0 + 4);
    expect(await t.undoDepth()).toBe(1);
    await t.page.keyboard.press('Alt+Shift+ArrowLeft');
    await t.page.keyboard.press('Alt+Shift+ArrowLeft');
    expect((await box(t, id)).width).toBeLessThanOrEqual(w0 + 0.5); // clamped at the text fit, never smaller
    await t.page.keyboard.press('Alt+Shift+ArrowDown');
    expect((await nodeOf(t, id)).height).toBeGreaterThan(0);

    await t.open('rel');
    const cell = await t.cellCentre('Doctor', 'Name');
    await t.page.mouse.click(cell.x, cell.y);
    const col = await t.columnId('Doctor', 'Name');
    const nid = await t.nodeId('Doctor');
    const cw0 = (await t.page.locator(`[data-node-id="${nid}"] [data-column-id="${col}"]`).first().boundingBox())!.width;
    await t.page.keyboard.press('Alt+Shift+ArrowRight');
    const cw1 = (await t.page.locator(`[data-node-id="${nid}"] [data-column-id="${col}"]`).first().boundingBox())!.width;
    expect(cw1).toBeGreaterThan(cw0 + 4);
    await t.page.keyboard.press('Alt+Shift+ArrowDown');
    expect((await nodeOf(t, nid)).height).toBeGreaterThan(0);
  });

  test('touch pointers drive a resize handle', async ({ t }) => {
    await t.open('chen');
    await t.select('Doctor');
    const id = await t.nodeId('Doctor');
    const w0 = (await box(t, id)).width;
    const h = await t.handle(`resize:${id}:e`);
    const ev = (type: string, x: number, y: number) =>
      t.page.evaluate(([tp, px, py]) => {
        document.querySelector('.sc-canvas__svg')!.dispatchEvent(new PointerEvent(tp as string, { pointerId: 7, pointerType: 'touch', clientX: px as number, clientY: py as number, bubbles: true, button: 0, buttons: 1, isPrimary: true }));
      }, [type, x, y] as const);
    await ev('pointerdown', h.x, h.y);
    await ev('pointermove', h.x + 20, h.y);
    await ev('pointermove', h.x + 60, h.y);
    await ev('pointerup', h.x + 60, h.y);
    expect((await box(t, id)).width).toBeGreaterThan(w0 + 40);
    expect(await t.state((sc) => sc.store.getState().inTransaction)).toBe(false);
  });
});
