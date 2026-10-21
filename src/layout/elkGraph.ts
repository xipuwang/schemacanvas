/**
 * Generic graph layout on top of ELK (see `elkRunner.ts`).
 * Output positions are TOP-LEFT corners, so callers may write them straight into `DiagramNode.x/y` (ARCHITECTURE rule 11).
 *
 * Guarantees: deterministic (inputs are sorted by `sortKey` then id and ELK gets a fixed random seed; callers that pass a
 * semantic `sortKey` get the same layout whatever the opaque ids are), never NaN (invalid ELK output falls back to a
 * simple grid), disconnected components / parallel edges / self-loops / zero edges / one node are fine, and the result
 * never has overlapping nodes (clearance `clearance` for the non-layered algorithms, >= 0 for all) except between two
 * `fixed` nodes that already overlapped.
 *
 * ELK (~1.4 MB) is loaded on first use (`elkRunner.ts`: a Web Worker in the browser, the bundled in-thread build elsewhere),
 * so it is not part of the initial bundle and does not block the UI.
 */
import type { ElkNode } from 'elkjs/lib/elk-api';
import { nudgeOutOfOverlap } from './align';
import { isAbortError, runElk } from './elkRunner';
import { STRESS_MAX_NODES } from './limits';
import { finite, rectsOverlap } from './rects';
import type { LayoutRect, Positions } from './types';

export type LayoutAlgorithm = 'layered' | 'stress' | 'force' | 'radial' | 'rectpacking';
export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

export interface GraphNode {
  id: string;
  w: number;
  h: number;
  /** Top-left position this node must keep (the rest is laid out around it). */
  fixed?: { x: number; y: number };
  /** Stable semantic ordering key (kind/name/...); ties fall back to `id`. Keeps layouts independent of random ids. */
  sortKey?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutGraphInput {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  algorithm: LayoutAlgorithm;
  /** Flow direction of `layered` (and the preferred axis of the others where ELK supports it). Default DOWN. */
  direction?: LayoutDirection;
  /** Minimum clearance between nodes and the base unit for routing channels. Default 60. */
  spacing?: number;
  /** ELK random seed (stress/force/radial). Default 1. */
  seed?: number;
  /** Stress/force: preferred edge length between node centres. Default derived from node sizes + spacing. */
  edgeLength?: number;
  /** Minimum gap enforced between nodes by the overlap pass of the non-layered algorithms. Default `spacing`. */
  clearance?: number;
  /** Abort a stale request: the promise rejects with an `AbortError` (see elkRunner.ts). */
  signal?: AbortSignal;
}

/**
 * ELK's stress implementation has a ~cubic set-up cost (measured: 500 nodes ~ 18 s, 200 nodes ~ 1 s) that is independent of
 * the iteration limit, so above this size `stress` transparently degrades to `force` (500 nodes ~ 3.5 s).
 */
export { STRESS_MAX_NODES };
const DEFAULT_SPACING = 60;

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (a: { id: string; sortKey?: string }, b: { id: string; sortKey?: string }): number =>
  cmpStr(a.sortKey ?? '', b.sortKey ?? '') || byId(a, b);

function elkOptions(input: LayoutGraphInput, nodes: ReadonlyArray<GraphNode>): Record<string, string> {
  const spacing = input.spacing ?? DEFAULT_SPACING;
  const common: Record<string, string> = {
    'elk.randomSeed': String(input.seed ?? 1),
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': String(spacing * 1.5),
    'elk.spacing.nodeNode': String(spacing),
    'elk.aspectRatio': '1.6',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  };
  switch (input.algorithm) {
    case 'layered':
      return {
        ...common,
        'elk.algorithm': 'layered',
        'elk.direction': input.direction ?? 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        // Between-layer distance is where the orthogonal FK connectors run: keep it generous.
        'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing),
        'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.max(16, spacing / 2)),
        'elk.layered.spacing.edgeEdgeBetweenLayers': String(Math.max(12, spacing / 3)),
        'elk.spacing.edgeNode': String(Math.max(16, spacing / 2)),
        'elk.spacing.edgeEdge': String(Math.max(12, spacing / 3)),
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.thoroughness': nodes.length > 200 ? '3' : '10',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      };
    case 'stress': {
      const avg = nodes.length ? nodes.reduce((s, n) => s + Math.max(n.w, n.h), 0) / nodes.length : 100;
      return {
        ...common,
        'elk.algorithm': 'stress',
        'elk.stress.desiredEdgeLength': String(input.edgeLength ?? avg + spacing),
        // Cap iterations on big graphs (quality is already converged by then).
        'elk.stress.iterationLimit': String(nodes.length > 150 ? 100 : 300),
      };
    }
    case 'force': {
      const avg = nodes.length ? nodes.reduce((s, n) => s + Math.max(n.w, n.h), 0) / nodes.length : 100;
      return {
        ...common,
        'elk.algorithm': 'force',
        'elk.force.repulsion': String(Math.max(5, (input.edgeLength ?? avg + spacing) / 12)),
        'elk.force.iterations': String(nodes.length > 150 ? 60 : 300),
      };
    }
    case 'radial':
      return { ...common, 'elk.algorithm': 'radial', 'elk.radial.radius': String(input.edgeLength ?? 0), 'elk.spacing.nodeNode': String(spacing) };
    case 'rectpacking':
      return { ...common, 'elk.algorithm': 'rectpacking', 'elk.contentAlignment': '[V_TOP,H_LEFT]' };
  }
}

/** Deterministic fallback used when ELK fails or yields non-finite numbers: row-wrapped grid in id order. */
function gridFallback(nodes: ReadonlyArray<GraphNode>, spacing: number): Positions {
  const out: Positions = {};
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  let x = 0;
  let y = 0;
  let rowH = 0;
  nodes.forEach((n, i) => {
    if (i > 0 && i % cols === 0) {
      x = 0;
      y += rowH + spacing;
      rowH = 0;
    }
    out[n.id] = { x, y };
    x += n.w + spacing;
    rowH = Math.max(rowH, n.h);
  });
  return out;
}

/**
 * Re-anchor free nodes against the fixed ones: ELK ignores fixed positions, so we translate the whole ELK result by
 * the average (fixed - elk) offset (keeps relative arrangement near the pinned nodes), then push free nodes out of
 * the pinned ones.
 */
function applyFixed(nodes: ReadonlyArray<GraphNode>, laid: Positions, gap: number): Positions {
  const fixedNodes = nodes.filter((n) => n.fixed);
  if (fixedNodes.length === 0) return laid;
  let dx = 0;
  let dy = 0;
  for (const n of fixedNodes) {
    dx += n.fixed!.x - laid[n.id]!.x;
    dy += n.fixed!.y - laid[n.id]!.y;
  }
  dx /= fixedNodes.length;
  dy /= fixedNodes.length;
  const out: Positions = {};
  for (const n of nodes) out[n.id] = n.fixed ? { ...n.fixed } : { x: laid[n.id]!.x + dx, y: laid[n.id]!.y + dy };
  const rects: LayoutRect[] = nodes.map((n) => ({ id: n.id, sortKey: n.sortKey, x: out[n.id]!.x, y: out[n.id]!.y, w: n.w, h: n.h }));
  const moved = nudgeOutOfOverlap(rects, { gap, fixedIds: new Set(fixedNodes.map((n) => n.id)) });
  return { ...out, ...moved };
}

export async function layoutGraph(input: LayoutGraphInput): Promise<Positions> {
  const spacing = input.spacing ?? DEFAULT_SPACING;
  const nodes = [...input.nodes]
    .map((n) => ({ ...n, w: finite(n.w) && n.w > 0 ? n.w : 1, h: finite(n.h) && n.h > 0 ? n.h : 1 }))
    .sort(byKey);
  if (nodes.length === 0) return {};
  const ids = new Set(nodes.map((n) => n.id));
  const keyOf = new Map(nodes.map((n) => [n.id, n.sortKey ?? ''] as const));
  // Self-loops never influence ranking/placement; edges to unknown nodes are dropped rather than crashing ELK.
  const edges = [...input.edges]
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .sort((a, b) => cmpStr(keyOf.get(a.source)!, keyOf.get(b.source)!) || cmpStr(keyOf.get(a.target)!, keyOf.get(b.target)!) || byId(a, b));

  const algorithm: LayoutAlgorithm = input.algorithm === 'stress' && nodes.length > STRESS_MAX_NODES ? 'force' : input.algorithm;
  input = { ...input, algorithm };
  let laid: Positions;
  if (nodes.length === 1) {
    laid = { [nodes[0]!.id]: { x: 0, y: 0 } };
  } else {
    // ELK only ever sees canonical ids (position in the semantic order), so nothing it does can depend on the caller's ids.
    const elkId = new Map<string, string>(nodes.map((n, i) => [n.id, `n${i}`]));
    const graph: ElkNode = {
      id: '__root',
      layoutOptions: elkOptions(input, nodes),
      children: nodes.map((n) => ({ id: elkId.get(n.id)!, width: n.w, height: n.h })),
      edges: edges.map((e, i) => ({ id: `e${i}`, sources: [elkId.get(e.source)!], targets: [elkId.get(e.target)!] })),
    };
    try {
      const res = await runElk(graph, input.signal);
      laid = {};
      const back = new Map([...elkId].map(([id, eid]) => [eid, id] as const));
      for (const c of res.children ?? []) if (back.has(c.id)) laid[back.get(c.id)!] = { x: c.x ?? NaN, y: c.y ?? NaN };
      if (nodes.some((n) => !laid[n.id] || !finite(laid[n.id]!.x) || !finite(laid[n.id]!.y))) throw new Error('non-finite ELK output');
    } catch (e) {
      if (isAbortError(e)) throw e; // a stale request is dropped, never turned into a grid layout
      laid = gridFallback(nodes, spacing);
    }
  }

  // Non-layered algorithms ignore node sizes: separate them with the requested clearance. EVERY algorithm then gets a
  // final plain-overlap check (no-op when clean), so the result never contains overlapping nodes.
  const clearance = input.clearance ?? spacing;
  const fixedIds = new Set(nodes.filter((n) => n.fixed).map((n) => n.id));
  const rectsOf = (): LayoutRect[] => nodes.map((n) => ({ id: n.id, sortKey: n.sortKey, x: laid[n.id]!.x, y: laid[n.id]!.y, w: n.w, h: n.h }));
  if (input.algorithm !== 'layered' && input.algorithm !== 'rectpacking' && nodes.length > 1) {
    laid = { ...laid, ...nudgeOutOfOverlap(rectsOf(), { gap: clearance, fixedIds, maxPasses: nodes.length > 200 ? 30 : 150 }) };
  }
  laid = applyFixed(nodes, laid, nodes.some((n) => n.fixed) ? clearance : 0);
  if (nodes.length > 1) laid = { ...laid, ...nudgeOutOfOverlap(rectsOf(), { gap: 0, fixedIds, maxPasses: 30 }) };
  // Normalise so the layout starts at (0,0) unless fixed nodes pin it.
  if (!nodes.some((n) => n.fixed)) {
    const minX = Math.min(...nodes.map((n) => laid[n.id]!.x));
    const minY = Math.min(...nodes.map((n) => laid[n.id]!.y));
    for (const n of nodes) laid[n.id] = { x: laid[n.id]!.x - minX, y: laid[n.id]!.y - minY };
  }
  return Object.fromEntries(nodes.map((n) => [n.id, laid[n.id]!]));
}

/** Test/diagnostic helper: any overlapping pair in a layout result (gap 0). */
export function overlappingPairs(nodes: ReadonlyArray<GraphNode>, pos: Positions, gap = 0): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const s = [...nodes].sort(byId);
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      const a = s[i]!;
      const b = s[j]!;
      const pa = pos[a.id]!;
      const pb = pos[b.id]!;
      if (rectsOverlap({ x: pa.x, y: pa.y, w: a.w, h: a.h }, { x: pb.x, y: pb.y, w: b.w, h: b.h }, gap)) out.push([a.id, b.id]);
    }
  return out;
}
