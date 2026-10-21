import { test as base, expect, type Locator, type Page } from '@playwright/test';

type Diagram = 'chen' | 'rel' | 'empty';

export interface Harness {
  page: Page;
  errors: string[];
  open(which?: Diagram, query?: string): Promise<void>;
  /** DiagramNode id of the node whose first label text equals `name`. */
  nodeId(name: string): Promise<string>;
  node(id: string): Locator;
  /** Client-space bounding box of a node element. */
  box(id: string): Promise<{ x: number; y: number; width: number; height: number }>;
  centre(id: string): Promise<{ x: number; y: number }>;
  /** Client point on an edge (middle of its first stroked path, in screen px). */
  edgePoint(edgeId: string): Promise<{ x: number; y: number }>;
  state<T>(fn: (sc: any) => T): Promise<T>;
  nodePos(id: string): Promise<{ x: number; y: number }>;
  selection(): Promise<string[]>;
  undoDepth(): Promise<number>;
  canvas: Locator;
  dragNode(id: string, dx: number, dy: number, opts?: { steps?: number; release?: boolean }): Promise<void>;
  shot(name: string): Promise<void>;
}

export const test = base.extend<{ h: Harness }>({
  h: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
    const canvas = page.locator('.sc-canvas');
    const h: Harness = {
      page,
      errors,
      canvas,
      async open(which = 'chen', query = '') {
        await page.goto(`/harness/editor/index.html${query}`);
        await page.waitForSelector('.sc-canvas');
        if (which !== 'chen') {
          await page.evaluate((w) => {
            const sc = (window as any).__sc;
            sc.store.getState().setActiveDiagram(sc.ids[w]);
          }, which);
        }
        if (which !== 'empty') await page.waitForSelector('[data-node-id]');
        // let the initial fit settle
        await page.waitForTimeout(60);
      },
      async nodeId(name) {
        const loc = page.locator('[data-node-id]', { has: page.locator('text', { hasText: new RegExp(`^${name}$`) }) }).first();
        const id = await loc.getAttribute('data-node-id');
        if (!id) throw new Error(`no node ${name}`);
        return id;
      },
      node: (id) => page.locator(`[data-node-id="${id}"]`),
      async box(id) {
        const b = await page.locator(`[data-node-id="${id}"]`).first().boundingBox();
        if (!b) throw new Error('no box');
        return b;
      },
      async centre(id) {
        const b = await h.box(id);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      },
      async edgePoint(edgeId) {
        return page.evaluate((id) => {
          const g = document.querySelector(`[data-edge-id="${id}"]`)!;
          const els = Array.from(g.querySelectorAll<SVGGeometryElement>('polyline,path,line')).filter((e) => e.getAttribute('stroke') && e.getAttribute('stroke-opacity') === null);
          const el = els[0]!;
          const len = el.getTotalLength();
          const p = el.getPointAtLength(len / 2);
          const m = el.getScreenCTM()!;
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        }, edgeId);
      },
      state: (fn) => page.evaluate((src) => new Function('sc', `return (${src})(sc)`)((window as any).__sc), fn.toString()) as never,
      async nodePos(id) {
        return page.evaluate((nid) => {
          const sc = (window as any).__sc;
          const s = sc.store.getState();
          const n = s.project.diagrams[s.activeDiagramId].nodes[nid];
          return { x: n.x, y: n.y };
        }, id);
      },
      async selection() {
        return page.evaluate(() => (window as any).__sc.store.getState().selection.ids as string[]);
      },
      async undoDepth() {
        return page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number);
      },
      async dragNode(id, dx, dy, opts = {}) {
        const c = await h.centre(id);
        // grab on the node's top-left quarter so we never hit an attribute / label overlap
        await page.mouse.move(c.x, c.y);
        await page.mouse.down();
        const steps = opts.steps ?? 8;
        for (let i = 1; i <= steps; i++) await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps);
        if (opts.release !== false) await page.mouse.up();
      },
      async shot(name) {
        await page.screenshot({ path: `.tmp/editor/${name}.png` });
      },
    };
    await use(h);
    expect(errors, 'console errors / warnings').toEqual([]);
  },
});

export { expect };
