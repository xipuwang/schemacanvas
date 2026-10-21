// Dev tool (not part of the normal suite): EXAMPLES_DUMP=1 npx vitest run src/examples/devLayout.test.ts
// Writes .tmp/examples/auto-<id>.json = autoLayout positions keyed by node name + node sizes, as a starting point
// for the hand-tuned tables in layouts.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { autoLayout } from '@/layout';
import { buildScene } from '@/scene/registry';
import { buildExampleUnplaced, EXAMPLES } from './catalog';
import { nodeKey } from './nodeKeys';

describe.skipIf(!process.env.EXAMPLES_DUMP)('dump auto layout', () => {
  for (const ex of EXAMPLES) {
    it(ex.id, async () => {
      const p = buildExampleUnplaced(ex.id);
      const out: Record<string, unknown> = {};
      for (const dId of p.diagramOrder) {
        const d = p.diagrams[dId]!;
        const m = p.models[d.modelId]!;
        const scene = buildScene(p, dId);
        const pos = await autoLayout(scene, p, dId);
        const table: Record<string, [number, number, number, number]> = {};
        for (const n of Object.values(d.nodes)) {
          const k = nodeKey(m, n)!;
          const q = pos[n.id] ?? n;
          const b = scene.nodes[n.id]!.bounds;
          table[k] = [Math.round(q.x), Math.round(q.y), Math.round(b.w), Math.round(b.h)];
        }
        out[d.type === 'chen' ? 'er' : 'rel'] = table;
      }
      mkdirSync('.tmp/examples', { recursive: true });
      writeFileSync(`.tmp/examples/auto-${ex.id}.json`, JSON.stringify(out, null, 1));
    });
  }
});
