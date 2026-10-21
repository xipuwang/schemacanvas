/**
 * SA-04 in the real app: dragging a connector midpoint creates a corner AT the pointer, the live preview is the committed
 * route, and every bend handle sits ON the drawn line.
 */
import { test, expect, edgeClientPoint, type Tools } from '../editor-tools/helpers';
import type { Page } from '@playwright/test';

interface Pt {
  x: number;
  y: number;
}

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

/** Stroked branch polylines of an edge in client px (hit-test helpers, which carry a stroke-opacity, are skipped). */
const drawn = (page: Page, edgeId: string): Promise<Pt[][]> =>
  page.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${id}"]`)!;
    return Array.from(g.querySelectorAll<SVGPolylineElement>('polyline'))
      .filter((e) => e.getAttribute('stroke') && e.getAttribute('stroke-opacity') === null)
      .map((e) => {
        const m = e.getScreenCTM()!;
        return Array.from(e.points).map((p) => ({ x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }));
      });
  }, edgeId);

const handles = (page: Page, prefix: string): Promise<Pt[]> =>
  page.evaluate((pre) => Array.from(document.querySelectorAll<SVGElement>(`[data-handle^="${pre}"]`)).map((h) => {
    const b = h.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }), prefix);

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
  }
  return best;
}

const route = (t: Tools, id: string) => t.page.evaluate((e) => {
  const st = (window as any).__sc.store.getState();
  return st.project.diagrams[st.activeDiagramId].edges[e].route;
}, id);

for (const [source, target, composite] of [['Patient', 'Doctor', false], ['Prescription', 'Drug', true]] as const) {
  test(`${source} -> ${target}: a dragged midpoint becomes a corner at the pointer; preview == commit; handles lie on the line`, async ({ t }) => {
    await t.open('rel');
    const id = await edgeOf(t, source, target);
    const p0 = await edgeClientPoint(t.page, id, 0.5);
    await t.page.mouse.click(p0.x, p0.y);
    await expect(t.page.locator('[data-handle^="mid:"]').first()).toBeVisible();
    // alt = no grid snapping, so the corner must be exactly where the pointer is released
    await t.page.keyboard.down('Alt');
    // the mid handle of the longest segment (most room to move)
    const mids = await handles(t.page, 'mid:');
    const mid = mids[Math.floor(mids.length / 2)]!;
    // a composite bundle between close tables leaves little room between its stub ends: stay inside it
    const drop = composite ? { x: mid.x + 37, y: mid.y - 6 } : { x: mid.x + 37, y: mid.y + 29 };
    await t.drag(mid, drop, { release: false });
    const preview = await drawn(t.page, id);
    await t.shot(`htable-bend-${source}-preview`);
    await t.page.mouse.up();
    await t.page.keyboard.up('Alt');
    await t.page.waitForTimeout(150);
    const committed = await drawn(t.page, id);
    await t.shot(`htable-bend-${source}-committed`);

    // preview == commit (a composite's two jogs next to the stubs may be nudged off other connectors; the lanes are equal)
    expect(preview.length).toBe(committed.length);
    preview.forEach((pv, i) => {
      const cm = committed[i]!;
      expect(pv.length).toBe(cm.length);
      const a = composite ? pv.slice(3, -3) : pv;
      const b = composite ? cm.slice(3, -3) : cm;
      a.forEach((q, k) => {
        expect(Math.abs(q.x - b[k]!.x), `preview x of vertex ${k}`).toBeLessThan(0.75);
        expect(Math.abs(q.y - b[k]!.y), `preview y of vertex ${k}`).toBeLessThan(0.75);
      });
    });

    // the bend is a stored corner exactly at the pointer (world coordinates: compare through the drawn line in client px)
    const r = await route(t, id);
    expect(r.mode).toBe('manual');
    const bends = await handles(t.page, 'bend:');
    expect(bends.length).toBe(r.waypoints.length);
    expect(bends.some((b) => Math.hypot(b.x - drop.x, b.y - drop.y) < 1), 'a bend handle sits at the drop point').toBe(true);

    // every bend handle lies on the drawn line: the first branch for a single connector, the bundle centre (between the lanes) for a composite
    for (const b of bends) {
      const d = Math.min(...committed.map((pts) => distToPolyline(b, pts)));
      expect(d, `bend handle off the line by ${d.toFixed(2)} px`).toBeLessThanOrEqual(composite ? 8 : 1);
    }
    if (!composite) expect(distToPolyline(drop, committed[0]!)).toBeLessThanOrEqual(1);
  });
}
