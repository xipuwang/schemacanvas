/** Visual verification: `VISUAL=1 npx vitest run src/render/chen/visual.test.tsx`, then rasterise .tmp/chen/*.svg and LOOK. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import '@/render/chen';
import { darkPalette } from '@/render/palette';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { defaultMeasure } from '@/scene/measure';
import { buildChenScene } from '@/scene/chen';
import { ALL_FIXTURES, layoutChenFixture } from '@/scene/chen/fixtures';

const OUT = '.tmp/chen';

function write(name: string, svg: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.svg`, svg);
}

describe.skipIf(!process.env.VISUAL)('chen visual fixtures', () => {
  for (const make of ALL_FIXTURES) {
    const fx = make();
    it(`renders ${fx.name}`, () => {
      const { project, diagram, model } = layoutChenFixture(fx, (d) => {
        d.options.chen!.showRoles = true;
      });
      const scene = buildChenScene({ project, diagram, model, measure: defaultMeasure });
      write(fx.name, renderSceneToSvgStringCore(scene, project, diagram));
    });
  }

  it('renders pharmacy orthogonal + minmax + data types (light)', () => {
    const fx = ALL_FIXTURES[6]!();
    const { project, diagram, model } = layoutChenFixture(fx, (d) => {
      d.options.chen!.routing = 'orthogonal';
      d.options.chen!.cardinalityStyle = 'minmax';
    });
    const scene = buildChenScene({ project, diagram, model, measure: defaultMeasure });
    write('pharmacy-orthogonal', renderSceneToSvgStringCore(scene, project, diagram));
  });

  it('renders example A with data types and example C orthogonal', () => {
    const fxA = ALL_FIXTURES[0]!();
    // Types must exist BEFORE layout: the fixture layout reads node sizes from the scene.
    for (const att of Object.values(fxA.model.attributes)) att.dataType = att.name === 'SID' ? 'INT' : 'VARCHAR(50)';
    const a = layoutChenFixture(fxA, (d) => {
      d.options.chen!.showDataTypes = true;
    });
    write('example-a-types', renderSceneToSvgStringCore(buildChenScene({ ...a, measure: defaultMeasure }), a.project, a.diagram));
    const c = layoutChenFixture(ALL_FIXTURES[2]!(), (d) => {
      d.options.chen!.routing = 'orthogonal';
    });
    write('example-c-orthogonal', renderSceneToSvgStringCore(buildChenScene({ ...c, measure: defaultMeasure }), c.project, c.diagram));
  });

  it('renders pharmacy with the dark palette', () => {
    const fx = ALL_FIXTURES[6]!();
    const { project, diagram, model } = layoutChenFixture(fx);
    const scene = buildChenScene({ project, diagram, model, measure: defaultMeasure });
    write('pharmacy-dark', renderSceneToSvgStringCore(scene, project, diagram, { palette: darkPalette, background: darkPalette.background }));
  });
});
