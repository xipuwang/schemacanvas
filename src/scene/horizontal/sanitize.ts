/**
 * Non-finite safety for stored diagram numbers. A corrupt project file (NaN, +-Infinity, 1e308) must never throw or
 * produce NaN geometry: bad optional numbers are dropped (the default applies), huge ones are clamped, and a node whose
 * POSITION is not finite is not drawn at all (the caller emits `h-node-invalid:<id>`).
 */
import type { AnchorSpec, DiagramEdge, DiagramNode, Id, NodeStyle, Point } from '@/model/types';

/** Largest magnitude of any stored world coordinate / size that is still honoured. */
export const MAX_COORD = 1e7;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampCoord = (v: number): number => Math.max(-MAX_COORD, Math.min(MAX_COORD, v));

/** A finite, clamped number, or `undefined` when the input is missing or not finite. */
function opt(v: unknown, min = -MAX_COORD, max = MAX_COORD): number | undefined {
  return finite(v) ? Math.max(min, Math.min(max, v)) : undefined;
}

/** `undefined` when the node's position is unusable (skip the node); otherwise a copy with every number made safe. */
export function sanitizeNode(node: DiagramNode): DiagramNode | undefined {
  if (!finite(node.x) || !finite(node.y)) return undefined;
  const out: DiagramNode = { ...node, x: clampCoord(node.x), y: clampCoord(node.y) };
  for (const k of ['width', 'height'] as const) {
    const v = opt(node[k], 0);
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  if (node.columnWidths) {
    const cw: Record<Id, number> = {};
    for (const [id, w] of Object.entries(node.columnWidths)) {
      const v = opt(w, 0);
      if (v !== undefined) cw[id] = v;
    }
    out.columnWidths = cw;
  }
  if (node.style) {
    const style: NodeStyle = { ...node.style };
    if (style.strokeWidth !== undefined) {
      const v = opt(style.strokeWidth, 0, 100);
      if (v === undefined) delete style.strokeWidth;
      else style.strokeWidth = v;
    }
    if (style.fontSize !== undefined) {
      const v = opt(style.fontSize, 1, 1000);
      if (v === undefined) delete style.fontSize;
      else style.fontSize = v;
    }
    out.style = style;
  }
  return out;
}

function sanitizeSpec(spec: AnchorSpec | undefined): AnchorSpec | undefined {
  if (!spec) return spec;
  const out: AnchorSpec = { ...spec };
  if (out.offset !== undefined) {
    const v = opt(out.offset, 0, 1);
    if (v === undefined) delete out.offset;
    else out.offset = v;
  }
  return out;
}

const safePoint = (p: Point | undefined): Point | undefined => (p && finite(p.x) && finite(p.y) ? { x: clampCoord(p.x), y: clampCoord(p.y) } : undefined);

export function sanitizeEdge(edge: DiagramEdge): DiagramEdge {
  const route = { ...edge.route };
  route.waypoints = (edge.route.waypoints ?? []).map(safePoint).filter((p): p is Point => !!p);
  if (route.waypoints.length === 0 && route.mode === 'manual') route.mode = 'auto';
  if (route.sourceAnchor) route.sourceAnchor = sanitizeSpec(route.sourceAnchor);
  if (route.targetAnchor) route.targetAnchor = sanitizeSpec(route.targetAnchor);
  if (route.branchAnchors) {
    const ba: NonNullable<typeof route.branchAnchors> = {};
    for (const [id, pair] of Object.entries(route.branchAnchors)) {
      const next = { ...pair };
      if (pair.source) next.source = sanitizeSpec(pair.source)!;
      if (pair.target) next.target = sanitizeSpec(pair.target)!;
      ba[id] = next;
    }
    route.branchAnchors = ba;
  }
  const out: DiagramEdge = { ...edge, route };
  if (edge.style) {
    const style = { ...edge.style };
    if (style.strokeWidth !== undefined) {
      const v = opt(style.strokeWidth, 0, 100);
      if (v === undefined) delete style.strokeWidth;
      else style.strokeWidth = v;
    }
    out.style = style;
  }
  if (edge.labelOffsets) {
    const lo: NonNullable<DiagramEdge['labelOffsets']> = {};
    for (const [k, p] of Object.entries(edge.labelOffsets) as Array<['main' | 'role' | 'cardinality', Point | undefined]>) {
      if (!p) continue;
      lo[k] = { x: opt(p.x) ?? 0, y: opt(p.y) ?? 0 };
    }
    out.labelOffsets = lo;
  }
  return out;
}
