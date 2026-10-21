// @vitest-environment node
/**
 * Drag-performance regression: scene build time per pointer move (DRAFT mode, against the last full build) on the big
 * generated projects. Loose thresholds by default (shared / loaded machines), the spec targets with PERF=1.
 */
import { describe, expect, it } from 'vitest';
import { buildScene } from '@/scene/registry';
import { buildBigProject, type BigKind } from './perfFixtures';

const strict = process.env.PERF === '1';
const CASES: Array<{ kind: BigKind; targetMs: number; counts: [number, number] }> = [
  { kind: 'rel40', targetMs: 16, counts: [40, 60] },
  { kind: 'rel87', targetMs: 33, counts: [87, 100] },
  { kind: 'chen60', targetMs: 16, counts: [200, 200] },
];

describe('drag performance (scene build per move)', () => {
  for (const c of CASES) {
    it(`${c.kind}: draft build per move stays within budget and the drop equals a fresh full build`, async () => {
      const { project, diagramId } = await buildBigProject(c.kind);
      const d = project.diagrams[diagramId]!;
      const model = project.models[d.modelId]!;
      const t0 = performance.now();
      const base = buildScene(project, diagramId);
      const fullMs = performance.now() - t0;
      expect(Object.keys(base.nodes).length).toBeGreaterThanOrEqual(c.counts[0]);
      expect(Object.keys(base.edges).length).toBeGreaterThanOrEqual(c.counts[1]);
      const victim = Object.keys(d.nodes)[7]!;
      const times: number[] = [];
      let last = project;
      for (let i = 1; i <= 25; i++) {
        const n = d.nodes[victim]!;
        last = { ...project, diagrams: { ...project.diagrams, [diagramId]: { ...d, nodes: { ...d.nodes, [victim]: { ...n, x: n.x + i * 4, y: n.y + i * 2 } } } } };
        const t = performance.now();
        const draft = buildScene(last, diagramId, undefined, { quality: 'draft', previous: { scene: base, diagram: d, model } });
        times.push(performance.now() - t);
        expect(draft.quality).toBe('draft');
        expect(Object.keys(draft.edges)).toHaveLength(Object.keys(base.edges).length);
      }
      times.sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)]!;
      // eslint-disable-next-line no-console
      console.log(`[drag perf] ${c.kind}: full build ${fullMs.toFixed(1)} ms, draft per move median ${median.toFixed(2)} ms (target ${c.targetMs} ms)`);
      expect(median).toBeLessThanOrEqual(strict ? c.targetMs : c.targetMs * 5);
      // the end state after the drop is a fresh FULL build, independent of any draft that ran before it
      expect(JSON.stringify(buildScene(last, diagramId))).toBe(JSON.stringify(buildScene(last, diagramId, undefined, { quality: 'full', previous: { scene: base, diagram: d, model } })));
    }, 120_000);
  }
});
