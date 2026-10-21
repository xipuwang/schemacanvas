/**
 * Visual verification harness. Run with:  VISUAL=1 npx vitest run src/render/horizontal/visual
 * then:  for f in .tmp/horizontal/*.svg; do node scripts/svg2png.mjs $f ${f%.svg}.png; done   and LOOK at every PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import '@/render/horizontal';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { buildHorizontalScene } from '@/scene/horizontal';
import {
  bracketFixture,
  detourFixture,
  employeeFixture,
  outOfOrderFixture,
  pharmacyFixture,
  prereqFixture,
  studentFixture,
  tangledFixture,
  typedFixture,
  type Fixture,
} from '@/scene/horizontal/fixtures';
import { defaultMeasure } from '@/scene/measure';

function dump(name: string, f: Fixture): void {
  const model = f.model;
  const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model, measure: defaultMeasure });
  const svg = renderSceneToSvgStringCore(scene, f.project, f.diagram);
  mkdirSync('.tmp/horizontal', { recursive: true });
  writeFileSync(`.tmp/horizontal/${name}.svg`, svg);
  if (scene.warnings.length) writeFileSync(`.tmp/horizontal/${name}.warnings.txt`, scene.warnings.join('\n'));
}

describe.skipIf(!process.env.VISUAL)('horizontal visual dump', () => {
  it('writes every fixture', () => {
    dump('student', studentFixture());
    dump('pharmacy', pharmacyFixture());
    dump('prereq', prereqFixture());
    dump('employee', employeeFixture());
    dump('detour', detourFixture());
    dump('typed', typedFixture());
    dump('tangled', tangledFixture());
    dump('out-of-order', outOfOrderFixture());
    dump('composite-branches', bracketFixture('branches'));
    dump('composite-bracket', bracketFixture('bracket'));
    const labelled = pharmacyFixture();
    labelled.diagram.options.relational!.fkLabels = true;
    dump('pharmacy-labels', labelled);
    const left = studentFixture();
    left.diagram.options.relational!.nameAbove = false;
    dump('student-name-left', left);
  });
});
