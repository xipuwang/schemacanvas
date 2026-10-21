import { describe, expect, it } from 'vitest';
import { parseProjectFile } from '@/model/io';
import { erBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Project } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { deepFreeze } from '@/test/deepFreeze';
import { exportDiagram, exportProjectJson, suggestFilename, clampPngScale, layoutPage, mapArrowGlyphs, findNonWinAnsiText } from './index';
import { EXAMPLE_KEYS, buildExampleProject, type ExampleProject } from './fixtures';
import { renderExportSvg, escapeXml } from './svg';

const examples = new Map<string, ExampleProject>();
async function ex(key: (typeof EXAMPLE_KEYS)[number]): Promise<ExampleProject> {
  let e = examples.get(key);
  if (!e) {
    e = await buildExampleProject(key);
    deepFreeze(e.project);
    examples.set(key, e);
  }
  return e;
}

/** Every absolute coordinate the SVG draws (shapes only, text anchors included), checked against the viewBox. */
function coordsOutside(svg: string, vb: { x: number; y: number; w: number; h: number }): string[] {
  const bad: string[] = [];
  const inX = (v: number) => v >= vb.x - 1e-6 && v <= vb.x + vb.w + 1e-6;
  const inY = (v: number) => v >= vb.y - 1e-6 && v <= vb.y + vb.h + 1e-6;
  for (const m of svg.matchAll(/<(rect|ellipse|line|polyline|polygon|text)\b([^>]*)>/g)) {
    const tag = m[1]!;
    const attrs = Object.fromEntries([...m[2]!.matchAll(/\s([a-zA-Z:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    const n = (k: string) => (attrs[k] === undefined ? undefined : Number(attrs[k]));
    const check = (what: string, v: number | undefined, axis: 'x' | 'y') => {
      if (v === undefined) return;
      if (!(axis === 'x' ? inX(v) : inY(v))) bad.push(`${tag} ${what}=${v}`);
    };
    if (tag === 'rect') {
      check('x', n('x'), 'x');
      check('y', n('y'), 'y');
      if (n('x') !== undefined) check('x+w', n('x')! + (n('width') ?? 0), 'x');
      if (n('y') !== undefined) check('y+h', n('y')! + (n('height') ?? 0), 'y');
    } else if (tag === 'ellipse') {
      check('cx-rx', n('cx')! - n('rx')!, 'x');
      check('cx+rx', n('cx')! + n('rx')!, 'x');
      check('cy-ry', n('cy')! - n('ry')!, 'y');
      check('cy+ry', n('cy')! + n('ry')!, 'y');
    } else if (tag === 'line') {
      check('x1', n('x1'), 'x');
      check('x2', n('x2'), 'x');
      check('y1', n('y1'), 'y');
      check('y2', n('y2'), 'y');
    } else if (tag === 'text') {
      check('x', n('x'), 'x');
      check('y', n('y'), 'y');
    } else {
      const pts = (attrs.points ?? '').trim().split(/\s+/).map((p) => p.split(',').map(Number));
      for (const [px, py] of pts) {
        check('px', px, 'x');
        check('py', py, 'y');
      }
    }
  }
  return bad;
}

describe('renderExportSvg', () => {
  for (const key of EXAMPLE_KEYS) {
    it(`example ${key}: structure, hygiene and bounds for ER and relational diagrams`, async () => {
      const e = await ex(key);
      for (const id of [e.erDiagramId, e.relDiagramId]) {
        const out = renderExportSvg(e.project, id);
        const { svg, viewBox: vb } = out;
        expect(svg.startsWith('<?xml')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toMatch(/<title>[^<]+<\/title><desc>/);
        expect(svg).not.toMatch(/var\(|foreignObject|<marker|<image|href=|url\(|<style|<script|data-node-id/);
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        // every <text> carries an explicit font-family
        const texts = [...svg.matchAll(/<text\b[^>]*>/g)];
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) expect(t[0]).toMatch(/font-family="[^"]+"/);
        // viewBox contains the scene's paint bounds with the padding on every side
        const scene = buildScene(e.project, id);
        expect(vb.x).toBeLessThanOrEqual(scene.bounds.x - 24 + 1e-6);
        expect(vb.y).toBeLessThanOrEqual(scene.bounds.y - 24 + 1e-6);
        expect(vb.x + vb.w).toBeGreaterThanOrEqual(scene.bounds.x + scene.bounds.w + 24 - 1e-6);
        expect(vb.y + vb.h).toBeGreaterThanOrEqual(scene.bounds.y + scene.bounds.h + 24 - 1e-6);
        for (const nid of scene.nodeOrder) {
          const b = scene.nodes[nid]!.paintBounds;
          expect(b.x).toBeGreaterThanOrEqual(vb.x);
          expect(b.x + b.w).toBeLessThanOrEqual(vb.x + vb.w);
          expect(b.y).toBeGreaterThanOrEqual(vb.y);
          expect(b.y + b.h).toBeLessThanOrEqual(vb.y + vb.h);
        }
        for (const eid of scene.edgeOrder) {
          const b = scene.edges[eid]!.bounds;
          expect(b.x).toBeGreaterThanOrEqual(vb.x);
          expect(b.x + b.w).toBeLessThanOrEqual(vb.x + vb.w);
          expect(b.y).toBeGreaterThanOrEqual(vb.y);
          expect(b.y + b.h).toBeLessThanOrEqual(vb.y + vb.h);
        }
        // and every absolute coordinate actually written into the file is inside the viewBox
        expect(coordsOutside(svg, vb)).toEqual([]);
        // width/height attributes equal the viewBox size
        expect(svg).toContain(`width="${vb.w}" height="${vb.h}"`);
      }
    }, 60_000);
  }

  it('is deterministic and does not mutate a frozen project', async () => {
    const e = await ex('E');
    const a = renderExportSvg(e.project, e.relDiagramId).svg;
    const b = renderExportSvg(e.project, e.relDiagramId).svg;
    expect(a).toBe(b);
  });

  it('background: white by default, none for transparent, palette background for dark', async () => {
    const e = await ex('B');
    const white = renderExportSvg(e.project, e.erDiagramId);
    expect(white.svg).toMatch(/<\/desc><rect [^>]*fill="#ffffff"\/>/);
    const tr = renderExportSvg(e.project, e.erDiagramId, { background: 'transparent' });
    expect(tr.svg).not.toMatch(/<\/desc><rect /);
    const dark = renderExportSvg(e.project, e.erDiagramId, { darkPalette: true });
    expect(dark.svg).toContain('#0f141a');
    expect(white.svg).not.toContain('#0f141a');
  });

  it('padding: default 24, min 2, custom respected', async () => {
    const e = await ex('C');
    const scene = buildScene(e.project, e.relDiagramId);
    const p = (pad?: number) => renderExportSvg(e.project, e.relDiagramId, { padding: pad }).viewBox;
    expect(scene.bounds.x - p().x).toBeCloseTo(24, 2);
    expect(scene.bounds.x - p(0).x).toBeCloseTo(2, 2);
    expect(scene.bounds.x - p(60).x).toBeCloseTo(60, 2);
    expect(p(60).w).toBeCloseTo(scene.bounds.w + 120, 2);
  });

  it('escapes names in title, desc and text (XML-significant characters, quotes, CJK)', () => {
    const b = erBuilder('ER');
    b.entity('A&B <"x"> \'q\'').key('Id').attr('名前 → 値');
    let project: Project = createBareProject('Proj <&> "quoted"');
    const d = withDiagram(project, b.build(), 'chen', { name: 'D<1>&' });
    project = deepFreeze(project);
    const { svg } = renderExportSvg(project, d.id);
    expect(svg).toContain('<title>Proj &lt;&amp;&gt; &quot;quoted&quot; - D&lt;1&gt;&amp;</title>');
    expect(svg).not.toContain('<x>');
    expect(svg).toContain('A&amp;B &lt;&quot;x&quot;&gt;');
    expect(svg).toContain('名前 → 値');
    expect(escapeXml('a\u0001b')).toBe('ab');
  });

  it('empty diagram: minimal blank sheet plus a warning, never throws', () => {
    const b = erBuilder('Empty');
    const project = createBareProject('E');
    const d = withDiagram(project, b.build(), 'chen');
    const out = renderExportSvg(deepFreeze(project), d.id);
    expect(out.empty).toBe(true);
    expect(out.warnings).toContain('diagram is empty');
    expect(out.width).toBeGreaterThan(0);
    expect(out.svg).toContain('viewBox="0 0 160 80"');
  });

  it('selectionNodeIds exports a sub-scene: only those nodes and the edges between them', async () => {
    const e = await ex('E');
    const rel = e.project.diagrams[e.relDiagramId]!;
    const model = e.project.models[rel.modelId]!;
    if (model.kind !== 'relational') throw new Error('expected relational model');
    const nameOf = (nid: string) => {
      const ref = rel.nodes[nid]!.ref;
      return ref.kind === 'relation' ? model.relations[ref.id]!.name : '';
    };
    const ids = Object.keys(rel.nodes);
    const pick = ids.filter((id) => ['Drug', 'Company'].includes(nameOf(id)));
    expect(pick).toHaveLength(2);
    const full = renderExportSvg(e.project, e.relDiagramId);
    const sub = renderExportSvg(e.project, e.relDiagramId, { selectionNodeIds: pick });
    expect(sub.width).toBeLessThan(full.width);
    expect(sub.svg).toContain('>Drug<');
    expect(sub.svg).toContain('>Company<');
    expect(sub.svg).not.toContain('>Pharmacy<');
    expect(sub.svg).not.toContain('>Prescription<');
    // exactly one FK between Drug and Company: one connector polyline (the full diagram has many)
    expect((sub.svg.match(/<polyline/g) ?? []).length).toBe(1);
    expect((full.svg.match(/<polyline/g) ?? []).length).toBeGreaterThan(5);
    expect(coordsOutside(sub.svg, sub.viewBox)).toEqual([]);
    // the original project is untouched (it is frozen, so a mutation would throw) and still has every edge
    expect(Object.keys(e.project.diagrams[e.relDiagramId]!.nodes)).toHaveLength(ids.length);
    // unknown ids are ignored with a warning; no valid ids -> blank sheet
    const none = renderExportSvg(e.project, e.relDiagramId, { selectionNodeIds: ['nope'] });
    expect(none.empty).toBe(true);
    expect(none.warnings.join()).toMatch(/not part of this diagram/);
  }, 60_000);

  it('selection export of a Chen entity keeps attribute edges only when the attribute is selected too', async () => {
    const e = await ex('B');
    const dg = e.project.diagrams[e.erDiagramId]!;
    const model = e.project.models[dg.modelId]!;
    if (model.kind !== 'er') throw new Error('expected er');
    const entityNode = Object.values(dg.nodes).find((n) => n.ref.kind === 'entity' && model.entities[n.ref.id]!.name === 'Company')!;
    const alone = renderExportSvg(e.project, e.erDiagramId, { selectionNodeIds: [entityNode.id] });
    expect(alone.svg).not.toContain('<ellipse');
    expect(alone.svg).not.toContain('<polyline');
    const attrNodes = Object.values(dg.nodes).filter((n) => n.ref.kind === 'attribute').map((n) => n.id);
    const both = renderExportSvg(e.project, e.erDiagramId, { selectionNodeIds: [entityNode.id, ...attrNodes] });
    expect(both.svg).toContain('<ellipse');
  });

  it('1000+ element diagram renders quickly and stays inside its viewBox', () => {
    const b = erBuilder('Big');
    for (let i = 0; i < 90; i++) {
      const en = b.entity(`E${i}`).key('Id');
      for (let a = 0; a < 11; a++) en.attr(`attr${a}`);
    }
    const project = createBareProject('Big');
    const d = withDiagram(project, b.build(), 'chen');
    Object.values(project.diagrams[d.id]!.nodes).forEach((n, i) => {
      n.x = (i % 40) * 150;
      n.y = Math.floor(i / 40) * 90;
    });
    expect(Object.keys(project.diagrams[d.id]!.nodes).length).toBeGreaterThan(1000);
    const t0 = performance.now();
    const out = renderExportSvg(project, d.id);
    const ms = performance.now() - t0;
    console.log(`1000+ element export (${Object.keys(d.nodes).length} nodes): ${ms.toFixed(0)} ms, ${(out.svg.length / 1024).toFixed(0)} KiB`);
    expect(ms).toBeLessThan(15_000);
    expect(coordsOutside(out.svg, out.viewBox)).toEqual([]);
  }, 60_000);

  it('very wide diagram keeps exact bounds', () => {
    const b = erBuilder('Wide');
    const e1 = b.entity('Left').key('Id');
    const e2 = b.entity('Right').key('Id');
    void e1;
    void e2;
    const project = createBareProject('W');
    const d = withDiagram(project, b.build(), 'chen');
    const nodes = Object.values(project.diagrams[d.id]!.nodes);
    nodes.forEach((n, i) => {
      n.x = i === 0 ? 0 : 50_000;
      n.y = 0;
    });
    const out = renderExportSvg(project, d.id);
    expect(out.width).toBeGreaterThan(50_000);
    expect(coordsOutside(out.svg, out.viewBox)).toEqual([]);
  });
});

describe('exportDiagram (non-DOM formats)', () => {
  it('svg result: mime, filename, info and blob content', async () => {
    const e = await ex('B');
    const r = await exportDiagram(e.project, e.erDiagramId, 'svg');
    expect(r.mime).toBe('image/svg+xml');
    expect(r.filename).toBe('Example B - ER Diagram.svg');
    expect(r.info.vector).toBe(true);
    const text = await r.blob.text();
    expect(text).toBe(renderExportSvg(e.project, e.erDiagramId).svg);
    expect(r.info.width).toBeGreaterThan(0);
  });

  it('json round-trips through the loader and preserves diagrams and positions', async () => {
    const e = await ex('E');
    const r = exportProjectJson(e.project);
    expect(r.filename).toBe('Example E.schemacanvas.json');
    const loaded = parseProjectFile(await r.blob.text());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.keys(loaded.project.diagrams)).toEqual(Object.keys(e.project.diagrams));
    expect(loaded.project.diagrams[e.relDiagramId]!.nodes).toEqual(e.project.diagrams[e.relDiagramId]!.nodes);
    expect(loaded.project.models).toEqual(e.project.models);
    const viaDiagram = await exportDiagram(e.project, e.relDiagramId, 'json');
    const strip = (t: string) => t.replace(/"savedAt": "[^"]*"/, '');
    expect(strip(await viaDiagram.blob.text())).toBe(strip(await r.blob.text()));
  });

  it('rejects an unknown diagram id', async () => {
    const e = await ex('B');
    await expect(exportDiagram(e.project, 'nope', 'svg')).rejects.toThrow(/unknown diagram/);
  });

  it('png/pdf need a browser and say so', async () => {
    const e = await ex('B');
    await expect(exportDiagram(e.project, e.erDiagramId, 'png')).rejects.toThrow(/browser/);
    await expect(exportDiagram(e.project, e.erDiagramId, 'pdf')).rejects.toThrow(/browser/);
  });
});

describe('suggestFilename', () => {
  it('<project> - <diagram>.<ext>', () => {
    expect(suggestFilename({ name: 'Pharmacy' }, { name: 'ER' }, 'svg')).toBe('Pharmacy - ER.svg');
    expect(suggestFilename({ name: 'Pharmacy' }, { name: 'ER' }, '.PNG')).toBe('Pharmacy - ER.png');
  });
  it('sanitises separators, control chars, reserved names and keeps Unicode', () => {
    expect(suggestFilename({ name: 'a/b\\c:d*e?f"g<h>i|j' }, { name: 'x' }, 'pdf')).toBe('a_b_c_d_e_f_g_h_i_j - x.pdf');
    expect(suggestFilename({ name: '课程设计 — Café' }, { name: '关系模式' }, 'svg')).toBe('课程设计 — Café - 关系模式.svg');
    expect(suggestFilename({ name: 'CON' }, { name: 'aux' }, 'svg')).toBe('_CON - _aux.svg');
    expect(suggestFilename({ name: '' }, { name: '  ' }, 'svg')).toBe('project - diagram.svg');
    expect(suggestFilename({ name: '..hidden.' }, { name: '...' }, 'svg')).toBe('hidden - diagram.svg');
    expect(suggestFilename({ name: 'x\u0000y\n' }, { name: 'd' }, 'svg')).toBe('x_y_ - d.svg');
  });
  it('NFC-normalises and caps length', () => {
    expect(suggestFilename({ name: 'Café' }, { name: 'd' }, 'svg')).toBe('Café - d.svg');
    const long = suggestFilename({ name: 'x'.repeat(300) }, { name: 'y'.repeat(300) }, 'svg');
    expect(long.length).toBeLessThan(200);
  });
  it('json is project-level', () => {
    expect(suggestFilename({ name: 'P' }, { name: 'D' }, 'json')).toBe('P.schemacanvas.json');
  });
});

describe('clampPngScale', () => {
  it('keeps the requested scale when it fits', () => {
    expect(clampPngScale(1000, 500, 2)).toMatchObject({ scale: 2, width: 2000, height: 1000, clamped: false });
    expect(clampPngScale(1000.2, 500.1, 2)).toMatchObject({ width: 2001, height: 1001 });
    expect(clampPngScale(10, 10)).toMatchObject({ scale: 2 });
  });
  it('clamps long sides to 16384 and area to 16,777,216', () => {
    const wide = clampPngScale(20_000, 100, 2);
    expect(wide.clamped).toBe(true);
    expect(wide.width).toBeLessThanOrEqual(16384);
    const big = clampPngScale(5000, 5000, 2);
    expect(big.width * big.height).toBeLessThanOrEqual(16_777_216);
    expect(big.clamped).toBe(true);
    for (const [w, h] of [[16384.3, 10], [4096.5, 4096.5], [123456, 7], [1, 1e6]] as const) {
      const c = clampPngScale(w, h, 3);
      expect(c.width).toBeLessThanOrEqual(16384);
      expect(c.height).toBeLessThanOrEqual(16384);
      expect(c.width * c.height).toBeLessThanOrEqual(16_777_216);
      expect(c.width).toBe(Math.max(1, Math.ceil(w * c.scale - 1e-9)));
    }
  });
});

describe('PDF helpers', () => {
  it('maps arrow glyphs and detects remaining non-WinAnsi text', () => {
    expect(mapArrowGlyphs('A → B ← C ↔ D')).toBe('A -> B <- C <-> D');
    const svg = '<svg><text x="1">Café &amp; –</text><text>名前</text><text><tspan>→</tspan></text></svg>';
    expect(findNonWinAnsiText(svg)).toEqual(['名前', '→']);
    expect(findNonWinAnsiText(mapArrowGlyphs(svg))).toEqual(['名前']);
    expect(findNonWinAnsiText('<svg><text>&#x540d;</text></svg>')).toEqual(['名']);
  });
  it('fit page = content in pt plus margin', () => {
    const p = layoutPage(800, 400, {});
    expect(p).toMatchObject({ pageW: 600, pageH: 300, x: 0, y: 0, w: 600, h: 300 });
    const m = layoutPage(800, 400, { margin: 10 });
    expect(m).toMatchObject({ pageW: 620, pageH: 320, x: 10, y: 10 });
  });
  it('a4/letter: orientation, fit inside margins, centred, never cropped', () => {
    const wide = layoutPage(2000, 500, { pageSize: 'a4' });
    expect(wide.pageW).toBeCloseTo(841.89, 2);
    expect(wide.pageH).toBeCloseTo(595.28, 2);
    expect(wide.x).toBeGreaterThanOrEqual(36 - 1e-9);
    expect(wide.x + wide.w).toBeLessThanOrEqual(wide.pageW - 36 + 1e-9);
    expect(wide.y + wide.h).toBeLessThanOrEqual(wide.pageH - 36 + 1e-9);
    expect(wide.w / wide.h).toBeCloseTo(4, 6);
    const tall = layoutPage(300, 2000, { pageSize: 'letter' });
    expect(tall.pageW).toBe(612);
    expect(tall.pageH).toBe(792);
    expect(tall.y).toBeGreaterThanOrEqual(36 - 1e-9);
    const forced = layoutPage(2000, 500, { pageSize: 'letter', orientation: 'portrait' });
    expect(forced.pageW).toBe(612);
    const small = layoutPage(100, 40, { pageSize: 'a4' });
    expect(small.w).toBeCloseTo(75, 6);
    expect(small.x).toBeCloseTo((small.pageW - 75) / 2, 6);
  });
  it('caps absurdly wide fit pages at the PDF limit', () => {
    const p = layoutPage(40_000, 100, {});
    expect(p.pageW).toBeLessThanOrEqual(14400 + 1e-6);
    expect(p.warnings.length).toBe(1);
  });
});
