// @ts-expect-error TS7016
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import '@/render/vertical';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { defaultMeasure } from '@/scene/measure';
import { buildVerticalScene } from '@/scene/vertical';
import { cardinalityFixture, pharmacyVFixture, type VFixture } from '@/scene/vertical/fixtures';

function render(f: VFixture) {
  const scene = buildVerticalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
  const svg = renderSceneToSvgStringCore(scene, f.project, f.diagram);
  return { scene, svg, doc: new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document as Document };
}

describe.each([
  ['crows-foot vertical', () => pharmacyVFixture('crows-foot', 'vertical')],
  ['crows-foot horizontal', () => pharmacyVFixture('crows-foot', 'horizontal')],
  ['physical', () => pharmacyVFixture('physical')],
])('vertical SVG output: %s', (_n, make) => {
  it('SVG hygiene: no markers/text-decoration/CSS vars, font-family on every text', () => {
    const { svg, doc } = render(make());
    for (const bad of ['<marker', 'text-decoration', 'var(--', 'dominant-baseline']) expect(svg).not.toContain(bad);
    for (const t of Array.from(doc.querySelectorAll('text'))) expect(t.getAttribute('font-family')).toBeTruthy();
  });

  it('every row has data-column-id/role; every FK carries its attached pair and symbols', () => {
    const f = make();
    const { doc } = render(f);
    const columns = Object.values(f.model.relations).flatMap((r) => r.columns.map((c) => c.id));
    expect(Array.from(doc.querySelectorAll('[data-column-id]')).map((c) => c.getAttribute('data-column-id')).sort()).toEqual([...columns].sort());
    const fkEls = Array.from(doc.querySelectorAll('[data-fk-branch]'));
    const expected = Object.values(f.model.foreignKeys).map((fk) => `${fk.columns[0]!.sourceColumnId}>${fk.columns[0]!.targetColumnId}`);
    expect(fkEls.map((b) => `${b.getAttribute('data-fk-branch')}>${b.getAttribute('data-fk-target')}`).sort()).toEqual([...expected].sort());
    for (const el of fkEls) expect(el.querySelectorAll('[data-symbol]')).toHaveLength(2);
  });
});

describe('role encodings survive grayscale', () => {
  it('PK underlined, FK italic, PK+FK both, with text badges', () => {
    const { svg, doc } = render(pharmacyVFixture('crows-foot', 'vertical'));
    expect(svg).toContain('font-style="italic"');
    const badges = Array.from(doc.querySelectorAll('text')).map((t) => t.textContent);
    expect(badges).toContain('PK');
    expect(badges).toContain('FK');
    expect(badges).toContain('PK FK');
  });

  it('composite FK member dots are drawn', () => {
    const { doc } = render(cardinalityFixture());
    expect(doc.querySelectorAll('[data-fk-member]').length).toBe(2);
  });
});
