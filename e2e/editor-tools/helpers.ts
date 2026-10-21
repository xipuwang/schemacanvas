import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export type Which = 'chen' | 'rel' | 'relBare' | 'cf' | 'empty';
const SHOTS = '.tmp/editor-tools';
mkdirSync(SHOTS, { recursive: true });

export interface Pt {
  x: number;
  y: number;
}

export interface Tools {
  page: Page;
  errors: string[];
  canvas: Locator;
  open(which?: Which, query?: string): Promise<void>;
  /** DiagramNode id by displayed element name (entity / relationship / attribute / relation). */
  nodeId(name: string): Promise<string>;
  /** Column id by relation + column name (active diagram's model). */
  columnId(relation: string, column: string): Promise<string>;
  /** Client-space centre of an element matched by selector. */
  centre(sel: string): Promise<Pt>;
  nodeCentre(name: string): Promise<Pt>;
  cellCentre(relation: string, column: string): Promise<Pt>;
  /** Client-space centre of an overlay glyph (`data-handle` id or `data-port-id`). */
  handle(idStartsWith: string): Promise<Pt>;
  port(kind: 'connect' | 'add-attribute' | 'fk', nodeName?: string): Promise<Pt>;
  select(name: string): Promise<void>;
  state<T>(fn: (sc: any) => T): Promise<T>;
  drag(from: Pt, to: Pt, opts?: { steps?: number; release?: boolean; shift?: boolean }): Promise<void>;
  undoDepth(): Promise<number>;
  shot(name: string): Promise<void>;
}

export const test = base.extend<{ t: Tools }>({
  t: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
    const canvas = page.locator('.sc-canvas');
    const t: Tools = {
      page,
      errors,
      canvas,
      async open(which = 'chen', query = '') {
        await page.goto(`/harness/editor-tools/index.html${query}`);
        await page.waitForSelector('.sc-canvas');
        if (which !== 'chen') {
          await page.evaluate((w) => {
            const sc = (window as any).__sc;
            sc.store.getState().setActiveDiagram(sc.ids[w]);
          }, which);
        }
        if (which !== 'empty') await page.waitForSelector('[data-node-id]');
        await page.waitForTimeout(80);
      },
      async nodeId(name) {
        const id = await page.evaluate((n) => {
          const sc = (window as any).__sc;
          const s = sc.store.getState();
          const d = s.project.diagrams[s.activeDiagramId];
          const m = s.project.models[d.modelId];
          for (const [id, node] of Object.entries<any>(d.nodes)) {
            const ref = node.ref;
            const label = m.kind === 'er' ? (ref.kind === 'entity' ? m.entities[ref.id]?.name : ref.kind === 'relationship' ? m.relationships[ref.id]?.name : m.attributes[ref.id]?.name) : m.relations[ref.id]?.name;
            if (label === n) return id;
          }
          return null;
        }, name);
        if (!id) throw new Error(`no node ${name}`);
        return id;
      },
      async columnId(relation, column) {
        const id = await page.evaluate(([r, c]) => {
          const sc = (window as any).__sc;
          const s = sc.store.getState();
          const d = s.project.diagrams[s.activeDiagramId];
          const m = s.project.models[d.modelId];
          const rel = Object.values<any>(m.relations).find((x) => x.name === r);
          return rel?.columns.find((x: any) => x.name === c)?.id ?? null;
        }, [relation, column] as const);
        if (!id) throw new Error(`no column ${relation}.${column}`);
        return id;
      },
      async centre(sel) {
        const b = await page.locator(sel).first().boundingBox();
        if (!b) throw new Error(`no box for ${sel}`);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      },
      async nodeCentre(name) {
        const id = await t.nodeId(name);
        return t.centre(`[data-node-id="${id}"]`);
      },
      async cellCentre(relation, column) {
        const nid = await t.nodeId(relation);
        const cid = await t.columnId(relation, column);
        return t.centre(`[data-node-id="${nid}"] [data-column-id="${cid}"]`);
      },
      async handle(idStartsWith) {
        return t.centre(`[data-handle^="${idStartsWith}"]`);
      },
      async port(kind, nodeName) {
        const sel = nodeName ? `[data-port="${kind}"][data-port-id*="${await t.nodeId(nodeName)}"]` : `[data-port="${kind}"]`;
        return t.centre(sel);
      },
      async select(name) {
        const c = await t.nodeCentre(name);
        await page.mouse.click(c.x, c.y);
      },
      state: (fn) => page.evaluate((src) => new Function('sc', `return (${src})(sc)`)((window as any).__sc), fn.toString()) as never,
      async drag(from, to, opts = {}) {
        if (opts.shift) await page.keyboard.down('Shift');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const steps = opts.steps ?? 8;
        for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        if (opts.release !== false) {
          await page.mouse.up();
          if (opts.shift) await page.keyboard.up('Shift');
        }
      },
      undoDepth: () => page.evaluate(() => (window as any).__sc.store.getState().undoStack.length as number),
      async shot(name) {
        await page.screenshot({ path: `${SHOTS}/${name}.png` });
      },
    };
    await use(t);
    expect(errors, 'console errors / warnings').toEqual([]);
  },
});

export { expect };

/** Point on an FK edge's first stroked branch (client px), at fraction `f` of its length. */
export async function edgeClientPoint(page: Page, edgeId: string, f = 0.5): Promise<Pt> {
  return page.evaluate(
    ([id, frac]) => {
      const g = document.querySelector(`[data-edge-id="${id}"]`)!;
      const els = Array.from(g.querySelectorAll<SVGGeometryElement>('polyline,path,line')).filter((e) => e.getAttribute('stroke') && e.getAttribute('stroke-opacity') === null);
      const el = els[0]!;
      const p = el.getPointAtLength(el.getTotalLength() * (frac as number));
      const m = el.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    },
    [edgeId, f] as const,
  );
}

/** Every FK branch arrowhead touches the border of ITS referenced cell, within the cell's width. */
export async function expectArrowsOnCells(page: Page, minBranches = 1): Promise<void> {
  const checks = await page.evaluate(() => {
    const out: Array<{ branch: string; target: string; touches: boolean; within: boolean }> = [];
    for (const g of Array.from(document.querySelectorAll<SVGGElement>('[data-edge-id]'))) {
      for (const br of Array.from(g.querySelectorAll<SVGGElement>('[data-fk-branch]'))) {
        const target = br.getAttribute('data-fk-target')!;
        const cell = document.querySelector<SVGGraphicsElement>(`[data-node-id] [data-column-id="${target}"]`)!;
        const polygons = Array.from(br.querySelectorAll<SVGPolygonElement>('polygon'));
        const arrow = polygons[polygons.length - 1];
        if (!cell || !arrow) continue;
        const cb = cell.getBoundingClientRect();
        const ab = arrow.getBoundingClientRect();
        const near = (a: number, b: number): boolean => Math.abs(a - b) < 2.5;
        const cxm = ab.left + ab.width / 2;
        const cym = ab.top + ab.height / 2;
        const vertical = near(ab.bottom, cb.top) || near(ab.top, cb.bottom);
        const horizontal = near(ab.right, cb.left) || near(ab.left, cb.right);
        const touches = vertical || horizontal;
        // the arrow arrives perpendicular to the border it touches and lands within that border's extent
        const within = vertical ? cxm >= cb.left - 1 && cxm <= cb.right + 1 : cym >= cb.top - 1 && cym <= cb.bottom + 1;
        out.push({ branch: br.getAttribute('data-fk-branch')!, target, touches, within });
      }
    }
    return out;
  });
  expect(checks.length).toBeGreaterThanOrEqual(minBranches);
  for (const c of checks) {
    expect(c.touches, `arrow of ${c.branch} touches its target cell ${c.target}`).toBe(true);
    expect(c.within, `arrow of ${c.branch} within the width of ${c.target}`).toBe(true);
  }
}
