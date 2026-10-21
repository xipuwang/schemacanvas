#!/usr/bin/env node
/**
 * Rasterise an SVG file with real Chromium so you can LOOK at diagrams.
 *   node scripts/svg2png.mjs in.svg out.png [scale=2]
 * Then view out.png with the Read tool. Use this for every visual verification.
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [, , input, output, scaleArg] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/svg2png.mjs in.svg out.png [scale]');
  process.exit(2);
}
const scale = Number(scaleArg ?? 2);
const svg = readFileSync(input, 'utf8');
const m = svg.match(/<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
const w = m ? Math.ceil(Number(m[1])) : 1200;
const h = m ? Math.ceil(Number(m[2])) : 800;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`wrote ${output} (${w}x${h} @${scale}x)`);
} finally {
  await browser.close();
}
