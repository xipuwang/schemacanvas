import { test, expect, edgeClientPoint, expectArrowsOnCells, type Tools } from './helpers';

async function edgeOf(t: Tools, sourceRel: string, targetRel: string): Promise<string> {
  return t.page.evaluate(
    ([s, g]) => {
      const sc = (window as any).__sc;
      const st = sc.store.getState();
      const d = st.project.diagrams[st.activeDiagramId];
      const m = st.project.models[d.modelId];
      const fk = Object.values<any>(m.foreignKeys).find((f) => m.relations[f.sourceRelationId].name === s && m.relations[f.targetRelationId].name === g);
      return Object.values<any>(d.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fk.id).id as string;
    },
    [sourceRel, targetRel] as const,
  );
}

const route = (t: Tools, edgeId: string) => t.page.evaluate((id) => {
  const st = (window as any).__sc.store.getState();
  return st.project.diagrams[st.activeDiagramId].edges[id].route;
}, edgeId);
const fkSnapshot = (t: Tools) => t.page.evaluate(() => {
  const st = (window as any).__sc.store.getState();
  return JSON.stringify(st.project.models[st.project.diagrams[st.activeDiagramId].modelId].foreignKeys);
});

test.describe('edge editing (horizontal schema)', () => {
  test('select an FK edge: handles appear; midpoint drag inserts a waypoint (manual route); bend drag; Alt+click removes; Reset route', async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, 'Patient', 'Doctor');
    const p = await edgeClientPoint(t.page, id, 0.5);
    await t.page.mouse.click(p.x, p.y);
    await expect(t.page.locator('[data-handle^="mid:"]').first()).toBeVisible();
    await expect(t.page.locator('[data-handle^="end:"]')).toHaveCount(2);
    await t.shot('edges-01-selected-handles');
    const fks0 = await fkSnapshot(t);
    const depth0 = await t.undoDepth();

    // hover shows the copy cursor on a midpoint handle
    const mid = await t.handle('mid:');
    await t.page.mouse.move(mid.x, mid.y);
    expect(await t.page.locator('.sc-canvas__svg').evaluate((e) => (e as HTMLElement).style.cursor)).toBe('copy');
    await t.drag(mid, { x: mid.x + 30, y: mid.y + 22 }, { release: false });
    await t.shot('edges-02-mid-drag');
    await t.page.mouse.up();
    let r = await route(t, id);
    expect(r.mode).toBe('manual');
    expect(r.waypoints.length).toBeGreaterThan(0);
    expect(await t.undoDepth()).toBe(depth0 + 1);
    await expect(t.page.locator('[data-handle^="bend:"]')).toHaveCount(r.waypoints.length);

    const bend = await t.handle('bend:');
    await t.drag(bend, { x: bend.x - 25, y: bend.y + 10 });
    const r2 = await route(t, id);
    expect(r2.waypoints.length).toBe(r.waypoints.length);
    expect(JSON.stringify(r2.waypoints)).not.toBe(JSON.stringify(r.waypoints));
    expect(await t.undoDepth()).toBe(depth0 + 2);
    await t.shot('edges-03-bend-moved');

    // Alt+click removes a bend
    const b2 = await t.handle('bend:');
    await t.page.keyboard.down('Alt');
    await t.page.mouse.click(b2.x, b2.y);
    await t.page.keyboard.up('Alt');
    r = await route(t, id);
    expect(r.waypoints.length).toBe(r2.waypoints.length - 1);

    // never touches what the edge references
    expect(await fkSnapshot(t)).toBe(fks0);
    await expectArrowsOnCells(t.page, 9);

    // undo x3 returns to the auto route
    for (let i = 0; i < 3; i++) await t.page.keyboard.press('ControlOrMeta+z');
    r = await route(t, id);
    expect(r).toEqual({ mode: 'auto', waypoints: [] });
    // reset route command on a manual route
    await t.page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await route(t, id)).mode).toBe('manual');
    await t.page.evaluate(() => (window as any).__sc.runCommand('edge.resetRoute'));
    expect(await route(t, id)).toEqual({ mode: 'auto', waypoints: [] });
  });

  test('Escape cancels a bend / midpoint drag', async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, 'Patient', 'Doctor');
    const p = await edgeClientPoint(t.page, id, 0.5);
    await t.page.mouse.click(p.x, p.y);
    const mid = await t.handle('mid:');
    const depth = await t.undoDepth();
    await t.drag(mid, { x: mid.x + 40, y: mid.y + 40 }, { release: false });
    expect((await route(t, id)).mode).toBe('manual');
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    expect(await route(t, id)).toEqual({ mode: 'auto', waypoints: [] });
    expect(await t.undoDepth()).toBe(depth);
    expect(await t.state((sc) => sc.store.getState().inTransaction)).toBe(false);
  });

  test('end handle slides the anchor along the cell side; the arrow keeps pointing at the same cell; double-click resets', async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, 'Patient', 'Doctor');
    const p = await edgeClientPoint(t.page, id, 0.5);
    await t.page.mouse.click(p.x, p.y);
    const fks0 = await fkSnapshot(t);
    const end = await t.handle(`end:${id}:target`);
    const cell = await t.cellCentre('Doctor', 'SSN');
    const cellBox = (await t.page.locator(`[data-column-id="${await t.columnId('Doctor', 'SSN')}"]`).first().boundingBox())!;
    expect(Math.abs(end.x - cell.x)).toBeLessThan(cellBox.width / 2 + 1);
    await t.drag(end, { x: cellBox.x + cellBox.width * 0.85, y: cellBox.y + cellBox.height + 30 });
    const r = await route(t, id);
    expect(r.targetAnchor).toBeDefined();
    expect(['top', 'bottom']).toContain(r.targetAnchor.side);
    expect(r.targetAnchor.offset).toBeGreaterThan(0.6);
    await t.shot('edges-04-anchor-moved');
    await expectArrowsOnCells(t.page, 9);
    expect(await fkSnapshot(t)).toBe(fks0);
    // reset the anchor with a double click on the handle
    const end2 = await t.handle(`end:${id}:target`);
    await t.page.mouse.dblclick(end2.x, end2.y);
    expect((await route(t, id)).targetAnchor).toBeUndefined();
  });

  test('composite FK: per-branch anchors keyed by source column; pairs stay grouped and ordered', async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, 'Prescription', 'Drug');
    const p = await edgeClientPoint(t.page, id, 0.5);
    await t.page.mouse.click(p.x, p.y);
    const fks0 = await fkSnapshot(t);
    await expect(t.page.locator('[data-handle^="end:"]')).toHaveCount(4);
    await t.shot('edges-05-composite-handles');
    const ends = await t.page.locator(`[data-handle^="end:${id}:target:"]`).all();
    expect(ends.length).toBe(2);
    const box = (await ends[1]!.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await t.drag(from, { x: from.x - 8, y: from.y - 40 });
    const r = await route(t, id);
    expect(Object.keys(r.branchAnchors ?? {})).toHaveLength(1);
    expect(r.sourceAnchor).toBeUndefined();
    expect(r.targetAnchor).toBeUndefined();
    expect(await fkSnapshot(t)).toBe(fks0);
    await expect(t.page.locator(`[data-edge-id="${id}"] [data-fk-branch]`)).toHaveCount(2);
    await expectArrowsOnCells(t.page, 9);
    await t.shot('edges-06-composite-branch-anchor');
  });

  test('label dragging, straighten, and manual waypoints follow when both tables move together', async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, 'Patient', 'Doctor');
    await t.state((sc) => {
      const st = sc.store.getState();
      st.commit('label', (d: any) => sc.ops.setEdgeLabelVisible(d, st.activeDiagramId, Object.keys(st.project.diagrams[st.activeDiagramId].edges)[0], true));
    });
    await t.state((sc) => {
      const st = sc.store.getState();
      const dg = st.project.diagrams[st.activeDiagramId];
      st.commit('labels all', (d: any) => void Object.keys(dg.edges).forEach((e) => sc.ops.setEdgeLabelVisible(d, dg.id, e, true)));
      st.clearHistory();
    });
    const label = await t.centre(`[data-edge-labels="${id}"] [data-label="main"]`);
    await t.drag(label, { x: label.x + 40, y: label.y - 30 });
    const off = await t.page.evaluate((e) => {
      const st = (window as any).__sc.store.getState();
      return st.project.diagrams[st.activeDiagramId].edges[e].labelOffsets;
    }, id);
    const zoom = await t.page.evaluate(() => (window as any).__sc.handle.current.getViewport().zoom as number);
    expect(off.main.x).toBeCloseTo(40 / zoom, 0);
    expect(off.main.y).toBeCloseTo(-30 / zoom, 0);
    expect(await t.page.evaluate(() => (window as any).__sc.store.getState().selection.ids)).toEqual([id]);
    expect(await t.undoDepth()).toBe(1);
    await t.shot('edges-07-label-dragged');

    // straighten: near-aligned waypoints snap onto one axis
    await t.state((sc) => {
      const st = sc.store.getState();
      const e = Object.keys(st.project.diagrams[st.activeDiagramId].edges)[0];
      void e;
    });
    await t.page.evaluate(
      ([e]) => {
        const sc = (window as any).__sc;
        const st = sc.store.getState();
        st.commit('manual', (d: any) => sc.ops.setEdgeRoute(d, st.activeDiagramId, e, { mode: 'manual', waypoints: [{ x: 300, y: 300 }, { x: 304, y: 380 }, { x: 600, y: 383 }] }));
      },
      [id] as const,
    );
    await t.page.evaluate(() => (window as any).__sc.runCommand('edge.straighten'));
    expect((await route(t, id)).waypoints).toEqual([{ x: 300, y: 300 }, { x: 300, y: 380 }, { x: 600, y: 380 }]);

    // move BOTH tables together: the manual corners travel with them
    await t.page.evaluate(
      ([e]) => {
        const sc = (window as any).__sc;
        const st = sc.store.getState();
        st.commit('manual2', (d: any) => sc.ops.setEdgeRoute(d, st.activeDiagramId, e, { mode: 'manual', waypoints: [{ x: 400, y: 150 }, { x: 640, y: 150 }] }));
      },
      [id] as const,
    );
    const before = (await route(t, id)).waypoints;
    const docCell = await t.cellCentre('Doctor', 'Name');
    await t.page.mouse.click(docCell.x, docCell.y);
    const pat = await t.cellCentre('Patient', 'Name');
    await t.page.keyboard.down('Shift');
    await t.page.mouse.click(pat.x, pat.y);
    await t.page.keyboard.up('Shift');
    expect(await t.page.evaluate(() => (window as any).__sc.store.getState().selection.ids.length)).toBe(2);
    const doc = docCell;
    const patPos0 = await t.state((sc) => { const st = sc.store.getState(); return Object.values<any>(st.project.diagrams[st.activeDiagramId].nodes).map((n) => ({ x: n.x, y: n.y })); });
    await t.drag(doc, { x: doc.x + 60, y: doc.y + 40 });
    const patPos1 = await t.state((sc) => { const st = sc.store.getState(); return Object.values<any>(st.project.diagrams[st.activeDiagramId].nodes).map((n) => ({ x: n.x, y: n.y })); });
    const moved = patPos1.findIndex((p, i) => p.x !== patPos0[i]!.x);
    const dx = patPos1[moved]!.x - patPos0[moved]!.x;
    const dy = patPos1[moved]!.y - patPos0[moved]!.y;
    expect(dx).toBeGreaterThan(40);
    const after = (await route(t, id)).waypoints;
    expect(after).toHaveLength(before.length);
    after.forEach((w: any, i: number) => {
      expect(w.x).toBeCloseTo(before[i].x + dx, 6);
      expect(w.y).toBeCloseTo(before[i].y + dy, 6);
    });
    await t.shot('edges-08-tables-moved-with-waypoints');
    // moving ONE table keeps the corners where they are
    const empty = await t.canvas.boundingBox();
    await t.page.mouse.click(empty!.x + empty!.width - 20, empty!.y + 20);
    const doc2 = await t.cellCentre('Doctor', 'Name');
    await t.drag(doc2, { x: doc2.x + 30, y: doc2.y + 10 });
    expect((await route(t, id)).waypoints).toEqual(after);
    // one undo step per move, semantic model untouched
    await t.page.keyboard.press('ControlOrMeta+z');
    expect((await route(t, id)).waypoints).toEqual(after);
  });
});

test.describe('edge editing (Chen)', () => {
  test('participation line: end anchor moves along the outline rect side; role/cardinality labels drag', async ({ t }) => {
    await t.open('chen');
    const edgeId = await t.page.evaluate(() => {
      const st = (window as any).__sc.store.getState();
      const d = st.project.diagrams[st.activeDiagramId];
      const m = st.project.models[d.modelId];
      const rel = Object.values<any>(m.relationships).find((r) => r.name === 'PrimaryPhysician');
      return Object.values<any>(d.edges).find((e) => e.ref.kind === 'participant' && e.ref.relationshipId === rel.id && m.entities[rel.participants.find((p: any) => p.id === e.ref.participantId).entityId].name === 'Patient').id as string;
    });
    const p = await edgeClientPoint(t.page, edgeId, 0.5);
    await t.page.mouse.click(p.x, p.y);
    await expect(t.page.locator('[data-handle^="end:"]')).toHaveCount(2);
    await t.shot('edges-09-chen-selected');
    const end = await t.handle(`end:${edgeId}:target`);
    const patient = (await t.page.locator(`[data-node-id="${await t.nodeId('Patient')}"]`).first().boundingBox())!;
    await t.drag(end, { x: patient.x + patient.width * 0.9, y: patient.y + patient.height + 20 });
    const r = await route(t, edgeId);
    expect(r.targetAnchor.side).toBe('bottom');
    expect(r.targetAnchor.offset).toBeGreaterThan(0.7);
    await t.shot('edges-10-chen-anchor');
    // the edge still ends at Patient (refs unchanged)
    const ref = await t.page.evaluate((id) => {
      const st = (window as any).__sc.store.getState();
      return st.project.diagrams[st.activeDiagramId].edges[id].ref;
    }, edgeId);
    expect(ref.kind).toBe('participant');
    // cardinality label drag
    const lab = await t.centre(`[data-edge-labels="${edgeId}"] [data-label="cardinality"]`);
    await t.drag(lab, { x: lab.x + 14, y: lab.y + 10 });
    const off = await t.page.evaluate((id) => {
      const st = (window as any).__sc.store.getState();
      return st.project.diagrams[st.activeDiagramId].edges[id].labelOffsets;
    }, edgeId);
    expect(off.cardinality).toBeDefined();
  });
});
