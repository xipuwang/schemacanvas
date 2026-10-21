// @vitest-environment node
/**
 * P2d: deterministic regression replays of former defects (HROUTE-1, CHEN-LABEL-3) that only appeared for some random ids
 * (auto-layout / label placement depend on id order). Fixtures are real projects saved right after convert + auto-layout.
 * Both defects are fixed; the tests assert the clean outcome.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labelRect } from '@/scene/geometry';
import { buildScene } from '@/scene/registry';
import type { Project } from '@/model/types';
import { rectInOutline, segIntersectsRect } from './helpers';

const load = (name: string): { project: Project; er: string; rel: string } =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('P2d known defects (deterministic replay)', () => {
  it('HROUTE-1 regression: no auto-routed FK connector runs through a foreign table\'s bounds', () => {
    const f = load('pharmacy-hroute-crossing.json');
    const scene = buildScene(f.project, f.rel);
    expect(scene.warnings).toEqual([]);
    const crossings: string[] = [];
    for (const e of Object.values(scene.edges)) for (const n of Object.values(scene.nodes)) {
      if (n.nodeId === e.sourceNodeId || n.nodeId === e.targetNodeId) continue;
      for (const path of e.paths) for (let i = 0; i + 1 < path.length; i++) if (segIntersectsRect(path[i]!, path[i + 1]!, n.bounds)) crossings.push(`${e.edgeId} x ${n.nodeId}`);
    }
    expect(crossings).toEqual([]);
  });

  it('CHEN-LABEL-3 regression: no cardinality label rectangle overlaps a node it does not belong to', () => {
    const f = load('pharmacy-chen-label-over-node.json');
    const scene = buildScene(f.project, f.er);
    const bad: string[] = [];
    for (const e of Object.values(scene.edges)) for (const l of e.labels) {
      const r = labelRect(l.label);
      for (const n of Object.values(scene.nodes)) if (rectInOutline(r, n.outline)) bad.push(`${e.edgeId}/${l.id} over ${n.nodeId}`);
    }
    expect(bad).toEqual([]);
  });
});
