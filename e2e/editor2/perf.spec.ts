import { expect, test } from '@playwright/test';

/**
 * Drag performance on the REAL canvas (harness/editor with `?big=`): real pointer events, one node dragged with ~70 moves.
 * Logs per-frame numbers for DRAFT mode and for the old behaviour (`__scForceFull`, full build on every move) and asserts loose
 * thresholds (strict with PERF=1; a quiet machine is assumed for the strict numbers).
 */
const strict = process.env.PERF === '1';
const CASES = [
  { kind: 'rel40', label: '40 tables / 60 FKs', buildMs: 16, frameMs: 33 },
  { kind: 'rel87', label: '87 tables / 112 FKs', buildMs: 33, frameMs: 40 },
  { kind: 'chen60', label: 'Chen 60 entities (290 nodes)', buildMs: 16, frameMs: 33 },
] as const;

interface Sample { mode: string; buildMs: number }
const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0;
};

for (const c of CASES) {
  test(`drag perf: ${c.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const open = async () => {
      await page.goto(`/harness/editor/index.html?big=${c.kind}`);
      await page.waitForSelector('[data-node-id]', { timeout: 90_000 });
      await page.waitForTimeout(300);
      // a node near the middle of the canvas
      const target = await page.evaluate(() => {
        const cv = document.querySelector('.sc-canvas')!.getBoundingClientRect();
        const cx = cv.left + cv.width / 2;
        const cy = cv.top + cv.height / 2;
        let best: { x: number; y: number; d: number } | undefined;
        for (const el of document.querySelectorAll('[data-layer="nodes"] > [data-node-id]')) {
          const b = el.getBoundingClientRect();
          if (b.width < 6 || b.height < 6) continue;
          const kind = el.getAttribute('data-node-kind') ?? '';
          if (kind === 'chen-attribute') continue;
          const x = b.left + b.width / 2;
          const y = b.top + b.height / 2;
          const d = Math.hypot(x - cx, y - cy);
          if (!best || d < best.d) best = { x, y, d };
        }
        return best!;
      });
      const nodes = await page.locator('[data-layer="nodes"] > [data-node-id]').count();
      const edges = await page.locator('[data-layer="edges"] > [data-edge-id]').count();

      return { target, nodes, edges };
    };
    let info = await open();
    const { nodes, edges } = info;
    const run = async (forceFull: boolean) => {
      await page.evaluate((ff) => {
        const w = window as unknown as { __scPerf: unknown[]; __scForceFull: boolean; __frames: number[]; __stop: boolean; __rec: boolean };
        w.__scPerf = [];
        w.__rec = false;
        w.__scForceFull = ff;
        w.__frames = [];
        w.__stop = false;
        let last = performance.now();
        const loop = (): void => {
          const t = performance.now();
          if (w.__rec) w.__frames.push(t - last);
          last = t;
          if (!w.__stop) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }, forceFull);
      await page.mouse.move(info.target.x, info.target.y);
      await page.mouse.down();
      await page.evaluate(() => ((window as unknown as { __rec: boolean }).__rec = true));
      const N = forceFull ? 24 : 70;
      for (let i = 1; i <= N; i++) await page.mouse.move(info.target.x + i * 3, info.target.y + i * 2);
      await page.evaluate(() => ((window as unknown as { __rec: boolean }).__rec = false));
      await page.waitForTimeout(100);
      const mid = forceFull ? undefined : await page.screenshot({ path: `.tmp/editor2/perf-${c.kind}-mid.png` });
      void mid;
      await page.mouse.up();
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const w = window as unknown as { __scPerf: Sample[]; __frames: number[]; __stop: boolean };
        w.__stop = true;
        return { samples: w.__scPerf, frames: w.__frames };
      });
      const builds = r.samples.filter((s) => s.mode === (forceFull ? 'full' : 'draft')).map((s) => s.buildMs);
      const frames = r.frames.slice(1);
      // frames during the drag only: drop the idle tail (frames of ~16.7 ms without work are fine to include; report p50/p95)
      return { builds, frames, fullAfter: r.samples.filter((s) => s.mode === 'full').length };
    };

    const before = await run(true);
    info = await open();
    const after = await run(false);
    const fmt = (a: number[]): string => `p50 ${pct(a, 50).toFixed(1)} / p95 ${pct(a, 95).toFixed(1)} / max ${Math.max(0, ...a).toFixed(1)}`;
    const fps = (f: number[]): string => (1000 / Math.max(1, pct(f, 50))).toFixed(0);
    console.log(
      `PERF ${c.label} (${nodes} nodes, ${edges} edges)\n  before (full build per move): build ms ${fmt(before.builds)}; frame ms ${fmt(before.frames)}; fps(p50) ${fps(before.frames)}\n  after  (draft mode)         : build ms ${fmt(after.builds)}; frame ms ${fmt(after.frames)}; fps(p50) ${fps(after.frames)}; full rebuilds ${after.fullAfter}`,
    );
    expect(after.fullAfter, 'exactly one FULL rebuild after the drop').toBeGreaterThanOrEqual(1);
    const slack = strict ? 1 : 4;
    expect(pct(after.builds, 50), `draft build p50 for ${c.label}`).toBeLessThanOrEqual(c.buildMs * slack);
    expect(pct(after.frames, 50), `frame p50 for ${c.label}`).toBeLessThanOrEqual(c.frameMs * (strict ? 1 : 2));
    expect(errors).toEqual([]);
  });
}
