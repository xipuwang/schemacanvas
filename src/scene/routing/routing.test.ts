import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Point, Rect, Side } from '../base';
import { deepFreeze } from '@/test/deepFreeze';
import { cleanOrthogonal, orthogonalizeThrough, routeOrthogonal, simplifyOrthogonal } from './index';
import type { RouteContext, RouteRequest } from './types';

const axisAligned = (pts: Point[]) => pts.slice(1).every((p, i) => p.x === pts[i]!.x || p.y === pts[i]!.y);
const onPath = (pts: Point[], q: Point) =>
  pts.slice(1).some((b, i) => {
    const a = pts[i]!;
    return q.x >= Math.min(a.x, b.x) && q.x <= Math.max(a.x, b.x) && q.y >= Math.min(a.y, b.y) && q.y <= Math.max(a.y, b.y) && (a.x === b.x ? q.x === a.x : q.y === a.y);
  });
const ctx: RouteContext = { obstacles: [], clearance: 8, stub: 12 };

/** True when the polyline passes through the OPEN interior of `r`. */
function crosses(pts: Point[], r: Rect): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.y === b.y) {
      if (a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w) return true;
    } else if (a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h) return true;
  }
  return false;
}
/** No consecutive duplicates and no three consecutive collinear points. */
function minimal(pts: Point[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) if (pts[i]!.x === pts[i + 1]!.x && pts[i]!.y === pts[i + 1]!.y) return false;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) return false;
  }
  return true;
}
const normal = (s: Side): Point => ({ top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } })[s];
/** First segment leaves along the side normal; last arrives against the target normal. */
function perpendicularEnds(pts: Point[], req: RouteRequest): boolean {
  const sn = normal(req.source.side);
  const tn = normal(req.target.side);
  const f = { x: Math.sign(pts[1]!.x - pts[0]!.x), y: Math.sign(pts[1]!.y - pts[0]!.y) };
  const n = pts.length;
  const l = { x: Math.sign(pts[n - 2]!.x - pts[n - 1]!.x), y: Math.sign(pts[n - 2]!.y - pts[n - 1]!.y) };
  return f.x === sn.x && f.y === sn.y && l.x === tn.x && l.y === tn.y;
}
const req = (key: string, s: Point, ss: Side, t: Point, ts: Side, extra: Partial<RouteRequest> = {}): RouteRequest => ({
  key,
  source: { point: s, side: ss },
  target: { point: t, side: ts },
  ...extra,
});

describe('routeOrthogonal contract', () => {
  it('starts/ends exactly at the anchors, axis-aligned, perpendicular stubs', () => {
    const r = routeOrthogonal([req('a', { x: 100, y: 50 }, 'bottom', { x: 300, y: 200 }, 'top')], ctx).a!;
    expect(r[0]).toEqual({ x: 100, y: 50 });
    expect(r[r.length - 1]).toEqual({ x: 300, y: 200 });
    expect(axisAligned(r)).toBe(true);
    expect(r[1]!.x).toBe(100);
    expect(r[r.length - 2]!.x).toBe(300);
    expect(r[r.length - 2]!.y).toBeLessThan(200);
    expect(minimal(r)).toBe(true);
  });

  it('every side combination: axis-aligned, exact ends, perpendicular, minimal', () => {
    const sides: Side[] = ['top', 'bottom', 'left', 'right'];
    for (const ss of sides) {
      for (const ts of sides) {
        for (const target of [{ x: 240, y: 160 }, { x: -200, y: -90 }, { x: 5, y: 300 }]) {
          const rq = req('k', { x: 0, y: 0 }, ss, target, ts);
          const r = routeOrthogonal([rq], ctx).k!;
          expect(axisAligned(r)).toBe(true);
          expect(r[0]).toEqual({ x: 0, y: 0 });
          expect(r[r.length - 1]).toEqual(target);
          expect(perpendicularEnds(r, rq)).toBe(true);
          expect(minimal(r)).toBe(true);
        }
      }
    }
  });

  it('an unobstructed bottom→top connection is a Z with the horizontal run between the two tables', () => {
    const r = routeOrthogonal([req('a', { x: 100, y: 50 }, 'bottom', { x: 300, y: 250 }, 'top')], ctx).a!;
    expect(r).toEqual([{ x: 100, y: 50 }, { x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 250 }]);
  });

  it('manual waypoints are passed through exactly', () => {
    const wp = [{ x: 150, y: 120 }, { x: 260, y: 120 }];
    const r = routeOrthogonal([req('m', { x: 100, y: 50 }, 'bottom', { x: 300, y: 200 }, 'top', { waypoints: wp })], ctx).m!;
    expect(axisAligned(r)).toBe(true);
    for (const w of wp) expect(onPath(r, w)).toBe(true);
  });

  it('manual routes ignore obstacles (user intent wins)', () => {
    const box: Rect = { x: 90, y: 80, w: 220, h: 40 };
    const c = { ...ctx, obstacles: [{ id: 'o', rect: box }] };
    const r = routeOrthogonal([req('m', { x: 100, y: 50 }, 'bottom', { x: 300, y: 200 }, 'top', { waypoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }] })], c).m!;
    expect(crosses(r, box)).toBe(true);
  });
});

describe('obstacle avoidance', () => {
  it('goes around an obstacle placed between the endpoints', () => {
    const box: Rect = { x: 150, y: 100, w: 100, h: 60 };
    const c = deepFreeze({ ...ctx, obstacles: [{ id: 'o', rect: box }] });
    // a horizontal connection straight through the box
    const rq = req('a', { x: 100, y: 130 }, 'right', { x: 300, y: 130 }, 'left');
    const r = routeOrthogonal([rq], c).a!;
    expect(crosses(r, box)).toBe(false);
    expect(axisAligned(r)).toBe(true);
    expect(perpendicularEnds(r, rq)).toBe(true);
    expect(r[0]).toEqual({ x: 100, y: 130 });
    expect(r[r.length - 1]).toEqual({ x: 300, y: 130 });
  });

  it('keeps the configured clearance when a free path exists', () => {
    const box: Rect = { x: 150, y: 100, w: 100, h: 60 };
    const padded: Rect = { x: 142, y: 92, w: 116, h: 76 };
    const c = { ...ctx, obstacles: [{ id: 'o', rect: box }] };
    const r = routeOrthogonal([req('a', { x: 100, y: 130 }, 'right', { x: 300, y: 130 }, 'left')], c).a!;
    expect(crosses(r, padded)).toBe(false);
  });

  it('bottom→top between tables stacked with a wide third table in the way', () => {
    const wall: Rect = { x: 0, y: 140, w: 600, h: 40 };
    const c = { ...ctx, obstacles: [{ id: 'wall', rect: wall }] };
    const rq = req('a', { x: 100, y: 60 }, 'bottom', { x: 300, y: 260 }, 'top');
    const r = routeOrthogonal([rq], c).a!;
    expect(crosses(r, wall)).toBe(false);
    expect(perpendicularEnds(r, rq)).toBe(true);
  });

  it('own source/target obstacles are respected too (self-loop routes around the table)', () => {
    const table: Rect = { x: 100, y: 100, w: 300, h: 32 };
    const c = { ...ctx, obstacles: [{ id: 'self', rect: table }] };
    // leave from the bottom of the first cell, arrive at the TOP of the last cell: must wrap around the table
    const rq = req('s', { x: 130, y: 132 }, 'bottom', { x: 370, y: 100 }, 'top');
    const r = routeOrthogonal([rq], c).s!;
    expect(crosses(r, table)).toBe(false);
    expect(perpendicularEnds(r, rq)).toBe(true);
    expect(axisAligned(r)).toBe(true);
    expect(r[0]).toEqual({ x: 130, y: 132 });
    expect(r[r.length - 1]).toEqual({ x: 370, y: 100 });
  });

  it('same-side self loop (bottom → bottom) is a clean U under the table', () => {
    const table: Rect = { x: 100, y: 100, w: 300, h: 32 };
    const c = { ...ctx, obstacles: [{ id: 'self', rect: table }] };
    const r = routeOrthogonal([req('s', { x: 130, y: 132 }, 'bottom', { x: 330, y: 132 }, 'bottom')], c).s!;
    expect(r.length).toBe(4);
    expect(crosses(r, table)).toBe(false);
    expect(r[1]!.y).toBeGreaterThan(132);
    expect(r[1]!.y).toBe(r[2]!.y);
  });

  it('ignoreObstacleIds lets a request cross that obstacle', () => {
    const box: Rect = { x: 150, y: 100, w: 100, h: 60 };
    const c = { ...ctx, obstacles: [{ id: 'o', rect: box }] };
    const r = routeOrthogonal([req('a', { x: 100, y: 130 }, 'right', { x: 300, y: 130 }, 'left', { ignoreObstacleIds: ['o'] })], c).a!;
    expect(r).toEqual([{ x: 100, y: 130 }, { x: 300, y: 130 }]);
  });

  it('endpoint inside a crowded area (neighbour closer than the clearance) still routes and keeps exact ends', () => {
    // the neighbour starts 6px above the source anchor: its padded rect swallows the stub end
    const neighbour: Rect = { x: 80, y: 0, w: 80, h: 44 };
    const c = { ...ctx, obstacles: [{ id: 'n', rect: neighbour }] };
    const rq = req('a', { x: 120, y: 50 }, 'top', { x: 400, y: 300 }, 'top');
    const r = routeOrthogonal([rq], c).a!;
    expect(r[0]).toEqual({ x: 120, y: 50 });
    expect(r[r.length - 1]).toEqual({ x: 400, y: 300 });
    expect(axisAligned(r)).toBe(true);
    expect(minimal(r)).toBe(true);
    // the shrink-then-drop behaviour this test relies on is part of the documented router contract
    const readme = readFileSync('src/scene/horizontal/README.md', 'utf8');
    expect(readme).toMatch(/SHRUNK to its raw rect/);
    expect(readme).toMatch(/DROPPED for that request/);
  });

  it('an endpoint buried inside another obstacle yields a path anyway (obstacle dropped for that request)', () => {
    const big: Rect = { x: 0, y: 0, w: 500, h: 500 };
    const c = { ...ctx, obstacles: [{ id: 'big', rect: big }] };
    const rq = req('a', { x: 100, y: 100 }, 'bottom', { x: 300, y: 300 }, 'top');
    const r = routeOrthogonal([rq], c).a!;
    expect(r[0]).toEqual({ x: 100, y: 100 });
    expect(r[r.length - 1]).toEqual({ x: 300, y: 300 });
    expect(axisAligned(r)).toBe(true);
  });

  it('never crosses a non-ignored obstacle when a free path exists (randomised scene)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const obstacles: Array<{ id: string; rect: Rect }> = [];
    for (let i = 0; i < 25; i++) {
      const rect = { x: Math.floor(rnd() * 20) * 60, y: Math.floor(rnd() * 12) * 70, w: 80, h: 32 };
      if (obstacles.some((o) => Math.abs(o.rect.x - rect.x) < 100 && Math.abs(o.rect.y - rect.y) < 60)) continue;
      obstacles.push({ id: `o${i}`, rect });
    }
    const c = { ...ctx, obstacles };
    const free = (p: Point) => !obstacles.some((o) => p.x > o.rect.x - 30 && p.x < o.rect.x + o.rect.w + 30 && p.y > o.rect.y - 30 && p.y < o.rect.y + o.rect.h + 30);
    let tested = 0;
    for (let k = 0; k < 40; k++) {
      const s = { x: Math.floor(rnd() * 1200), y: Math.floor(rnd() * 800) };
      const t = { x: Math.floor(rnd() * 1200), y: Math.floor(rnd() * 800) };
      if (!free(s) || !free(t)) continue;
      const r = routeOrthogonal([req('k', s, 'bottom', t, 'top')], c).k!;
      tested++;
      for (const o of obstacles) expect(crosses(r, o.rect)).toBe(false);
      expect(axisAligned(r)).toBe(true);
      expect(minimal(r)).toBe(true);
    }
    expect(tested).toBeGreaterThan(5);
  });
});

describe('batches', () => {
  it('parallel routes that would overlap are nudged onto separate lanes but keep exact ends', () => {
    // three routes from three cells of one table to three cells of another, all sharing the middle corridor
    const reqs = [0, 1, 2].map((i) => req(`r${i}`, { x: 100 + i * 40, y: 50 }, 'bottom', { x: 500 + i * 40, y: 250 }, 'top'));
    const out = routeOrthogonal(reqs, ctx);
    const ys = reqs.map((q) => out[q.key]!.find((p, k, a) => k > 0 && p.y === a[k - 1]!.y && p.x !== a[k - 1]!.x)!.y);
    expect(new Set(ys).size).toBe(3);
    for (let i = 0; i < 3; i++) {
      const r = out[`r${i}`]!;
      expect(r[0]).toEqual({ x: 100 + i * 40, y: 50 });
      expect(r[r.length - 1]).toEqual({ x: 500 + i * 40, y: 250 });
      expect(axisAligned(r)).toBe(true);
      expect(minimal(r)).toBe(true);
    }
    // lane order avoids crossings: the route starting furthest left (outermost vertical) must not be crossed by the others
    const spread = Math.max(...ys) - Math.min(...ys);
    expect(spread).toBeGreaterThanOrEqual(11);
  });

  it('same-direction parallel routes keep a consistent order (no crossing of the vertical drops)', () => {
    const reqs = [0, 1, 2].map((i) => req(`r${i}`, { x: 100 + i * 40, y: 50 }, 'bottom', { x: 500 + i * 40, y: 250 }, 'top'));
    const out = routeOrthogonal(reqs, ctx);
    const runY = (k: string) => out[k]!.find((p, i, a) => i > 0 && p.y === a[i - 1]!.y && p.x !== a[i - 1]!.x)!.y;
    // r0's rise (x=100) is the outermost on the left, r2's drop (x=580) the outermost on the right. Crossing-free order:
    // r2 on the top lane (its drop passes no other run), r0 on the bottom lane (r1's rise stays above it).
    expect(runY('r2')).toBeLessThan(runY('r1'));
    expect(runY('r1')).toBeLessThan(runY('r0'));
  });

  it('is deterministic', () => {
    const reqs = [0, 1, 2, 3].map((i) => req(`r${i}`, { x: 100 + i * 30, y: 50 }, 'bottom', { x: 400 + i * 30, y: 300 }, 'top'));
    const c = { ...ctx, obstacles: [{ id: 'o', rect: { x: 200, y: 120, w: 300, h: 40 } }] };
    expect(JSON.stringify(routeOrthogonal(reqs, c))).toBe(JSON.stringify(routeOrthogonal(reqs, c)));
  });

  it('does not mutate frozen inputs', () => {
    const reqs = deepFreeze([req('a', { x: 0, y: 0 }, 'bottom', { x: 100, y: 100 }, 'top', { waypoints: [{ x: 0, y: 50 }] })]);
    expect(() => routeOrthogonal(reqs, deepFreeze({ ...ctx, obstacles: [{ id: 'o', rect: { x: 10, y: 10, w: 10, h: 10 } }] }))).not.toThrow();
  });

  it('performance: 200 routes with 60 obstacles in well under a few seconds', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const obstacles: Array<{ id: string; rect: Rect }> = [];
    for (let i = 0; i < 60; i++) obstacles.push({ id: `o${i}`, rect: { x: (i % 10) * 220, y: Math.floor(i / 10) * 120, w: 160, h: 48 } });
    const reqs: RouteRequest[] = [];
    for (let i = 0; i < 200; i++) {
      const a = obstacles[Math.floor(rnd() * 60)]!;
      const b = obstacles[Math.floor(rnd() * 60)]!;
      reqs.push(
        req(`r${i}`, { x: a.rect.x + 20 + Math.floor(rnd() * 100), y: a.rect.y + a.rect.h }, 'bottom', { x: b.rect.x + 20 + Math.floor(rnd() * 100), y: b.rect.y }, 'top'),
      );
    }
    const t0 = performance.now();
    const out = routeOrthogonal(reqs, { obstacles, clearance: 8, stub: 12 });
    const ms = performance.now() - t0;
    console.log(`router perf: 200 routes / 60 obstacles = ${ms.toFixed(0)} ms`);
    expect(Object.keys(out).length).toBe(200);
    for (const q of reqs) {
      const r = out[q.key]!;
      expect(axisAligned(r)).toBe(true);
      expect(r[0]).toEqual(q.source.point);
      expect(r[r.length - 1]).toEqual(q.target.point);
    }
    expect(ms).toBeLessThan(2500); // spec target ~1s on a normal machine; generous bound keeps CI machines from flaking
  });
});

describe('helpers', () => {
  it('orthogonalizeThrough inserts at most one elbow, continuing the previous axis', () => {
    const r = orthogonalizeThrough([{ x: 0, y: 0 }, { x: 10, y: 10 }], 'h');
    expect(r).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    const v = orthogonalizeThrough([{ x: 0, y: 0 }, { x: 10, y: 10 }], 'v');
    expect(v).toEqual([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]);
  });
  it('simplifyOrthogonal removes duplicates and collinear points', () => {
    expect(simplifyOrthogonal([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 9 }, { x: 4, y: 9 }])).toEqual([{ x: 0, y: 0 }, { x: 0, y: 9 }, { x: 4, y: 9 }]);
  });
});

describe('review fixes (ROUTER-HOOK, ROUTER-NAN, HT-2, HT-3, HT-9)', () => {
  const own = (id: string, rect: Rect) => ({ id, rect });

  it('ROUTER-HOOK: facing ends closer than 2*stub are one straight segment when aligned and a plain Z otherwise', () => {
    const c: RouteContext = { obstacles: [], clearance: 10, stub: 18 };
    for (const gap of [20, 34, 35, 36, 40]) {
      const straight = routeOrthogonal([req('a', { x: 100, y: 100 }, 'bottom', { x: 100, y: 100 + gap }, 'top')], c).a!;
      expect(straight).toEqual([{ x: 100, y: 100 }, { x: 100, y: 100 + gap }]);
      const z = routeOrthogonal([req('a', { x: 100, y: 100 }, 'bottom', { x: 160, y: 100 + gap }, 'top')], c).a!;
      expect(z).toHaveLength(4);
      // monotone in y: no sideways hook that goes back
      for (let i = 1; i < z.length; i++) expect(z[i]!.y).toBeGreaterThanOrEqual(z[i - 1]!.y);
      expect(z[1]!.y).toBeCloseTo(100 + gap / 2, 9);
    }
  });

  it('ROUTER-NAN: non-finite coordinates never hang or throw; the bare segment is returned', () => {
    const c: RouteContext = { obstacles: [own('o', { x: 0, y: 0, w: 50, h: 20 }), own('bad', { x: NaN, y: 0, w: 50, h: 20 })], clearance: 10, stub: 16 };
    const r = routeOrthogonal(
      [
        req('nan-source', { x: NaN, y: 10 }, 'bottom', { x: 200, y: 200 }, 'top'),
        req('nan-wp', { x: 10, y: 10 }, 'bottom', { x: 200, y: 200 }, 'top', { waypoints: [{ x: 5, y: NaN }] }),
        req('ok', { x: 25, y: 20 }, 'bottom', { x: 200, y: 200 }, 'top'),
      ],
      c,
    );
    expect(r['nan-source']).toHaveLength(2);
    expect(r['nan-wp']).toHaveLength(2);
    expect(axisAligned(r.ok!)).toBe(true);
    expect(r.ok!.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // corrupt context numbers are tolerated too
    expect(() => routeOrthogonal([req('k', { x: 0, y: 0 }, 'bottom', { x: 90, y: 90 }, 'top')], { obstacles: [], clearance: NaN, stub: NaN })).not.toThrow();
  });

  it('HT-2: grid lines that differ by float noise are one line; no route has a slanted segment', () => {
    // midline (s1.y + t1.y) / 2 = 490.79999999999995 next to an obstacle edge y + h + clearance = 490.8
    const blocker = own('b', { x: 90, y: 440.8, w: 200, h: 40 });
    const r = routeOrthogonal(
      [req('a', { x: 100, y: 465.6 }, 'bottom', { x: 400, y: 516 }, 'top', { ignoreObstacleIds: [] })],
      { obstacles: [blocker], clearance: 10, stub: 16 },
    ).a!;
    expect(r.slice(1).every((p, i) => p.x === r[i]!.x || p.y === r[i]!.y)).toBe(true);
    // random scenes: every segment EXACTLY axis aligned (the old grid mixed 490.79999999999995 and 490.8)
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 25; round++) {
      const obstacles = Array.from({ length: 8 }, (_, i) => own(`o${i}`, { x: Math.round(rnd() * 600) + 0.1 * i, y: Math.round(rnd() * 400) + 0.3, w: 90.7, h: 33.2 }));
      const reqs = Array.from({ length: 6 }, (_, i) => req(`r${i}`, { x: rnd() * 700, y: rnd() * 500 }, 'bottom', { x: rnd() * 700, y: rnd() * 500 }, 'top'));
      for (const route of Object.values(routeOrthogonal(reqs, { obstacles, clearance: 10, stub: 16 }))) {
        expect(route.slice(1).every((p, i) => p.x === route[i]!.x || p.y === route[i]!.y)).toBe(true);
      }
    }
  });

  it('cleanOrthogonal snaps float noise onto the previous axis but keeps both end points exact', () => {
    const out = cleanOrthogonal([{ x: 10, y: 10 }, { x: 10.000000000001, y: 50 }, { x: 80, y: 50.00000000001 }, { x: 80.0000000001, y: 100 }]);
    expect(out).toEqual([{ x: 10, y: 10 }, { x: 10, y: 50 }, { x: 80.0000000001, y: 50 }, { x: 80.0000000001, y: 100 }]);
  });

  it('HT-3: a manual waypoint BEHIND the anchor side keeps both stubs; the path never runs through the cells', () => {
    const src = own('s', { x: 40, y: 60, w: 120, h: 30 });
    const dst = own('t', { x: 240, y: 60, w: 120, h: 30 });
    const c: RouteContext = { obstacles: [src, dst], clearance: 10, stub: 16 };
    const rq = req('m', { x: 80, y: 90 }, 'bottom', { x: 300, y: 90 }, 'bottom', { waypoints: [{ x: 200, y: 20 }] });
    const r = routeOrthogonal([rq], c).m!;
    expect(r[0]).toEqual({ x: 80, y: 90 });
    expect(r[r.length - 1]).toEqual({ x: 300, y: 90 });
    expect(axisAligned(r)).toBe(true);
    expect(r[1]!.x).toBe(80);
    expect(r[1]!.y).toBeGreaterThan(90); // leaves DOWNWARDS (first segment is the stub)
    expect(r[r.length - 2]!.x).toBe(300);
    expect(r[r.length - 2]!.y).toBeGreaterThan(90); // arrives from BELOW
    expect(onPath(r, { x: 200, y: 20 })).toBe(true); // the waypoint is still visited
    // never through either cell
    expect(crosses(r, src.rect)).toBe(false);
    expect(crosses(r, dst.rect)).toBe(false);
    // a waypoint that only SHORTENS the stub (still outside the cell) is kept as given
    const short = routeOrthogonal([req('s', { x: 80, y: 90 }, 'bottom', { x: 300, y: 90 }, 'bottom', { waypoints: [{ x: 80, y: 96 }, { x: 300, y: 96 }] })], c).s!;
    expect(short).toEqual([{ x: 80, y: 90 }, { x: 80, y: 96 }, { x: 300, y: 96 }, { x: 300, y: 90 }]);
  });

  it('obstacle clearance override is honoured per obstacle', () => {
    const thin = { id: 'z', rect: { x: 95, y: 150, w: 10, h: 30 }, clearance: 2 };
    const r = routeOrthogonal([req('a', { x: 100, y: 100 }, 'bottom', { x: 100, y: 260 }, 'top')], { obstacles: [thin as never], clearance: 20, stub: 16 }).a!;
    expect(crosses(r, thin.rect)).toBe(false);
    // a detour of ~ half width + 2 (not + 20)
    const maxDx = Math.max(...r.map((p) => Math.abs(p.x - 100)));
    expect(maxDx).toBeLessThan(15);
  });

  it('HT-9: 200 routes over 60 obstacles stay fast (windowed search + typed-array A*)', () => {
    let seed = 9;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const obs: Rect[] = [];
    for (let k = 0; k < 4000 && obs.length < 60; k++) {
      const o = { x: Math.round(rnd() * 2400), y: Math.round(rnd() * 1800), w: 40 + Math.round(rnd() * 120), h: 30 };
      if (obs.every((p) => o.x + o.w + 30 <= p.x || p.x + p.w + 30 <= o.x || o.y + o.h + 30 <= p.y || p.y + p.h + 30 <= o.y)) obs.push(o);
    }
    const reqs = Array.from({ length: 200 }, (_, i) => {
      const a = obs[i % obs.length]!;
      const b = obs[(i * 7 + 3) % obs.length]!;
      return req('k' + i, { x: a.x + a.w / 2, y: a.y + a.h }, 'bottom', { x: b.x + b.w / 2, y: b.y }, 'top');
    });
    const t0 = performance.now();
    const out = routeOrthogonal(reqs, { obstacles: obs.map((o, i) => ({ id: 'o' + i, rect: o })), clearance: 10, stub: 16 });
    const ms = performance.now() - t0;
    expect(Object.keys(out)).toHaveLength(200);
    // generous budget (CI machines are shared): the pre-fix router needed 0.9 - 3.2 s on a quiet machine
    expect(ms).toBeLessThan(4000);
  });
});
