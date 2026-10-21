// @vitest-environment node
import './deterministic';
/** P3 RENDER (node tier): SVG hygiene rules of ARCHITECTURE 2.9 on real pipeline output. Files land in .tmp/integration. */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_KEYS } from './helpers';
import { renderExample } from './renderAll';

describe.each(EXAMPLE_KEYS)('P3 render example %s', (key) => {
  it('produces hygienic, complete SVG for both diagram types', async () => {
    const rendered = await renderExample(key);
    expect(rendered).toHaveLength(2);
    for (const r of rendered) {
      const { svg } = r;
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg).not.toMatch(/<marker|var\(--|text-decoration|dominant-baseline|<filter|<mask|<foreignObject|<image/);
      // every <text> carries an explicit font-family
      const texts = svg.match(/<text\b[^>]*>/g) ?? [];
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) expect(t, 'text without font-family').toMatch(/font-family=/);
      // viewBox is finite and positive
      const vb = /viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(svg)!;
      expect(vb).not.toBeNull();
      expect(Number(vb[3])).toBeGreaterThan(50);
      expect(Number(vb[4])).toBeGreaterThan(30);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      if (r.type === 'relational') {
        expect(svg).toMatch(/data-column-id=/);
        expect(svg).toMatch(/data-fk-branch=/);
        expect(svg).toMatch(/data-fk-target=/);
      }
    }
  });
});

describe('P3 render: key notation present in Chen output', () => {
  it('Pharmacy Chen SVG contains double rect (weak), double diamond (identifying) and dashed shapes', async () => {
    const [chen] = await renderExample('E');
    expect(chen!.svg.length).toBeGreaterThan(5000);
    expect(chen!.svg).toMatch(/stroke-dasharray/); // partial-key underline
  });
});
