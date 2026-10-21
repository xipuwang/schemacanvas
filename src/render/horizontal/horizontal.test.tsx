// jsdom ships no type declarations in this repo (no @types/jsdom installed and we may not add deps).
// @ts-expect-error TS7016
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import '@/render/horizontal';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { bracketFixture, outOfOrderFixture, pharmacyFixture, type Fixture } from '@/scene/horizontal/fixtures';
import { buildHorizontalScene } from '@/scene/horizontal';
import { defaultMeasure } from '@/scene/measure';

function render(f: Fixture) {
  const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
  const svg = renderSceneToSvgStringCore(scene, f.project, f.diagram);
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document as Document;
  return { scene, svg, doc };
}

describe('horizontal SVG output', () => {
  it('SVG hygiene: no markers/text-decoration/CSS vars, explicit font-family on every text', () => {
    const { svg, doc } = render(pharmacyFixture());
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('text-decoration');
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('dominant-baseline');
    for (const t of Array.from(doc.querySelectorAll('text'))) expect(t.getAttribute('font-family')).toBeTruthy();
  });

  it('every cell has data-column-id and role; every FK branch has data-fk-branch / data-fk-target matching the model', () => {
    const f = pharmacyFixture();
    const { doc } = render(f);
    const cells = Array.from(doc.querySelectorAll('[data-column-id]'));
    const columns = Object.values(f.model.relations).flatMap((r) => r.columns.map((c) => c.id));
    expect(cells.map((c) => c.getAttribute('data-column-id')).sort()).toEqual([...columns].sort());
    const branches = Array.from(doc.querySelectorAll('[data-fk-branch]'));
    const expected = Object.values(f.model.foreignKeys).flatMap((fk) => fk.columns.map((c) => `${c.sourceColumnId}>${c.targetColumnId}`));
    expect(branches.map((b) => `${b.getAttribute('data-fk-branch')}>${b.getAttribute('data-fk-target')}`).sort()).toEqual([...expected].sort());
  });

  it('PK / FK / PK+FK / plain are distinguishable WITHOUT colour: underline line and italic', () => {
    const f = pharmacyFixture();
    const { doc } = render(f);
    const drug = f.rel.Drug!;
    const cell = (id: string) => doc.querySelector(`[data-column-id="${id}"]`)!;
    const hasUnderline = (el: Element) => el.querySelectorAll('line').length > 0;
    const italic = (el: Element) => el.querySelector('text')!.getAttribute('font-style') === 'italic';
    const pkfk = cell(drug.col('CompanyName'));
    const pk = cell(drug.col('TradeName'));
    const plain = cell(drug.col('Formula'));
    const fk = cell(f.rel.Patient!.col('DoctorSSN'));
    expect([hasUnderline(pkfk), italic(pkfk)]).toEqual([true, true]);
    expect([hasUnderline(pk), italic(pk)]).toEqual([true, false]);
    expect([hasUnderline(fk), italic(fk)]).toEqual([false, true]);
    expect([hasUnderline(plain), italic(plain)]).toEqual([false, false]);
  });

  it('arrowhead polygons end exactly at the branch tip; strokes end at the base', () => {
    const f = pharmacyFixture();
    const { scene, doc } = render(f);
    for (const e of Object.values(scene.edges)) {
      if (e.kind !== 'fk') continue;
      for (const b of e.branches) {
        const g = doc.querySelector(`[data-fk-branch="${b.sourceColumnId}"][data-fk-target="${b.targetColumnId}"]`)!;
        const poly = g.querySelector('polygon')!.getAttribute('points')!.split(' ')[0]!;
        expect(poly).toBe(`${b.arrow.tip.x},${b.arrow.tip.y}`);
        const line = g.querySelector('polyline')!.getAttribute('points')!.split(' ');
        expect(line[line.length - 1]).toBe(`${b.arrow.base.x},${b.arrow.base.y}`);
      }
    }
  });

  it('export is not clipped: the viewBox contains every path point, arrow and label rect', () => {
    const f = pharmacyFixture();
    f.diagram.options.relational!.fkLabels = true;
    const { scene, svg } = render(f);
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number) as [number, number, number, number];
    const inside = (x: number, y: number) => x >= vb[0] && x <= vb[0] + vb[2] && y >= vb[1] && y <= vb[1] + vb[3];
    for (const e of Object.values(scene.edges)) {
      for (const p of e.paths.flat()) expect(inside(p.x, p.y)).toBe(true);
      expect(inside(e.bounds.x, e.bounds.y) && inside(e.bounds.x + e.bounds.w, e.bounds.y + e.bounds.h)).toBe(true);
    }
    for (const n of Object.values(scene.nodes)) expect(inside(n.paintBounds.x, n.paintBounds.y) && inside(n.paintBounds.x + n.paintBounds.w, n.paintBounds.y + n.paintBounds.h)).toBe(true);
  });

  it('bracket edges draw two bracket polylines and one arrow; crossing composite pairs get pair numbers', () => {
    const b = render(bracketFixture('bracket'));
    expect(b.doc.querySelectorAll('[data-fk-branch]')).toHaveLength(1);
    expect(b.doc.querySelectorAll('[data-fk-style="bracket"] > polyline')).toHaveLength(2);
    const crossing = render(outOfOrderFixture());
    expect(crossing.doc.querySelectorAll('circle').length).toBe(4); // 2 pairs x (source + target)
    const ordered = render(bracketFixture('branches'));
    expect(ordered.doc.querySelectorAll('circle')).toHaveLength(0);
  });
});
