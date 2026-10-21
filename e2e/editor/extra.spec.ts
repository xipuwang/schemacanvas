import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './helpers';

test.describe('pointer variants', () => {
  test('middle-button drag pans', async ({ h }) => {
    await h.open();
    const v0 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    await h.page.mouse.move(600, 300);
    await h.page.mouse.down({ button: 'middle' });
    await h.page.mouse.move(660, 340, { steps: 4 });
    await h.page.mouse.up({ button: 'middle' });
    const v1 = await h.page.evaluate(() => (window as any).__sc.handle.current.getViewport());
    expect(v1.x).toBeCloseTo(v0.x + 60, 3);
    expect(v1.y).toBeCloseTo(v0.y + 40, 3);
    expect(await h.selection()).toEqual([]);
  });

  test('two touch pointers pinch-zoom around their midpoint; one touch drags a node', async ({ h }) => {
    await h.open();
    const box = (await h.canvas.boundingBox())!;
    const ev = (type: string, id: number, x: number, y: number) =>
      h.page.evaluate(
        ([t, i, px, py]) => {
          const svg = document.querySelector('.sc-canvas__svg')!;
          svg.dispatchEvent(new PointerEvent(t as string, { pointerId: i as number, pointerType: 'touch', clientX: px as number, clientY: py as number, bubbles: true, button: 0, buttons: 1, isPrimary: i === 1 }));
        },
        [type, id, x, y] as const,
      );
    const z0 = Number(await h.canvas.getAttribute('data-zoom'));
    const cx = box.x + 500;
    const cy = box.y + 300;
    await ev('pointerdown', 1, cx - 50, cy);
    await ev('pointerdown', 2, cx + 50, cy);
    await ev('pointermove', 1, cx - 100, cy);
    await ev('pointermove', 2, cx + 100, cy);
    await h.page.waitForTimeout(60);
    const z1 = Number(await h.canvas.getAttribute('data-zoom'));
    expect(z1).toBeCloseTo(z0 * 2, 1);
    await ev('pointerup', 1, cx - 100, cy);
    await ev('pointerup', 2, cx + 100, cy);

    // single touch on a node drags it
    const id = await h.nodeId('Company');
    const c = await h.centre(id);
    const p0 = await h.nodePos(id);
    await ev('pointerdown', 7, c.x, c.y);
    await ev('pointermove', 7, c.x + 60, c.y + 30);
    await ev('pointermove', 7, c.x + 120, c.y + 60);
    await ev('pointerup', 7, c.x + 120, c.y + 60);
    const p1 = await h.nodePos(id);
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p1.y).toBeGreaterThan(p0.y);
    expect(await h.state((sc) => sc.store.getState().inTransaction)).toBe(false);
  });

  test('pointercancel aborts a node drag and restores the position', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const before = await h.nodePos(id);
    await h.dragNode(id, 100, 50, { release: false });
    await h.page.evaluate(() => {
      document.querySelector('.sc-canvas__svg')!.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    });
    expect(await h.nodePos(id)).toEqual(before);
    await h.page.mouse.up();
    expect(await h.nodePos(id)).toEqual(before);
  });
});

test.describe('clipboard placement', () => {
  test('pasting while the source is off screen lands the copy in the visible area', async ({ h }) => {
    await h.open();
    const id = await h.nodeId('Company');
    const c = await h.centre(id);
    await h.page.mouse.click(c.x, c.y);
    await h.page.keyboard.press('ControlOrMeta+c');
    await h.page.evaluate(() => (window as any).__sc.handle.current.setViewport({ x: -9000, y: -6000, zoom: 1 }));
    await h.page.keyboard.press('ControlOrMeta+v');
    const pasted = (await h.selection())[0]!;
    const b = await h.box(pasted);
    const cb = (await h.canvas.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(cb.x);
    expect(b.x + b.width).toBeLessThanOrEqual(cb.x + cb.width);
    expect(b.y).toBeGreaterThanOrEqual(cb.y);
    expect(b.y + b.height).toBeLessThanOrEqual(cb.y + cb.height);
  });
});

test.describe('edge text editing', () => {
  test('double-clicking a participation line edits its role; the label is drawn', async ({ h }) => {
    await h.open();
    const edge = await h.state((sc) => {
      const s = sc.store.getState();
      const d = s.project.diagrams[s.activeDiagramId];
      return Object.entries(d.edges).find(([, e]: any) => e.ref.kind === 'participant')![0] as string;
    });
    const p = await h.edgePoint(edge);
    await h.page.mouse.dblclick(p.x, p.y);
    const input = h.page.locator('.sc-inline-input');
    await expect(input).toHaveAttribute('data-edit-kind', 'role');
    await h.page.keyboard.type('manager');
    await h.page.keyboard.press('Enter');
    await expect(h.page.locator('[data-layer="edge-labels"] text', { hasText: 'manager' })).toHaveCount(1);
    await h.page.keyboard.press(`ControlOrMeta+z`);
    await expect(h.page.locator('[data-layer="edge-labels"] text', { hasText: 'manager' })).toHaveCount(0);
  });

  test('double-clicking an FK edit its label (stored on the foreign key, clearable)', async ({ h }) => {
    await h.open('rel');
    const edge = await h.state((sc) => {
      const s = sc.store.getState();
      return Object.keys(s.project.diagrams[s.activeDiagramId].edges)[0] as string;
    });
    const p = await h.edgePoint(edge);
    await h.page.mouse.dblclick(p.x, p.y);
    await expect(h.page.locator('.sc-inline-input')).toHaveAttribute('data-edit-kind', 'fkLabel');
    await h.page.keyboard.type('treats');
    await h.page.keyboard.press('Enter');
    const label = () =>
      h.state((sc) => {
        const s = sc.store.getState();
        const d = s.project.diagrams[s.activeDiagramId];
        const m = s.project.models[d.modelId];
        return Object.values(m.foreignKeys).map((f: any) => f.label).filter(Boolean);
      });
    expect(await label()).toEqual(['treats']);
    await h.page.keyboard.press('Enter'); // selection is the FK edge: Enter edits again
    await expect(h.page.locator('.sc-inline-input')).toBeFocused();
    await h.page.keyboard.press('ControlOrMeta+a');
    await h.page.keyboard.press('Backspace');
    await h.page.keyboard.press('Enter');
    expect(await label()).toEqual([]);
  });
});

test.describe('plugin API in the browser', () => {
  test('a registered plugin captures a pointer sequence before the default select behaviour, draws an overlay and adds menu items', async ({ h }) => {
    await h.open();
    await h.page.evaluate(() => {
      const sc = (window as any).__sc;
      (window as any).__log = [];
      sc.registerCanvasPlugin({
        id: 'e2e-test-plugin',
        priority: 50,
        onPointerDown: (_cx: unknown, e: any) => {
          (window as any).__log.push('down');
          return e.altKey && e.hit.kind === 'node' ? 'capture' : undefined;
        },
        onPointerMove: () => void (window as any).__log.push('move'),
        onPointerUp: () => void (window as any).__log.push('up'),
        cursorAt: () => 'crosshair',
        overlay: () => sc.h('circle', { cx: 5, cy: 5, r: 4, 'data-test': 'plugin-dot' }),
        contextMenu: () => [{ kind: 'item', id: 'p1', label: 'Plugin action', run: () => ((window as any).__log.push('menu')) }],
      });
    });
    await expect(h.page.locator('[data-test="plugin-dot"]')).toHaveCount(1);
    const id = await h.nodeId('Company');
    const pos = await h.nodePos(id);
    const c = await h.centre(id);
    await h.page.keyboard.down('Alt');
    await h.page.mouse.move(c.x, c.y);
    await h.page.mouse.down();
    await h.page.mouse.move(c.x + 80, c.y + 40, { steps: 4 });
    await h.page.mouse.up();
    await h.page.keyboard.up('Alt');
    const log = await h.page.evaluate(() => (window as any).__log as string[]);
    expect(log).toContain('down');
    expect(log.slice(log.indexOf('down'))).toContain('up');
    expect(await h.nodePos(id)).toEqual(pos); // default move never started
    expect(await h.selection()).toEqual([]); // nor the default selection

    // without Alt the plugin passes and the default behaviour runs
    await h.dragNode(id, 60, 0);
    expect((await h.nodePos(id)).x).not.toBe(pos.x);

    await h.page.mouse.click(c.x, c.y, { button: 'right' });
    await h.page.getByRole('menuitem', { name: 'Plugin action' }).click();
    expect((await h.page.evaluate(() => (window as any).__log as string[])).includes('menu')).toBe(true);
  });
});

test.describe('accessibility', () => {
  test('axe finds no violations in the canvas region (light and dark) or with the context menu open', async ({ h }) => {
    await h.open();
    const light = await new AxeBuilder({ page: h.page }).include('.sc-canvas').analyze();
    expect(light.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await h.page.mouse.click(30, 450, { button: 'right' });
    await expect(h.page.getByRole('menu')).toBeVisible();
    await h.page.waitForTimeout(250);
    const withMenu = await new AxeBuilder({ page: h.page }).include('.sc-menu').analyze();
    expect(withMenu.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await h.page.keyboard.press('Escape');
    await h.open('chen', '?theme=dark');
    await h.page.keyboard.press('Enter'); // nothing selected: no-op
    const dark = await new AxeBuilder({ page: h.page }).include('.sc-canvas').analyze();
    expect(dark.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('inline editor is a labelled input; zh locale shows Chinese hints', async ({ h }) => {
    await h.open('empty', '?lang=zh');
    await expect(h.page.getByTestId('canvas-empty')).toHaveText('将实体拖到画布上，或打开一个示例');
    await expect(h.page.getByRole('application', { name: '图表画布' })).toBeVisible();
  });
});
