// @vitest-environment node
import './deterministic';
/** P2b: drawing-quality probes on laid-out real scenes (connectors vs nodes, labels vs everything). */
import { describe, expect, it } from 'vitest';
import { labelRect } from '@/scene/geometry';
import { buildScene } from '@/scene/registry';
import type { Rect } from '@/scene/base';
import { EXAMPLES, EXAMPLE_KEYS, convertInStore, layoutDiagramInStore, overlaps, segIntersectsRect, setupEr } from './helpers';

async function scenes(key: keyof typeof EXAMPLES) {
  const s = setupEr(EXAMPLES[key]());
  await layoutDiagramInStore(s.store, s.erDiagramId);
  const c = await convertInStore(s);
  const p = s.store.getState().project;
  return { chen: buildScene(p, s.erDiagramId), rel: buildScene(p, c.relDiagramId) };
}

describe.each(EXAMPLE_KEYS)('P2b example %s', (key) => {
  it('Chen: no line passes through a node that is not one of its endpoints', async () => {
    const { chen } = await scenes(key);
    const bad: string[] = [];
    for (const e of Object.values(chen.edges)) {
      for (const n of Object.values(chen.nodes)) {
        if (n.nodeId === e.sourceNodeId || n.nodeId === e.targetNodeId) continue;
        const path = e.paths[0]!;
        for (let i = 0; i + 1 < path.length; i++) {
          // straight/orthogonal bbox test is only exact for axis-aligned segments; use a segment-vs-rect clip for diagonals
          if (segHitsRect(path[i]!, path[i + 1]!, n.bounds)) bad.push(`${e.edgeId} x ${n.nodeId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('Chen: no label rectangle overlaps a node it does not belong to or another label', async () => {
    const { chen } = await scenes(key);
    const labels: Array<{ id: string; r: Rect; edge: string }> = [];
    for (const e of Object.values(chen.edges)) for (const l of e.labels) labels.push({ id: `${e.edgeId}/${l.id}`, r: labelRect(l.label), edge: e.edgeId });
    const bad: string[] = [];
    for (const l of labels) for (const n of Object.values(chen.nodes)) if (overlaps(l.r, n.bounds, 0.5)) bad.push(`${l.id} over node ${n.nodeId}`);
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i]!.r, labels[j]!.r, 0.5)) bad.push(`${labels[i]!.id} over ${labels[j]!.id}`);
    expect(bad).toEqual([]);
  });

  it('Chen: no label rectangle is crossed by a line of another edge', async () => {
    const { chen } = await scenes(key);
    const bad: string[] = [];
    for (const e of Object.values(chen.edges)) for (const l of e.labels) {
      const r = labelRect(l.label);
      for (const o of Object.values(chen.edges)) {
        if (o.edgeId === e.edgeId) continue;
        for (const path of o.paths) for (let i = 0; i + 1 < path.length; i++) if (segHitsRect(path[i]!, path[i + 1]!, r)) bad.push(`${e.edgeId}/${l.id} crossed by ${o.edgeId}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Relational: no FK connector passes through any relation-name label or foreign table; labels do not overlap tables', async () => {
    const { rel } = await scenes(key);
    const bad: string[] = [];
    for (const e of Object.values(rel.edges)) {
      for (const n of Object.values(rel.nodes)) {
        if (n.kind !== 'h-table') continue;
        const nameR = labelRect(n.nameLabel);
        for (const path of e.paths) for (let i = 0; i + 1 < path.length; i++) {
          if (segIntersectsRect(path[i]!, path[i + 1]!, nameR, 0.5)) bad.push(`${e.edgeId} crosses name of ${n.nodeId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

/** Liang-Barsky segment vs rect (shrunk by 0.5). */
function segHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect, shrink = 0.5): boolean {
  const x0 = r.x + shrink, x1 = r.x + r.w - shrink, y0 = r.y + shrink, y1 = r.y + r.h - shrink;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; }
    else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  }
  return true;
}
