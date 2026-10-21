/** SA-02: pure overlap resolution for any scene. */
import { describe, expect, it } from 'vitest';
import { buildExample } from '@/examples';
import { anyOverlap } from '@/layout/rects';
import type { Project } from '@/model/types';
import { defaultMeasure } from '../measure';
import { buildScene } from '../registry';
import { pharmacyVFixture } from './fixtures';
import { resolveOverlapDisplacements, resolveOverlapPositions } from './overlaps';

const rects = (s: { nodes: Record<string, { bounds: { x: number; y: number; w: number; h: number } }> }, gap = 0) =>
  anyOverlap(Object.entries(s.nodes).map(([id, g]) => ({ id, ...g.bounds })), gap);

describe('resolveOverlapPositions', () => {
  it('crow\'s foot horizontal -> vertical switch: overlaps are resolved by moving nodes minimally', () => {
    // Positions chosen for the compact single-row tables; the vertical tables are much taller and collide.
    const f = pharmacyVFixture('crows-foot', 'horizontal');
    f.diagram.options.crowsFoot!.orientation = 'vertical';
    const scene = buildScene(f.project, f.diagram.id, defaultMeasure);
    expect(rects(scene).length).toBeGreaterThan(0);
    const pos = resolveOverlapPositions(scene);
    expect(Object.keys(pos).length).toBeGreaterThan(0);
    for (const [id, p] of Object.entries(pos)) {
      f.diagram.nodes[id]!.x = p.x;
      f.diagram.nodes[id]!.y = p.y;
    }
    const after = buildScene(f.project, f.diagram.id, defaultMeasure);
    expect(rects(after, 24 - 1e-6)).toEqual([]);
    // semantic edges untouched, every FK still ends on its exact rows (scene rebuilt without warnings)
    expect(after.warnings).toEqual([]);
  });

  it('returns nothing for a scene without overlaps and does not modify the scene', () => {
    const f = pharmacyVFixture('crows-foot', 'vertical');
    const scene = buildScene(f.project, f.diagram.id, defaultMeasure);
    const snapshot = JSON.stringify(scene.nodes);
    expect(resolveOverlapPositions(scene, { gap: 0 })).toEqual({});
    expect(JSON.stringify(scene.nodes)).toBe(snapshot);
  });

  it('works for ANY scene (Chen) and honours fixedIds', () => {
    const project: Project = buildExample('pharmacy');
    const chen = Object.values(project.diagrams).find((d) => d.type === 'chen')!;
    const ids = Object.keys(chen.nodes).slice(0, 2);
    const a = chen.nodes[ids[0]!]!;
    const b = chen.nodes[ids[1]!]!;
    b.x = a.x + 5;
    b.y = a.y + 5;
    const scene = buildScene(project, chen.id, defaultMeasure);
    const pos = resolveOverlapPositions(scene, { fixedIds: new Set([ids[0]!]) });
    expect(pos[ids[0]!]).toBeUndefined();
    expect(pos[ids[1]!]).toBeDefined();
    const disp = resolveOverlapDisplacements(scene, { fixedIds: new Set([ids[0]!]) });
    expect(disp[ids[1]!]!.dx).toBeCloseTo(pos[ids[1]!]!.x - scene.nodes[ids[1]!]!.bounds.x);
  });
});
