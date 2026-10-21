/** Pure 2-D geometry helpers shared by scene builders, routing, the editor and layout. */
import type { Outline, Point, Rect, Side, TextLabel } from './base';

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const pt = (x: number, y: number): Point => ({ x, y });

export const rectRight = (r: Rect): number => r.x + r.w;
export const rectBottom = (r: Rect): number => r.y + r.h;
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function inflateRect(r: Rect, dx: number, dy: number = dx): Rect {
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy };
}

export function unionRects(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectOfPoints(points: Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const rectContains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** True when `inner` lies completely inside `outer`. */
export const rectEncloses = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const snapToGrid = (value: number, size: number): number => (size > 0 ? Math.round(value / size) * size : value);

/** Point on `side` of `r`; `offset` 0..1 runs left→right (top/bottom) or top→bottom (left/right). */
export function sidePoint(r: Rect, side: Side, offset = 0.5): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.w * offset, y: r.y };
    case 'bottom':
      return { x: r.x + r.w * offset, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: r.y + r.h * offset };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h * offset };
  }
}

/** Outward unit direction of a side. */
export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

export function oppositeSide(side: Side): Side {
  return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';
}

/** The side of `r` that `p` is closest to (by normalised distance to the centre). */
export function nearestSide(r: Rect, p: Point): Side {
  const c = rectCenter(r);
  const dx = (p.x - c.x) / (r.w / 2 || 1);
  const dy = (p.y - c.y) / (r.h / 2 || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

export const outlineRect = (o: Outline): Rect => o.rect;

export function pointInOutline(o: Outline, p: Point): boolean {
  const r = o.rect;
  switch (o.kind) {
    case 'rect':
      return rectContains(r, p);
    case 'ellipse': {
      const a = r.w / 2;
      const b = r.h / 2;
      if (a === 0 || b === 0) return false;
      const c = rectCenter(r);
      return ((p.x - c.x) / a) ** 2 + ((p.y - c.y) / b) ** 2 <= 1;
    }
    case 'diamond': {
      const a = r.w / 2;
      const b = r.h / 2;
      if (a === 0 || b === 0) return false;
      const c = rectCenter(r);
      return Math.abs(p.x - c.x) / a + Math.abs(p.y - c.y) / b <= 1;
    }
  }
}

/**
 * Where the ray from the outline's centre towards `toward` leaves the outline. This is the
 * attachment point of a straight edge. If `toward` is the centre, returns the top point.
 */
export function boundaryPoint(o: Outline, toward: Point): Point {
  const r = o.rect;
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: r.y };
  const a = r.w / 2;
  const b = r.h / 2;
  let t: number;
  switch (o.kind) {
    case 'rect':
      t = Math.min(dx !== 0 ? a / Math.abs(dx) : Infinity, dy !== 0 ? b / Math.abs(dy) : Infinity);
      break;
    case 'ellipse':
      t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
      break;
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Distance from `p` to segment `a`–`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return distance(p, { x: a.x + t * abx, y: a.y + t * aby });
}

export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(p, points[0]!);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(p, points[i]!, points[i + 1]!));
  }
  return best;
}

export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) len += distance(points[i]!, points[i + 1]!);
  return len;
}

/** Point at fraction `t` (0..1) of the polyline's arc length. */
export function pointAlongPolyline(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const total = polylineLength(points);
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = distance(points[i]!, points[i + 1]!);
    if (remaining <= seg || i === points.length - 2) {
      const f = seg === 0 ? 0 : remaining / seg;
      return {
        x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * f,
        y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * f,
      };
    }
    remaining -= seg;
  }
  return points[points.length - 1]!;
}

// ---------------------------------------------------------------------------
// Paint bounds, labels, parallel lines
// ---------------------------------------------------------------------------

/** Paint rectangle of a text label (covers italic overhang and descenders). */
export function labelRect(l: TextLabel): Rect {
  const size = l.font.size;
  const startX = l.anchor === 'middle' ? l.x - l.width / 2 : l.anchor === 'end' ? l.x - l.width : l.x;
  return { x: startX - 0.05 * size, y: l.y - 0.6 * size, w: l.width + 0.25 * size, h: 1.2 * size };
}

/** Inflate a geometric rect to include a stroke of `strokeWidth` (+1 for antialiasing). */
export const paintRect = (r: Rect, strokeWidth: number): Rect => inflateRect(r, strokeWidth / 2 + 1);

/** Remove consecutive duplicate points. */
export function dedupePoints(points: Point[], eps = 1e-9): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) out.push(p);
  }
  return out;
}

/**
 * Polyline parallel to `points` at signed distance `d`: positive = LEFT of the travel direction (on screen with y
 * down, travelling +x, left is up). Mitred at bends (bevelled when the miter would exceed 3×|d|), so the two rails of
 * a double line stay parallel through elbows. Used for total-participation double lines and composite-FK branches.
 */
export function offsetPolyline(points: Point[], d: number): Point[] {
  const pts = dedupePoints(points);
  if (pts.length < 2 || d === 0) return pts;
  const normals: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1]!.x - pts[i]!.x;
    const dy = pts[i + 1]!.y - pts[i]!.y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: dy / len, y: -dx / len });
  }
  const off = (p: Point, n: Point): Point => ({ x: p.x + n.x * d, y: p.y + n.y * d });
  const out: Point[] = [off(pts[0]!, normals[0]!)];
  for (let i = 1; i < pts.length - 1; i++) {
    const n0 = normals[i - 1]!;
    const n1 = normals[i]!;
    const a0 = off(pts[i - 1]!, n0);
    const a1 = off(pts[i]!, n0);
    const b0 = off(pts[i]!, n1);
    const b1 = off(pts[i + 1]!, n1);
    const r = { x: a1.x - a0.x, y: a1.y - a0.y };
    const s = { x: b1.x - b0.x, y: b1.y - b0.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-9) {
      out.push(a1);
      continue;
    }
    const t = ((b0.x - a0.x) * s.y - (b0.y - a0.y) * s.x) / den;
    const miter = { x: a0.x + r.x * t, y: a0.y + r.y * t };
    if (distance(miter, pts[i]!) > 3 * Math.abs(d)) out.push(a1, b0);
    else out.push(miter);
  }
  out.push(off(pts[pts.length - 1]!, normals[normals.length - 1]!));
  return dedupePoints(out);
}

/** Point at fraction `t` of the polyline plus the unit tangent and left-hand unit normal there. */
export function pointAndNormalAlong(points: Point[], t: number): { point: Point; tangent: Point; normal: Point } {
  const pts = dedupePoints(points);
  if (pts.length < 2) return { point: pts[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: -1 } };
  const total = polylineLength(pts);
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const seg = distance(a, b);
    if (remaining <= seg || i === pts.length - 2) {
      const f = seg === 0 ? 0 : remaining / seg;
      const tangent = { x: (b.x - a.x) / (seg || 1), y: (b.y - a.y) / (seg || 1) };
      return {
        point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
        tangent,
        normal: { x: tangent.y, y: -tangent.x },
      };
    }
    remaining -= seg;
  }
  return { point: pts[pts.length - 1]!, tangent: { x: 1, y: 0 }, normal: { x: 0, y: -1 } };
}

/** Intersection of segment `from`→`to` with the boundary of `outline` nearest to `to` (undefined if none). */
export function segmentOutlineIntersection(o: Outline, from: Point, to: Point): Point | undefined {
  const inFrom = pointInOutline(o, from);
  const inTo = pointInOutline(o, to);
  if (inFrom === inTo) return undefined;
  let lo = inFrom ? from : to; // inside
  let hi = inFrom ? to : from; // outside
  for (let i = 0; i < 40; i++) {
    const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
    if (pointInOutline(o, mid)) lo = mid;
    else hi = mid;
  }
  return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
}
