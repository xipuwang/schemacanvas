// @vitest-environment node
import './deterministic';
/**
 * P3 RENDER (browser tier, INTEGRATION_BROWSER=1): in REAL Chromium, the union of getBBox of every painted element,
 * expressed in the SVG's viewBox coordinates, must lie inside the viewBox (no clipping) for every example and type.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { EXAMPLE_KEYS } from './helpers';
import { CHEN_VARIANTS, REL_VARIANTS, renderExample, renderVariant, type Rendered } from './renderAll';

const run = process.env.INTEGRATION_BROWSER ? describe : describe.skip;

run('P3 browser: no clipping in real Chromium', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function assertNoClipping(r: Rendered, tagPrefix = ''): Promise<void> {
    {
      {
        const page = await browser.newPage();
        try {
          await page.setContent(`<html><body style="margin:0">${r.svg}</body></html>`);
          const res = await page.evaluate(() => {
            const svg = document.querySelector('svg')!;
            const vb = svg.viewBox.baseVal;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
            const sel = 'path,line,rect,polygon,polyline,ellipse,circle,text';
            for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(sel))) {
              // skip the white background rect (it IS the viewBox)
              if (el.tagName === 'rect' && (el.parentElement as unknown) === svg && el.getAttribute('fill') === '#ffffff') continue;
              const bb = el.getBBox();
              if (bb.width === 0 && bb.height === 0) continue;
              const m = el.getCTM()!;
              const root = svg.getCTM()!;
              const rel = root.inverse().multiply(m);
              for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]] as const) {
                const px = rel.a * x + rel.c * y + rel.e;
                const py = rel.b * x + rel.d * y + rel.f;
                minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
              }
              count++;
            }
            return { vb: { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, minX, minY, maxX, maxY, count };
          });
          const tag = `${tagPrefix}${r.key}-${r.type}`;
          expect(res.count, tag).toBeGreaterThan(5);
          const eps = 0.5;
          expect(res.minX, `${tag} left`).toBeGreaterThanOrEqual(res.vb.x - eps);
          expect(res.minY, `${tag} top`).toBeGreaterThanOrEqual(res.vb.y - eps);
          expect(res.maxX, `${tag} right`).toBeLessThanOrEqual(res.vb.x + res.vb.w + eps);
          expect(res.maxY, `${tag} bottom`).toBeLessThanOrEqual(res.vb.y + res.vb.h + eps);
        } finally {
          await page.close();
        }
      }
    }
  }

  for (const key of EXAMPLE_KEYS) {
    it(`example ${key}: painted bbox union is inside the viewBox (both diagram types)`, async () => {
      for (const r of await renderExample(key)) await assertNoClipping(r);
    });
  }
  for (const [name, patch] of CHEN_VARIANTS) {
    it(`Pharmacy chen variant ${name}: no clipping`, async () => assertNoClipping(await renderVariant(name, 'chen', patch), `${name}/`));
  }
  for (const [name, patch] of REL_VARIANTS) {
    it(`Pharmacy relational variant ${name}: no clipping`, async () => assertNoClipping(await renderVariant(name, 'relational', patch), `${name}/`));
  }
});
