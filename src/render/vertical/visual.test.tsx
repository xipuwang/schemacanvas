/**
 * Visual verification harness. Run with:  VISUAL=1 npx vitest run src/render/vertical/visual
 * then:  for f in .tmp/crows/*.svg; do node scripts/svg2png.mjs $f ${f%.svg}.png; done   and LOOK at every PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import '@/render/vertical';
import { darkPalette } from '@/render/palette';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { defaultMeasure } from '@/scene/measure';
import { buildVerticalScene } from '@/scene/vertical';
import { cardinalityFixture, pharmacyVFixture, type VFixture } from '@/scene/vertical/fixtures';

function dump(name: string, f: VFixture, dark = false): void {
  const scene = buildVerticalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
  const svg = renderSceneToSvgStringCore(scene, f.project, f.diagram, dark ? { palette: darkPalette, background: darkPalette.background } : {});
  mkdirSync('.tmp/crows', { recursive: true });
  writeFileSync(`.tmp/crows/${name}.svg`, svg);
  if (scene.warnings.length) writeFileSync(`.tmp/crows/${name}.warnings.txt`, scene.warnings.join('\n'));
}

describe.skipIf(!process.env.VISUAL)('vertical visual dump', () => {
  it('writes every fixture in every mode', () => {
    dump('pharmacy-cf-vertical', pharmacyVFixture('crows-foot', 'vertical'));
    dump('pharmacy-cf-horizontal', pharmacyVFixture('crows-foot', 'horizontal'));
    dump('pharmacy-physical', pharmacyVFixture('physical'));
    const minimal = pharmacyVFixture('physical');
    minimal.diagram.options.physical!.showIndexes = false;
    minimal.diagram.options.physical!.showConstraints = false;
    dump('pharmacy-physical-minimal', minimal);
    dump('card-cf-vertical', cardinalityFixture('crows-foot', 'vertical'));
    dump('card-cf-horizontal', cardinalityFixture('crows-foot', 'horizontal'));
    dump('card-physical', cardinalityFixture('physical'));
    dump('pharmacy-cf-vertical-dark', pharmacyVFixture('crows-foot', 'vertical'), true);
    const labelled = pharmacyVFixture('crows-foot', 'vertical');
    for (const e of Object.values(labelled.diagram.edges)) e.labelVisible = true;
    dump('pharmacy-cf-labels', labelled);
  });
});
