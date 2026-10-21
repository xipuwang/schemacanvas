/**
 * SA-04 geometric contract of manual connector editing on the horizontal schema, driven through the REAL scene builder:
 *  - a bend handle lies ON the drawn line (<= 0.5 px) for every drag,
 *  - an inserted bend is a corner at the pointer,
 *  - the drag PREVIEW (draft scene build) equals the committed (full build) geometry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import type { Diagram, Point } from '@/model/types';
import { defaultMeasure } from '@/scene/measure';
import { buildHorizontalScene } from '@/scene/horizontal';
import { pharmacyFixture, tangledFixture, type Fixture } from '@/scene/horizontal/fixtures';
import type { FkEdgeGeom } from '@/scene/horizontal/types';
import type { Scene } from '@/scene/types';
import { insertBendPolyline, interiorVertices, locateWaypoints, moveCornerPolyline, tidyPolyline } from './routeEdit';

let restore = () => {};
afterEach(() => restore());

function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
const isCorner = (p: Point, pts: Point[]): boolean => pts.slice(1, -1).some((q, i) => Math.hypot(q.x - p.x, q.y - p.y) < 0.01 && (pts[i]!.x !== pts[i + 2]!.x && pts[i]!.y !== pts[i + 2]!.y));
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const build = (f: Fixture, diagram: Diagram, quality?: 'draft', previous?: { scene: Scene; diagram: Diagram }): Scene =>
  buildHorizontalScene({ project: f.project, diagram, model: f.model, measure: defaultMeasure, quality, previous: previous ? { ...previous, model: f.model } : undefined });

/** Same diagram with `edgeId`'s route replaced (every other object keeps its identity, so a draft build reuses it). */
const withRoute = (d: Diagram, edgeId: string, route: Diagram['edges'][string]['route']): Diagram => ({ ...d, edges: { ...d.edges, [edgeId]: { ...d.edges[edgeId]!, route } } });

const SNAP = 10;
const snap = (p: Point, on: boolean): Point => (on ? { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP } : p);

function runDrags(mk: () => Fixture, seed: number, trials: number, snapOn: boolean) {
  const rnd = rng(seed);
  const f = mk();
  const edgeIds = Object.keys(f.diagram.edges);
  let checked = 0;
  for (const eid of edgeIds) {
    for (let trial = 0; trial < trials; trial++) {
      const base = build(f, f.diagram);
      const g0 = base.edges[eid] as FkEdgeGeom;
      const poly = g0.centreline!;
      const seg = Math.floor(rnd() * (poly.length - 1));
      const a = poly[seg]!;
      const b = poly[seg + 1]!;
      // a pointer in the free neighbourhood of the segment (the usual drag); the first / last segment keeps its stub
      const raw = { x: (a.x + b.x) / 2 + (rnd() - 0.5) * 240, y: (a.y + b.y) / 2 + (rnd() - 0.5) * 240 };
      const p = snap(raw, snapOn);
      const ins = insertBendPolyline(poly, seg, p);
      const wps = interiorVertices(ins.poly);
      const route = { ...f.diagram.edges[eid]!.route, mode: 'manual' as const, waypoints: wps };
      const d1 = withRoute(f.diagram, eid, route);
      const full = build(f, d1).edges[eid] as FkEdgeGeom;
      const draft = build(f, d1, 'draft', { scene: base, diagram: f.diagram }).edges[eid] as FkEdgeGeom;
      const ctx = `${eid} seg${seg}/${poly.length - 1} n=${g0.branches.length} p=${JSON.stringify(p)}`;
      // no spike: the drawn centreline never runs back over itself (a bend dropped inside a table is pushed outside the stub)
      for (let i = 1; i + 1 < full.centreline!.length; i++) {
        const q0 = full.centreline![i - 1]!, q1 = full.centreline![i]!, q2 = full.centreline![i + 1]!;
        expect((q1.x - q0.x) * (q2.x - q1.x) + (q1.y - q0.y) * (q2.y - q1.y), `spike at vertex ${i} ${ctx}`).toBeGreaterThanOrEqual(-1e-6);
      }
      // handles on the drawn line
      for (const h of full.bendHandles) expect(distToPolyline(h.at, full.centreline!), `handle ${ctx}`).toBeLessThanOrEqual(0.5);
      // the bend is a corner of the drawn line (or at least ON it where the stub rule moved it) at the pointer
      expect(distToPolyline(ins.bend, full.centreline!), `bend on line ${ctx}`).toBeLessThanOrEqual(0.5);
      const clear = Math.abs(ins.bend.x - p.x) < 1e-9 && Math.abs(ins.bend.y - p.y) < 1e-9;
      if (clear) expect(distToPolyline(p, full.centreline!), `corner at pointer ${ctx}`).toBeLessThanOrEqual(0.5);
      // preview == commit
      // A single connector is drawn identically. The two jogs next to the stubs of a composite bundle are nudged away from OTHER
      // connectors in the committed build, which a draft (it does not route the others) cannot know: everything else is equal.
      draft.paths.forEach((dp, bi) => {
        const fp = full.paths[bi]!;
        expect(dp.length, `draft point count ${ctx}`).toBe(fp.length);
        expect(dp[0], `draft start ${ctx}`).toEqual(fp[0]);
        expect(dp[dp.length - 1], `draft end ${ctx}`).toEqual(fp[fp.length - 1]);
        if (draft.branches.length === 1) expect(dp, `draft equals full ${ctx}`).toEqual(fp);
        else expect(dp.slice(3, -3), `draft lanes equal full ${ctx}`).toEqual(fp.slice(3, -3));
      });
      expect(draft.centreline, `draft centreline ${ctx}`).toEqual(full.centreline);
      expect(draft.bendHandles, `draft handles ${ctx}`).toEqual(full.bendHandles);
      // tidied waypoints (what is stored on release) draw the same line
      const tidy = interiorVertices(tidyPolyline(ins.poly, (q) => q.x === ins.bend.x && q.y === ins.bend.y));
      const full2 = build(f, withRoute(f.diagram, eid, { ...route, waypoints: tidy })).edges[eid] as FkEdgeGeom;
      expect(full2.paths, `tidy equals untidy ${ctx}`).toEqual(full.paths);
      checked++;
    }
  }
  return checked;
}

describe('SA-04: manual connector editing is corner-exact and the preview equals the commit', () => {
  it('pharmacy: inserting a bend at a random pointer', () => {
    restore = useDeterministicIds();
    expect(runDrags(pharmacyFixture, 7, 6, false)).toBeGreaterThan(40);
  });
  it('pharmacy: with snap-to-grid the corner is on the grid', () => {
    restore = useDeterministicIds();
    expect(runDrags(pharmacyFixture, 11, 4, true)).toBeGreaterThan(20);
  });
  it('tangled (composite bundles): inserting a bend at a random pointer', () => {
    restore = useDeterministicIds();
    expect(runDrags(tangledFixture, 3, 8, false)).toBeGreaterThan(20);
  });

  it('dragging a corner keeps the segments axis-aligned and the handle on the line', () => {
    restore = useDeterministicIds();
    const rnd = rng(5);
    const f = pharmacyFixture();
    for (const eid of Object.keys(f.diagram.edges)) {
      const base = build(f, f.diagram);
      const g0 = base.edges[eid] as FkEdgeGeom;
      let poly = g0.centreline!;
      if (poly.length < 5) continue;
      // store every corner first (as a mid-drag does), then drag corner k
      let d = withRoute(f.diagram, eid, { ...f.diagram.edges[eid]!.route, mode: 'manual', waypoints: interiorVertices(poly) });
      let g = build(f, d).edges[eid] as FkEdgeGeom;
      poly = g.centreline!;
      for (let trial = 0; trial < 6; trial++) {
        const k = 1 + Math.floor(rnd() * (poly.length - 2));
        const p = { x: poly[k]!.x + (rnd() - 0.5) * 120, y: poly[k]!.y + (rnd() - 0.5) * 120 };
        const moved = moveCornerPolyline(poly, k, p);
        for (let i = 0; i + 1 < moved.length; i++) expect(moved[i]!.x === moved[i + 1]!.x || moved[i]!.y === moved[i + 1]!.y, `${eid} axis-aligned`).toBe(true);
        const route = { ...f.diagram.edges[eid]!.route, mode: 'manual' as const, waypoints: interiorVertices(moved) };
        const full = build(f, withRoute(f.diagram, eid, route)).edges[eid] as FkEdgeGeom;
        for (const h of full.bendHandles) expect(distToPolyline(h.at, full.centreline!), `${eid} handle`).toBeLessThanOrEqual(0.5);
        expect(locateWaypoints(full.centreline!, route.waypoints).length).toBe(route.waypoints.length);
        d = withRoute(f.diagram, eid, route);
        g = full;
        poly = g.centreline!;
      }
    }
  });

  it('a corner is created exactly at the pointer wherever the pointer is allowed to be (outside the stubs)', () => {
    restore = useDeterministicIds();
    const f = pharmacyFixture();
    const scene = build(f, f.diagram);
    let tested = 0;
    for (const eid of Object.keys(f.diagram.edges)) {
      const poly = (scene.edges[eid] as FkEdgeGeom).centreline!;
      for (let seg = 0; seg + 1 < poly.length; seg++) {
        const a = poly[seg]!;
        const b = poly[seg + 1]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
        for (const off of [{ x: 3, y: 47 }, { x: 3, y: -47 }, { x: 47, y: 3 }, { x: -47, y: 3 }]) {
          const p = { x: (a.x + b.x) / 2 + off.x, y: (a.y + b.y) / 2 + off.y };
          const ins = insertBendPolyline(poly, seg, p);
          if (ins.bend.x !== p.x || ins.bend.y !== p.y) continue; // pushed clear of a stub: not the pointer any more
          const wps = interiorVertices(ins.poly);
          const full = build(f, withRoute(f.diagram, eid, { ...f.diagram.edges[eid]!.route, mode: 'manual', waypoints: wps })).edges[eid] as FkEdgeGeom;
          expect(distToPolyline(p, full.centreline!), `${eid} seg ${seg}`).toBeLessThanOrEqual(0.5);
          expect(isCorner(p, full.centreline!), `corner at the pointer ${eid} seg ${seg}`).toBe(true);
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThan(10);
  });
});
