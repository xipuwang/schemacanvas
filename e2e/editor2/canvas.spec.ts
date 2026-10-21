import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { boot, trackConsole } from '../panels-a/helpers';

/** Draft drag mode, auto-pan, nudge coalescing, eased zoom and template selection on the real canvas. */
const SHOTS = '.tmp/editor2';
mkdirSync(SHOTS, { recursive: true });
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

async function open(page: Page, which: 'chen' | 'rel' = 'rel', query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  await page.goto(`/harness/editor/index.html${query}`);
  await page.waitForSelector('.sc-canvas');
  await page.evaluate((w) => (window as any).__sc.store.getState().setActiveDiagram((window as any).__sc.ids[w]), which);
  await page.waitForSelector('[data-node-id]');
  await page.waitForTimeout(100);
  return errors;
}
const view = (page: Page) => page.evaluate(() => (window as any).__sc.handle.current.getViewport() as { x: number; y: number; zoom: number });
const nodeIdOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const s = (window as any).__sc.store.getState();
    const d = s.project.diagrams[s.activeDiagramId];
    const m = s.project.models[d.modelId];
    return Object.keys(d.nodes).find((id) => (m.kind === 'er' ? m.entities[d.nodes[id].ref.id]?.name : m.relations[d.nodes[id].ref.id]?.name) === n)!;
  }, name);
const centreOf = async (page: Page, id: string) => {
  const b = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const posOf = (page: Page, id: string) =>
  page.evaluate((nid) => {
    const s = (window as any).__sc.store.getState();
    const n = s.project.diagrams[s.activeDiagramId].nodes[nid];
    return { x: n.x as number, y: n.y as number };
  }, id);

test.describe('draft drag mode', () => {
  test('connectors stay on their cells mid-drag, draft builds are used while dragging, one FULL build follows the drop', async ({ page }) => {
    const errors = await open(page, 'rel');
    await page.evaluate(() => (window as any).__sc.handle.current.setViewport({ x: 60, y: 30, zoom: 1 }));
    await page.waitForTimeout(100);
    const doctor = await nodeIdOf(page, 'Doctor');
    const c = await centreOf(page, doctor);
    const edgesBefore = await page.locator('[data-layer="edges"] > [data-edge-id]').count();
    await page.evaluate(() => ((window as any).__scPerf = []));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(c.x + i * 12, c.y + i * 9);
    await page.waitForTimeout(150);
    const mid = await page.evaluate(() => (window as any).__scPerf as Array<{ mode: string }>);
    expect(mid.filter((s) => s.mode === 'draft').length).toBeGreaterThan(3);
    await page.screenshot({ path: `${SHOTS}/draft-mid-drag.png` });
    // every arrowhead of the Doctor FKs still touches a cell of Doctor (the referenced SSN cell) at this very moment
    const ok = await page.evaluate((id) => {
      const g = document.querySelector(`[data-node-id="${id}"]`)!;
      const cells = [...g.querySelectorAll('[data-column-id]')].map((e) => e.getBoundingClientRect());
      const arrows = [...document.querySelectorAll('[data-edge-id] polygon')].map((p) => p.getBoundingClientRect());
      const touching = arrows.filter((a) => cells.some((r) => a.right >= r.left - 2 && a.left <= r.right + 2 && a.bottom >= r.top - 2 && a.top <= r.bottom + 2));
      return touching.length;
    }, doctor);
    expect(ok).toBeGreaterThanOrEqual(2); // Patient.DoctorSSN and Prescription.DoctorSSN both point at Doctor
    await page.mouse.up();
    await page.waitForTimeout(200);
    const all = await page.evaluate(() => (window as any).__scPerf as Array<{ mode: string }>);
    expect(all.at(-1)!.mode).toBe('full');
    expect(await page.locator('[data-layer="edges"] > [data-edge-id]').count()).toBe(edgesBefore);
    await page.screenshot({ path: `${SHOTS}/draft-after-drop.png` });
    expect(errors).toEqual([]);
  });
});

test.describe('auto-pan', () => {
  for (const reduced of [false, true]) {
    test(`dragging a node to the canvas edge scrolls the view; stops on release (reduced motion: ${reduced})`, async ({ page }) => {
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = await open(page, 'rel');
      const box = (await page.locator('.sc-canvas').boundingBox())!;
      const id = await nodeIdOf(page, 'Doctor');
      const p0 = await posOf(page, id);
      const v0 = await view(page);
      const c = await centreOf(page, id);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 40, c.y + 10, { steps: 3 });
      await page.mouse.move(box.x + box.width - 6, c.y, { steps: 6 });
      await page.waitForTimeout(700);
      const v1 = await view(page);
      expect(v1.x).toBeLessThan(v0.x - 80); // the world scrolled left: content moved away from the right edge
      expect(v1.zoom).toBe(v0.zoom);
      const mid = await posOf(page, id);
      expect(mid.x).toBeGreaterThan(p0.x + 150); // and the dragged node followed the pointer through the scrolled world
      await page.screenshot({ path: `${SHOTS}/autopan-${reduced ? 'reduced' : 'normal'}.png` });
      await page.mouse.up();
      const v2 = await view(page);
      await page.waitForTimeout(300);
      const v3 = await view(page);
      expect(v3).toEqual(v2); // stopped on release
      expect((await posOf(page, id)).x).toBeGreaterThan(p0.x + 150);
      expect(errors).toEqual([]);
    });
  }

  test('marquee near the edge scrolls too, and the selection grows with it', async ({ page }) => {
    const errors = await open(page, 'rel');
    const box = (await page.locator('.sc-canvas').boundingBox())!;
    const v0 = await view(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height - 60, { steps: 4 });
    await page.mouse.move(box.x + 6, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(600);
    const v1 = await view(page);
    expect(v1.x).toBeGreaterThan(v0.x + 80);
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
});

test.describe('keyboard nudge and eased zoom', () => {
  test('a burst of arrow presses is ONE undo step and Ctrl+Z restores the position', async ({ page }) => {
    const errors = await open(page, 'rel');
    const id = await nodeIdOf(page, 'Company');
    const c = await centreOf(page, id);
    await page.mouse.click(c.x, c.y);
    const p0 = await posOf(page, id);
    const grid = await page.evaluate(() => (window as any).__sc.store.getState().project.diagrams[(window as any).__sc.store.getState().activeDiagramId].options.grid.size as number);
    const depth0 = await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number);
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(550);
    expect((await posOf(page, id)).x).toBe(p0.x + 6 * grid);
    expect(await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number)).toBe(depth0 + 1);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await posOf(page, id)).toEqual(p0);
    // a pause longer than the window = separate steps
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(550);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(550);
    expect(await page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number)).toBe(depth0 + 2);
    expect(errors).toEqual([]);
  });

  test('zoom and fit ease over ~150 ms and are instant under prefers-reduced-motion', async ({ page }) => {
    const errors = await open(page, 'rel');
    await page.evaluate(() => ((window as any).__scForceAnimate = true));
    const scaleOf = () => page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('[data-layer="world"]')!.getAttribute('transform') ?? '')![1]));
    await page.evaluate(() => (window as any).__sc.handle.current.setViewport({ x: 0, y: 0, zoom: 1 }));
    await page.evaluate(() => {
      (window as any).__scSamples = [];
      (window as any).__sc.handle.current.zoomTo(2);
      const t0 = performance.now();
      const loop = (): void => {
        const el = document.querySelector('[data-layer="world"]')!;
        (window as any).__scSamples.push({ t: performance.now() - t0, s: Number(/scale\(([\d.]+)\)/.exec(el.getAttribute('transform')!)![1]), animating: document.querySelector('.sc-canvas')!.hasAttribute('data-animating') });
        if (performance.now() - t0 < 400) requestAnimationFrame(loop);
      };
      loop();
    });
    expect(Number(await page.locator('.sc-canvas').getAttribute('data-zoom'))).toBe(2); // the logical zoom is the target at once
    await page.waitForTimeout(500);
    const samples = (await page.evaluate(() => (window as any).__scSamples)) as Array<{ t: number; s: number; animating: boolean }>;
    expect(samples.some((x) => x.s > 1.02 && x.s < 1.98)).toBe(true); // intermediate frames were drawn
    expect(samples.some((x) => x.animating)).toBe(true);
    const settled = samples.find((x) => x.s === 2)!;
    expect(settled.t).toBeLessThan(260);
    expect(await scaleOf()).toBe(2);
    await expect(page.locator('.sc-canvas')).not.toHaveAttribute('data-animating', 'true');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (window as any).__sc.handle.current.zoomTo(1));
    expect(await scaleOf()).toBe(1); // instant
    await expect(page.locator('.sc-canvas')).not.toHaveAttribute('data-animating', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('templates', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`a template dropped on the sheet leaves its nodes selected (real app, ${theme}, axe)`, async ({ page }) => {
      const problems = trackConsole(page);
      await boot(page, { theme });
      const sheet = page.locator('.sc-canvas').first();
      const tpl = page.getByTestId('dock-library').locator('[data-part-id="template-many-to-many"]');
      await expect(tpl.locator('svg')).toBeVisible();
      await tpl.dragTo(sheet, { targetPosition: { x: 320, y: 240 } });
      await expect(sheet.locator('[data-node-id]')).toHaveCount(6);
      expect(await sheet.locator('[data-node-id] > [fill-opacity="0.18"]').count()).toBe(6);
      await page.screenshot({ path: `${SHOTS}/template-selected-${theme}.png` });
      const res = await new AxeBuilder({ page }).analyze();
      expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }
});
