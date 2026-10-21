import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { EXAMPLES } from '../../src/examples';

const SHOTS = '.tmp/examples/shots';
mkdirSync(SHOTS, { recursive: true });

test.describe('examples gallery harness (real Chromium)', () => {
  test('no console errors and every thumbnail is real SVG', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/harness/examples/index.html');
    await page.waitForFunction(() => (window as unknown as { __examplesReady?: boolean }).__examplesReady === true);
    await expect(page.locator('.card svg')).toHaveCount(EXAMPLES.length * 2);
    expect(errors).toEqual([]);
    // no horizontal page scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  for (const ex of EXAMPLES) {
    for (const kind of ['er', 'relational'] as const) {
      test(`${ex.id} ${kind}: painted bbox union lies inside the viewBox (no clipping)`, async ({ page }) => {
        await page.goto('/harness/examples/index.html');
        await page.waitForFunction(() => (window as unknown as { __examplesReady?: boolean }).__examplesReady === true);
        const card = page.locator(`.card[data-example="${ex.id}"][data-kind="${kind}"]`);
        const res = await card.locator('svg').evaluate((svg: SVGSVGElement) => {
          const vb = svg.viewBox.baseVal;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
          const root = svg.getCTM()!;
          for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>('path,line,rect,polygon,polyline,ellipse,circle,text'))) {
            if (el.tagName === 'rect' && (el.parentElement as unknown) === svg) continue; // background
            const bb = el.getBBox();
            if (bb.width === 0 && bb.height === 0) continue;
            const m = root.inverse().multiply(el.getCTM()!);
            for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]] as const) {
              const px = m.a * x + m.c * y + m.e;
              const py = m.b * x + m.d * y + m.f;
              minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }
            count++;
          }
          return { vb: { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, minX, minY, maxX, maxY, count };
        });
        expect(res.count).toBeGreaterThan(5);
        const eps = 0.5;
        expect(res.minX).toBeGreaterThanOrEqual(res.vb.x - eps);
        expect(res.minY).toBeGreaterThanOrEqual(res.vb.y - eps);
        expect(res.maxX).toBeLessThanOrEqual(res.vb.x + res.vb.w + eps);
        expect(res.maxY).toBeLessThanOrEqual(res.vb.y + res.vb.h + eps);
        // widen the viewport so the card is not clipped by the page width, then look at the whole diagram
        const size = await card.locator('svg').evaluate((svg) => ({ w: Math.ceil(svg.getBoundingClientRect().width), h: Math.ceil(svg.getBoundingClientRect().height) }));
        await page.setViewportSize({ width: Math.max(1000, size.w + 80), height: Math.max(700, size.h + 120) });
        await card.screenshot({ path: `${SHOTS}/${ex.id}-${kind}.png` });
      });
    }
  }
});
