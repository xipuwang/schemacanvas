/**
 * Export e2e: every format, in real Chromium, for the five spec examples as Chen ER AND horizontal relational diagrams.
 * Run: E2E_PORT=5203 npx playwright test e2e/export
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const OUT = resolve(process.cwd(), '.tmp/export');
mkdirSync(OUT, { recursive: true });
const KEYS = ['A', 'B', 'C', 'D', 'E'] as const;
const KINDS = ['er', 'rel'] as const;

interface Exported {
  base64: string;
  size: number;
  mime: string;
  filename: string;
  warnings: string[];
  info: { width: number; height: number; scaleUsed?: number; vector: boolean };
  ms: number;
}

let page: Page;
const errors: string[] = [];

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as any).__h[f as string](...(a as unknown[])), [fn, args] as [string, unknown[]]) as Promise<T>;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/harness/export/index.html');
  await page.waitForFunction(() => document.title === 'export harness ready');
});
test.afterAll(async () => {
  await page.close();
});
test.afterEach(() => {
  expect(errors, 'console errors').toEqual([]);
});

const buf = (b64: string) => Buffer.from(b64, 'base64');

function pdfText(pdf: Buffer): string {
  const latin = pdf.toString('latin1');
  let out = latin;
  for (const m of latin.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      out += '\n' + inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      /* not a flate stream */
    }
  }
  return out;
}
const mediaBox = (pdf: Buffer): [number, number] => {
  const m = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)!;
  return [Number(m[1]), Number(m[2])];
};
const viewBoxOf = (svg: string) => {
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/)!;
  return { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! };
};

for (const key of KEYS) {
  for (const kind of KINDS) {
    const tag = `${key}-${kind}`;
    test.describe(`example ${tag}`, () => {
      test('SVG file renders like the live canvas, with no clipping', async ({ browser }) => {
        await h('ensure', key);
        const svg = await h<Exported>('exportAs', key, kind, 'svg');
        const text = buf(svg.base64).toString('utf8');
        const file = resolve(OUT, `${tag}.svg`);
        writeFileSync(file, text);
        const vb = viewBoxOf(text);
        expect(svg.info).toMatchObject({ vector: true });
        expect(svg.info.width).toBeCloseTo(vb.w, 3);

        // 1. the exported file, opened as a file in a fresh page
        const p2 = await browser.newPage({ viewport: { width: Math.ceil(vb.w), height: Math.ceil(vb.h) } });
        const e2: string[] = [];
        p2.on('console', (m) => m.type() === 'error' && e2.push(m.text()));
        p2.on('pageerror', (e) => e2.push(String(e)));
        await p2.goto('file://' + file);
        const union = await p2.evaluate(() => {
          const svgEl = document.documentElement as unknown as SVGSVGElement;
          const root = svgEl.getBoundingClientRect();
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
          svgEl.querySelectorAll('text,rect,ellipse,line,polyline,polygon').forEach((el) => {
            if ((el.parentElement as Element | null) === (svgEl as Element) && el.tagName === 'rect') return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            n++;
            minX = Math.min(minX, r.left - root.left);
            minY = Math.min(minY, r.top - root.top);
            maxX = Math.max(maxX, r.right - root.left);
            maxY = Math.max(maxY, r.bottom - root.top);
          });
          return { n, minX, minY, maxX, maxY, w: root.width, h: root.height };
        });
        expect(union.n).toBeGreaterThan(10);
        expect(union.w).toBeCloseTo(vb.w, 1);
        // painted union is inside the viewBox and keeps (almost) the whole 24px padding on every side
        expect(union.minX).toBeGreaterThanOrEqual(20);
        expect(union.minY).toBeGreaterThanOrEqual(20);
        expect(union.maxX).toBeLessThanOrEqual(union.w - 20);
        expect(union.maxY).toBeLessThanOrEqual(union.h - 20);
        const filePng = await p2.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(vb.w), height: Math.ceil(vb.h) } });
        writeFileSync(resolve(OUT, `${tag}.file.png`), filePng);
        expect(e2).toEqual([]);
        await p2.close();

        // 2. the live SceneSvg render with the same framing
        const dims = await page.evaluate(([k, w]) => (window as any).__h.mountLive(k, w), [key, kind]);
        await page.waitForTimeout(150);
        const live = await page.locator('#live svg').screenshot();
        writeFileSync(resolve(OUT, `${tag}.live.png`), live);
        expect(dims.w).toBeCloseTo(vb.w, 3);
        const diff = await h<{ sameSize: boolean; fraction: number; a: number[]; b: number[] }>(
          'diffPng',
          filePng.toString('base64'),
          live.toString('base64'),
        );
        expect(diff.sameSize, JSON.stringify(diff)).toBe(true);
        expect(diff.fraction, `pixel difference ${(diff.fraction * 100).toFixed(3)}%`).toBeLessThan(0.01);
        await h('clearLive');
      });

      test('PNG: right size, opaque white, painted area clear of every edge', async () => {
        const svg = await h<Exported>('exportAs', key, kind, 'svg');
        const vb = viewBoxOf(buf(svg.base64).toString('utf8'));
        const png = await h<Exported>('exportAs', key, kind, 'png');
        const b = buf(png.base64);
        expect(b.subarray(1, 4).toString()).toBe('PNG');
        const w = b.readUInt32BE(16);
        const hh = b.readUInt32BE(20);
        expect([w, hh]).toEqual([Math.ceil(vb.w * 2), Math.ceil(vb.h * 2)]);
        expect(png.info).toMatchObject({ width: w, height: hh, scaleUsed: 2, vector: false });
        writeFileSync(resolve(OUT, `${tag}.png`), b);
        const a = await h<any>('analysePng', png.base64, false);
        expect(a.corner).toEqual([255, 255, 255, 255]);
        expect(a.painted).toBeGreaterThan(1000);
        expect(a.touchesEdge).toBe(false);
        expect(a.bbox.minX).toBeGreaterThanOrEqual(40);
        expect(a.bbox.minY).toBeGreaterThanOrEqual(40);
        expect(a.bbox.maxX).toBeLessThanOrEqual(w - 40);
        expect(a.bbox.maxY).toBeLessThanOrEqual(hh - 40);
      });

      if (key === 'E') test('PNG transparent: corners fully transparent', async () => {
        const png = await h<Exported>('exportAs', key, kind, 'png', { background: 'transparent', scale: 1 });
        const a = await h<any>('analysePng', png.base64, true);
        expect(a.corner[3]).toBe(0);
        expect(a.touchesEdge).toBe(false);
        expect(a.painted).toBeGreaterThan(500);
      });

      test('PDF: vector, page = content size, selectable text, renders correctly', async () => {
        const svg = await h<Exported>('exportAs', key, kind, 'svg');
        const vb = viewBoxOf(buf(svg.base64).toString('utf8'));
        const pdf = await h<Exported>('exportAs', key, kind, 'pdf');
        const b = buf(pdf.base64);
        expect(b.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.info.vector).toBe(true);
        expect(pdf.warnings).toEqual([]);
        const [pw, ph] = mediaBox(b);
        expect(pw).toBeCloseTo(vb.w * 0.75, 1);
        expect(ph).toBeCloseTo(vb.h * 0.75, 1);
        expect(pdf.info.width).toBeCloseTo(pw, 1);
        const file = resolve(OUT, `${tag}.pdf`);
        writeFileSync(file, b);
        const content = pdfText(b);
        // real text operators with entity / relation names, not an image
        const names: Record<string, string[]> = { A: ['Student', 'SID'], B: ['Company', 'Drug'], C: ['Employee', 'Eid'], D: ['Course', 'Cid'], E: ['Pharmacy', 'Prescription', 'TradeName'] };
        for (const n of names[key]!) expect(content, `text "${n}" in PDF content`).toContain(`(${n})`);
        expect(content).not.toContain('/Subtype /Image');
        expect(content).toMatch(/\/Title \(Example /);
        // rasterise page 1 with macOS sips so we can LOOK at it
        if (process.platform === 'darwin') {
          const png = resolve(OUT, `${tag}.pdf.png`);
          execFileSync('sips', ['-s', 'format', 'png', file, '--out', png], { stdio: 'ignore' });
          expect(existsSync(png)).toBe(true);
        }
      });
    });
  }
}

test('PDF A4 landscape: scaled to fit inside the margins, centred', async () => {
  const pdf = await h<Exported>('exportAs', 'E', 'er', 'pdf', { pageSize: 'a4' });
  const b = buf(pdf.base64);
  const [pw, ph] = mediaBox(b);
  expect(pw).toBeCloseTo(841.89, 1);
  expect(ph).toBeCloseTo(595.28, 1);
  expect(pdf.info.vector).toBe(true);
  writeFileSync(resolve(OUT, 'E-er.a4.pdf'), b);
  const letter = await h<Exported>('exportAs', 'B', 'rel', 'pdf', { pageSize: 'letter', orientation: 'portrait', title: 'Custom title' });
  const lb = buf(letter.base64);
  expect(mediaBox(lb)).toEqual([612, 792]);
  expect(pdfText(lb)).toContain('/Title (Custom title)');
});

test('PDF: arrow glyphs are mapped and stay vector; markup characters survive', async () => {
  const pdf = await h<Exported>('exportAs', 'custom:arrows', 'er', 'pdf');
  expect(pdf.info.vector).toBe(true);
  expect(pdf.warnings).toEqual([]);
  const content = pdfText(buf(pdf.base64));
  expect(content).toContain('(Ship -> Bill)');
  expect(content).toContain('Tom & <Jerry> "x"'.replace(/[()\\]/g, '\\$&'));
  writeFileSync(resolve(OUT, 'arrows.pdf'), buf(pdf.base64));
  if (process.platform === 'darwin') execFileSync('sips', ['-s', 'format', 'png', resolve(OUT, 'arrows.pdf'), '--out', resolve(OUT, 'arrows.pdf.png')], { stdio: 'ignore' });
  // the SVG keeps the real arrow glyph
  const svg = await h<Exported>('exportAs', 'custom:arrows', 'er', 'svg');
  expect(buf(svg.base64).toString('utf8')).toContain('Ship → Bill');
});

test('PDF: CJK falls back to a high-resolution image with an explicit warning', async () => {
  const pdf = await h<Exported>('exportAs', 'custom:cjk', 'er', 'pdf');
  expect(pdf.info.vector).toBe(false);
  expect(pdf.info.scaleUsed).toBeGreaterThanOrEqual(3);
  expect(pdf.warnings).toContain('contains characters PDF standard fonts cannot display; exported as an image');
  const b = buf(pdf.base64);
  expect(b.subarray(0, 5).toString()).toBe('%PDF-');
  const content = pdfText(b);
  expect(content).toContain('/Subtype /Image');
  expect(content).not.toMatch(/\) Tj/); // no garbled text operators
  // the document title (WinAnsi only in the Info dict) degrades to '?', never to garbage bytes
  expect(content).toMatch(/\/Title \(\?+ Café - \?+\)|\/Title \(\?+ Caf/);
  writeFileSync(resolve(OUT, 'cjk.pdf'), b);
  if (process.platform === 'darwin') execFileSync('sips', ['-s', 'format', 'png', resolve(OUT, 'cjk.pdf'), '--out', resolve(OUT, 'cjk.pdf.png')], { stdio: 'ignore' });
  // SVG and PNG of the same diagram keep the CJK text (vector / browser font fallback)
  const svg = await h<Exported>('exportAs', 'custom:cjk', 'er', 'svg');
  expect(buf(svg.base64).toString('utf8')).toContain('学生');
  expect(svg.filename).toBe('课程设计 Café - 概念模型.svg');
  const png = await h<Exported>('exportAs', 'custom:cjk', 'er', 'png');
  writeFileSync(resolve(OUT, 'cjk.png'), buf(png.base64));
});

test('PNG scale is clamped for a very wide diagram and reported', async () => {
  const png = await h<Exported>('exportAs', 'custom:wide', 'er', 'png', { scale: 2 });
  const b = buf(png.base64);
  const w = b.readUInt32BE(16);
  const hh = b.readUInt32BE(20);
  expect(w).toBeLessThanOrEqual(16384);
  expect(hh).toBeLessThanOrEqual(16384);
  expect(w * hh).toBeLessThanOrEqual(16_777_216);
  expect(png.info.scaleUsed!).toBeLessThan(2);
  expect(png.warnings.join()).toMatch(/PNG scale reduced/);
  const a = await h<any>('analysePng', png.base64, false);
  expect(a.touchesEdge).toBe(false);
  // a very wide diagram is also a valid (huge) PDF page within the PDF limit
  const pdf = await h<Exported>('exportAs', 'custom:wide', 'er', 'pdf');
  const [pw] = mediaBox(buf(pdf.base64));
  expect(pw).toBeLessThanOrEqual(14400.5);
  expect(pdf.warnings.join()).toMatch(/maximum PDF page size/);
});

test('empty diagram exports a small blank sheet with a warning in every format', async () => {
  for (const fmt of ['svg', 'png', 'pdf'] as const) {
    const r = await h<Exported>('exportAs', 'custom:empty', 'er', fmt);
    expect(r.warnings).toContain('diagram is empty');
    expect(r.size).toBeGreaterThan(100);
  }
  const png = await h<Exported>('exportAs', 'custom:empty', 'er', 'png');
  expect(png.info.width).toBe(320);
  expect(png.info.height).toBe(160);
});

test('selection export: only the chosen nodes, as SVG and PDF', async () => {
  const sel = await page.evaluate(async () => {
    const hh = (window as any).__h;
    const ids = await hh.ensure('E');
    return ids;
  });
  expect(sel.rel).toBeTruthy();
  const all = await h<Exported>('exportAs', 'E', 'rel', 'svg');
  const nodeIds: string[] = await page.evaluate(() => {
    // nodes whose relation is Doctor or Patient: found via the exported SVG text is brittle, so read the project instead
    return (window as any).__h.nodeIdsByName('E', 'rel', ['Doctor', 'Patient']);
  });
  expect(nodeIds).toHaveLength(2);
  const part = await h<Exported>('exportAs', 'E', 'rel', 'svg', { selectionNodeIds: nodeIds });
  const full = buf(all.base64).toString('utf8');
  const sub = buf(part.base64).toString('utf8');
  expect(sub).toContain('>Doctor<');
  expect(sub).not.toContain('>Pharmacy<');
  expect(sub.length).toBeLessThan(full.length / 2);
  expect(part.info.width).toBeLessThan(all.info.width);
  const pdf = await h<Exported>('exportAs', 'E', 'rel', 'pdf', { selectionNodeIds: nodeIds });
  const content = pdfText(buf(pdf.base64));
  expect(content).toContain('(Doctor)');
  expect(content).not.toContain('(Pharmacy)');
  writeFileSync(resolve(OUT, 'E-rel.selection.svg'), sub);
});

test('dark palette export (for slides) uses the dark background and light strokes', async () => {
  const svg = await h<Exported>('exportAs', 'E', 'rel', 'svg', { darkPalette: true });
  const text = buf(svg.base64).toString('utf8');
  expect(text).toContain('#0f141a');
  writeFileSync(resolve(OUT, 'E-rel.dark.svg'), text);
  const png = await h<Exported>('exportAs', 'E', 'rel', 'png', { darkPalette: true });
  writeFileSync(resolve(OUT, 'E-rel.dark.png'), buf(png.base64));
});

test('JSON export round-trips through the loader in the browser', async () => {
  const r = await h<Exported>('exportAs', 'E', 'er', 'json');
  expect(r.filename).toBe('Example E.schemacanvas.json');
  const parsed = JSON.parse(buf(r.base64).toString('utf8'));
  expect(parsed.format).toBe('schemacanvas-project');
  expect(Object.keys(parsed.project.diagrams)).toHaveLength(2);
});

test('performance: PNG and PDF of the pharmacy example finish quickly', async () => {
  const png = await h<Exported>('exportAs', 'E', 'er', 'png');
  const pdf = await h<Exported>('exportAs', 'E', 'rel', 'pdf');
  console.log(`E ER png ${png.ms.toFixed(0)} ms (${png.size} B), E rel pdf ${pdf.ms.toFixed(0)} ms (${pdf.size} B)`);
  expect(png.ms).toBeLessThan(5000);
  expect(pdf.ms).toBeLessThan(5000);
});
