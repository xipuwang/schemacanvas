#!/usr/bin/env node
/**
 * Real-Chromium check of the crow's foot / physical SVGs written by src/render/vertical/visual.test.tsx:
 *   VISUAL=1 npx vitest run src/render/vertical/visual && node harness/crows/check.mjs
 * 1. every painted element's bbox lies inside the SVG viewBox (nothing clipped);
 * 2. every row/cell text fits horizontally inside its own row/cell rect (browser font metrics, 1.5px tolerance).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = '.tmp/crows';
const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
const browser = await chromium.launch();
let bad = 0;
try {
  for (const f of files) {
    const svg = readFileSync(`${dir}/${f}`, 'utf8');
    const page = await browser.newPage();
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const res = await page.evaluate(() => {
      const root = document.querySelector('svg');
      const vb = root.viewBox.baseVal;
      const out = { clipped: [], overflow: [], painted: 0 };
      for (const el of root.querySelectorAll('polyline,polygon,line,circle,rect,text')) {
        const b = el.getBBox();
        out.painted++;
        if (b.x < vb.x - 0.5 || b.y < vb.y - 0.5 || b.x + b.width > vb.x + vb.width + 0.5 || b.y + b.height > vb.y + vb.height + 0.5) out.clipped.push(el.tagName);
      }
      for (const g of root.querySelectorAll('[data-column-id]')) {
        const r = g.querySelector('rect,polygon');
        const rb = r.getBBox();
        for (const t of g.querySelectorAll('text')) {
          const tb = t.getBBox();
          if (tb.x < rb.x - 1.5 || tb.x + tb.width > rb.x + rb.width + 1.5) out.overflow.push(t.textContent);
        }
      }
      return out;
    });
    const ok = res.clipped.length === 0 && res.overflow.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}: ${res.painted} painted, clipped=${res.clipped.length} overflow=${JSON.stringify(res.overflow)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
