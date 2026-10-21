// VISUAL=1 npx vitest run src/examples/visual.test.ts -> .tmp/examples/<id>-er|rel.svg (then node scripts/svg2png.mjs)
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderSceneToSvgString } from '@/render/standalone';
import { buildScene } from '@/scene/registry';
import { EXAMPLES } from './catalog';
import { TEMPLATES } from './templates';
import { createBareProject } from '@/model/defaults';
import { createDiagram } from '@/model/defaults';
import { insertTemplate } from './templates';

import { withDiagram } from '@/model/diagramSync';
import { createErModel, createRelationalModel } from '@/model/defaults';
const ex0 = (kind: 'er' | 'relational') => {
  const p = createBareProject('t');
  if (kind === 'er') withDiagram(p, createErModel('m'), 'chen');
  else withDiagram(p, createRelationalModel('m'), 'relational-schema');
  return p;
};
describe.skipIf(!process.env.VISUAL)('render examples', () => {
  for (const ex of EXAMPLES) {
    it(ex.id, () => {
      mkdirSync('.tmp/examples', { recursive: true });
      const p = ex.build();
      for (const dId of p.diagramOrder) {
        const d = p.diagrams[dId]!;
        const svg = renderSceneToSvgString(buildScene(p, dId), p, d, { padding: 24 });
        writeFileSync(`.tmp/examples/${ex.id}-${d.type === 'chen' ? 'er' : 'rel'}.svg`, svg);
      }
    });
  }

  for (const t of TEMPLATES) {
    it('template ' + t.id, () => {
      mkdirSync('.tmp/examples', { recursive: true });
      const p = ex0(t.modelKind);
      const d = Object.values(p.diagrams)[0]!;
      insertTemplate(p, d.id, t.id, { x: 0, y: 0 });
      writeFileSync(`.tmp/examples/tpl-${t.id}.svg`, renderSceneToSvgString(buildScene(p, d.id), p, p.diagrams[d.id]!, { padding: 24 }));
    });
  }
});
