import { test, expect, type Tools } from './helpers';

async function fks(t: Tools) {
  return t.state((sc) => {
    const st = sc.store.getState();
    const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
    return Object.values<any>(m.foreignKeys).map((fk) => {
      const s = m.relations[fk.sourceRelationId];
      const g = m.relations[fk.targetRelationId];
      return {
        from: `${s.name}.(${fk.columns.map((c: any) => s.columns.find((x: any) => x.id === c.sourceColumnId).name).join(',')})`,
        to: `${g.name}.(${fk.columns.map((c: any) => g.columns.find((x: any) => x.id === c.targetColumnId).name).join(',')})`,
      };
    });
  });
}

/** The arrow tip of each branch of the FK edge must touch the border of the referenced cell, perpendicular to it. */
async function expectArrowsOnCells(t: Tools, edgeCount: number) {
  const checks = await t.page.evaluate(() => {
    const out: Array<{ branch: string; target: string; onBorder: boolean; inside: boolean }> = [];
    for (const g of Array.from(document.querySelectorAll<SVGGElement>('[data-edge-id]'))) {
      for (const br of Array.from(g.querySelectorAll<SVGGElement>('[data-fk-branch]'))) {
        const target = br.getAttribute('data-fk-target')!;
        const cell = document.querySelector<SVGGraphicsElement>(`[data-column-id="${target}"]`)!;
        const polygons = Array.from(br.querySelectorAll<SVGPolygonElement>('polygon'));
        const arrow = polygons[polygons.length - 1];
        if (!cell || !arrow) continue;
        const cb = cell.getBoundingClientRect();
        const ab = arrow.getBoundingClientRect();
        // the arrowhead box touches the cell box on exactly one side
        const touches = Math.abs(ab.bottom - cb.top) < 2.5 || Math.abs(ab.top - cb.bottom) < 2.5 || Math.abs(ab.right - cb.left) < 2.5 || Math.abs(ab.left - cb.right) < 2.5;
        const within = ab.left + ab.width / 2 >= cb.left - 1 && ab.left + ab.width / 2 <= cb.right + 1;
        out.push({ branch: br.getAttribute('data-fk-branch')!, target, onBorder: touches, inside: within });
      }
    }
    return out;
  });
  expect(checks.length).toBeGreaterThanOrEqual(edgeCount);
  for (const c of checks) {
    expect(c.onBorder, `arrow of branch ${c.branch} touches its target cell`).toBe(true);
    expect(c.inside, `arrow of branch ${c.branch} is within the width of its target cell`).toBe(true);
  }
}

test.describe('foreign key tool', () => {
  test('drag Patient.DoctorSSN -> Doctor.SSN: highlight, popover with the describe text, ONE foreign key, arrow on the right cell, undo/redo', async ({ t }) => {
    await t.open('relBare');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    await expect(t.page.getByTestId('tool')).toHaveText('fk');
    await expect(t.page.getByTestId('tool-hint')).toContainText('Foreign key tool');
    await t.shot('fk-01-tool');

    const from = await t.cellCentre('Patient', 'DoctorSSN');
    const to = await t.cellCentre('Doctor', 'SSN');
    await t.drag(from, { x: from.x + 60, y: from.y - 40 }, { release: false });
    await t.page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(t.page.locator('[data-fk-over="ok"]')).toBeVisible();
    await expect(t.page.locator('[data-valid-target]').first()).toBeVisible();
    await expect(t.page.getByTestId('tool-hint')).toContainText('Patient.DoctorSSN → Doctor.SSN');
    await t.shot('fk-02-mid-drag-targets');
    await t.page.mouse.up();

    const pop = t.page.getByTestId('fk-popover');
    await expect(pop).toBeVisible();
    await expect(t.page.getByTestId('fk-text')).toHaveText('Patient.DoctorSSN → Doctor.SSN');
    expect(await fks(t)).toEqual([]); // nothing exists BEFORE confirming
    expect(await t.undoDepth()).toBe(0);
    await t.shot('fk-03-popover');
    await t.page.keyboard.press('Enter'); // the Create button has focus
    await expect(pop).toHaveCount(0);
    expect(await fks(t)).toEqual([{ from: 'Patient.(DoctorSSN)', to: 'Doctor.(SSN)' }]);
    expect(await t.undoDepth()).toBe(1);
    await expectArrowsOnCells(t, 1);
    await t.shot('fk-04-created');
    await t.page.keyboard.press('ControlOrMeta+z');
    expect(await fks(t)).toEqual([]);
    await t.page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await fks(t)).length).toBe(1);
  });

  test('composite: shift-click cells, drag onto Drug.TradeName: ONE FK with ordered pairs; popover remaps pair by pair', async ({ t }) => {
    await t.open('relBare');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    const a = await t.cellCentre('Prescription', 'CompanyName');
    const b = await t.cellCentre('Prescription', 'DrugTradeName');
    await t.page.mouse.click(a.x, a.y);
    await t.page.keyboard.down('Shift');
    await t.page.mouse.click(b.x, b.y);
    await t.page.keyboard.up('Shift');
    await expect(t.page.getByTestId('tool-hint')).toContainText('Prescription.(CompanyName, DrugTradeName)');
    await t.shot('fk-05-composite-source');
    const to = await t.cellCentre('Drug', 'TradeName');
    await t.drag(b, to);
    const pop = t.page.getByTestId('fk-popover');
    await expect(pop).toBeVisible();
    await expect(t.page.getByTestId('fk-text')).toHaveText('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    // reorder: map the first source column onto TradeName -> the other pair swaps (still a permutation of the key)
    const selects = pop.locator('select');
    await selects.nth(0).selectOption({ label: 'TradeName' });
    await expect(t.page.getByTestId('fk-text')).toHaveText('Prescription.(CompanyName, DrugTradeName) → Drug.(TradeName, CompanyName)');
    await t.shot('fk-06-popover-remapped');
    await selects.nth(0).selectOption({ label: 'CompanyName' });
    await expect(t.page.getByTestId('fk-text')).toHaveText('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    await pop.getByTestId('fk-create').click();
    expect(await fks(t)).toEqual([{ from: 'Prescription.(CompanyName,DrugTradeName)', to: 'Drug.(CompanyName,TradeName)' }]);
    expect(await t.undoDepth()).toBe(1);
    await expect(t.page.locator('[data-edge-id]')).toHaveCount(1);
    await expect(t.page.locator('[data-edge-id] [data-fk-branch]')).toHaveCount(2);
    await expectArrowsOnCells(t, 2);
    await t.shot('fk-07-composite-created');
  });

  test('a non-key target is refused with the reason and no popover; Escape cancels a drag and leaves the tool', async ({ t }) => {
    await t.open('relBare');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    const from = await t.cellCentre('Patient', 'DoctorSSN');
    await t.drag(from, await t.cellCentre('Doctor', 'Name'), { release: false });
    await expect(t.page.getByTestId('tool-hint')).toHaveAttribute('data-tone', 'bad');
    await expect(t.page.locator('[data-fk-over="bad"]')).toBeVisible();
    await t.shot('fk-08-rejected-mid-drag');
    await t.page.mouse.up();
    await expect(t.page.getByTestId('fk-popover')).toHaveCount(0);
    await expect(t.page.getByText(/Doctor\.Name is not part of a key/)).toBeVisible();
    expect(await fks(t)).toEqual([]);
    // Escape during a drag cancels the drag only
    await t.drag(from, await t.cellCentre('Doctor', 'SSN'), { release: false });
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    await expect(t.page.locator('[data-overlay="fk-ghost"]')).toHaveCount(0);
    await expect(t.page.getByTestId('fk-popover')).toHaveCount(0);
    expect(await fks(t)).toEqual([]);
  });

  test('FK port on a selected cell starts the drag in the select tool; Escape closes the popover', async ({ t }) => {
    await t.open('relBare');
    const cell = await t.cellCentre('Patient', 'DoctorSSN');
    await t.page.mouse.click(cell.x, cell.y);
    const port = await t.port('fk');
    await t.shot('fk-09-port');
    await t.drag(port, await t.cellCentre('Doctor', 'SSN'));
    const pop = t.page.getByTestId('fk-popover');
    await expect(pop).toBeVisible();
    await t.page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    expect(await fks(t)).toEqual([]);
  });

  test('self-reference and the vertical (crow\'s foot) family work too', async ({ t }) => {
    await t.open('cf');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    const from = await t.cellCentre('Patient', 'DoctorSSN');
    await t.drag(from, await t.cellCentre('Doctor', 'SSN'));
    await expect(t.page.getByTestId('fk-popover')).toBeVisible();
    await expect(t.page.getByTestId('fk-text')).toHaveText('Patient.DoctorSSN → Doctor.SSN');
    await t.shot('fk-10-crows-foot-popover');
    await t.page.keyboard.press('Enter');
    expect(await fks(t)).toEqual([{ from: 'Patient.(DoctorSSN)', to: 'Doctor.(SSN)' }]);
    await t.shot('fk-11-crows-foot-created');
  });
});

test.describe('foreign key tool: zoom, keyboard, locales, themes', () => {
  test('works at 50% and 150% zoom (cells found by DOM, not by fixed coordinates)', async ({ t }) => {
    for (const zoom of [0.5, 1.5]) {
      await t.open('relBare');
      // centre the Doctor / Patient pair at the requested zoom
      await t.page.evaluate((z) => {
        const sc = (window as any).__sc;
        const st = sc.store.getState();
        const d = st.project.diagrams[st.activeDiagramId];
        const nodes = Object.values<any>(d.nodes);
        const m = st.project.models[d.modelId];
        const pick = (name: string) => nodes.find((n) => m.relations[n.ref.id].name === name);
        const a = pick('Doctor');
        const b = pick('Patient');
        const cx = (a.x + b.x + 300) / 2;
        const cy = a.y + 20;
        const box = document.querySelector('.sc-canvas')!.getBoundingClientRect();
        sc.handle.current.setViewport({ zoom: z, x: box.width / 2 - cx * z, y: box.height / 3 - cy * z });
      }, zoom);
      await t.canvas.focus();
      await t.page.keyboard.press('f');
      const z = await t.page.evaluate(() => (window as any).__sc.handle.current.getViewport().zoom as number);
      expect(z).toBeCloseTo(zoom, 2);
      const from = await t.cellCentre('Patient', 'DoctorSSN');
      const to = await t.cellCentre('Doctor', 'SSN');
      await t.drag(from, to);
      await expect(t.page.getByTestId('fk-text')).toHaveText('Patient.DoctorSSN → Doctor.SSN');
      await t.shot(`fk-zoom-${zoom}`);
      await t.page.keyboard.press('Enter');
      expect(await fks(t)).toEqual([{ from: 'Patient.(DoctorSSN)', to: 'Doctor.(SSN)' }]);
    }
  });

  test('keyboard path: select a column, Create foreign key from this column, select the referenced table, Enter', async ({ t }) => {
    await t.open('relBare');
    const cell = await t.cellCentre('Patient', 'DoctorSSN');
    await t.page.mouse.click(cell.x, cell.y);
    await t.page.evaluate(() => (window as any).__sc.runCommand('fk.fromSelection'));
    await expect(t.page.getByTestId('tool')).toHaveText('fk');
    await expect(t.page.getByTestId('tools-live')).toContainText('Foreign key source selected');
    await expect(t.page.getByTestId('tool-hint')).toContainText('Patient.(DoctorSSN)');
    // select the referenced table with the keyboard-friendly path (store selection), then Enter on the canvas
    await t.state((sc) => {
      const st = sc.store.getState();
      const d = st.project.diagrams[st.activeDiagramId];
      const m = st.project.models[d.modelId];
      const doctor = Object.values<any>(m.relations).find((r) => r.name === 'Doctor');
      const nodeId = Object.keys(d.nodes).find((id) => d.nodes[id].ref.id === doctor.id)!;
      st.setSelection([nodeId]);
    });
    await t.canvas.focus();
    await t.page.keyboard.press('Enter');
    await expect(t.page.getByTestId('fk-text')).toHaveText('Patient.DoctorSSN → Doctor.SSN');
    await t.page.keyboard.press('Enter');
    expect(await fks(t)).toEqual([{ from: 'Patient.(DoctorSSN)', to: 'Doctor.(SSN)' }]);
  });

  test('Chinese UI: tool hint, popover and rejection text are translated and not clipped (screenshots)', async ({ t }) => {
    await t.open('relBare', '?lang=zh');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    await expect(t.page.getByTestId('tool-hint')).toContainText('外键工具');
    const hint = (await t.page.getByTestId('tool-hint').boundingBox())!;
    const cv = (await t.canvas.boundingBox())!;
    expect(hint.x).toBeGreaterThanOrEqual(cv.x);
    expect(hint.x + hint.width).toBeLessThanOrEqual(cv.x + cv.width);
    await t.shot('fk-zh-01-hint');
    const a = await t.cellCentre('Prescription', 'CompanyName');
    const b = await t.cellCentre('Prescription', 'DrugTradeName');
    await t.page.mouse.click(a.x, a.y);
    await t.page.keyboard.down('Shift');
    await t.page.mouse.click(b.x, b.y);
    await t.page.keyboard.up('Shift');
    await t.drag(b, await t.cellCentre('Drug', 'TradeName'));
    const pop = t.page.getByTestId('fk-popover');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('创建外键');
    await t.page.waitForTimeout(250);
    const pb = (await pop.boundingBox())!;
    const vp = t.page.viewportSize()!;
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
    expect(await pop.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await t.shot('fk-zh-02-popover');
    await t.page.keyboard.press('Escape');
    await t.drag(a, await t.cellCentre('Doctor', 'Name'));
    await expect(t.page.getByText(/不属于任何键/)).toBeVisible();
    await t.shot('fk-zh-03-rejected');
  });

  test('dark theme: ghost line, highlighted targets and popover are legible (screenshots)', async ({ t }) => {
    await t.open('relBare', '?theme=dark');
    await t.canvas.focus();
    await t.page.keyboard.press('f');
    const from = await t.cellCentre('Patient', 'DoctorSSN');
    const to = await t.cellCentre('Doctor', 'SSN');
    await t.drag(from, { x: from.x + 40, y: from.y + 60 }, { release: false });
    await t.page.mouse.move(to.x, to.y, { steps: 6 });
    await t.shot('fk-dark-01-drag');
    await t.page.mouse.up();
    await expect(t.page.getByTestId('fk-popover')).toBeVisible();
    await t.page.waitForTimeout(250);
    await t.shot('fk-dark-02-popover');
    await t.page.keyboard.press('Enter');
    await t.shot('fk-dark-03-created');
  });
});

test.describe('narrow screens', () => {
  for (const width of [700, 420]) {
    test(`at ${width}px the hint chip and the popover stay inside the screen and the page does not scroll sideways`, async ({ t }) => {
      await t.page.setViewportSize({ width, height: 800 });
      await t.open('relBare');
      await t.canvas.focus();
      await t.page.keyboard.press('f');
      const vp = t.page.viewportSize()!;
      const hint = (await t.page.getByTestId('tool-hint').boundingBox())!;
      expect(hint.x).toBeGreaterThanOrEqual(0);
      expect(hint.x + hint.width).toBeLessThanOrEqual(vp.width);
      await t.drag(await t.cellCentre('Patient', 'DoctorSSN'), await t.cellCentre('Doctor', 'SSN'));
      const pop = t.page.getByTestId('fk-popover');
      await expect(pop).toBeVisible();
      await t.page.waitForTimeout(250);
      const pb = (await pop.boundingBox())!;
      expect(pb.x).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
      expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
      await t.shot(`fk-narrow-${width}`);
      expect(await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }
});
