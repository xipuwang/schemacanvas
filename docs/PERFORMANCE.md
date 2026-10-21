# Performance, bundle and hosting

Reproduce everything with the commands at the bottom. Numbers were measured on an Apple-silicon laptop, headless Chromium (Playwright),
on a machine shared with other work (so absolute times are noisy; ratios are the point).


> Current state: see the Verification section of [RELEASE.md](../RELEASE.md) for the latest test numbers, and [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) for the latest bundle size. The sections below are the history of how they were reached. Release scripts: `npm run release:build` (notices, build, publish gate), `npm run notices`, `npm run check:dist`, `node scripts/bundle-size.mjs`.

## 1. Bundle (production, `npx vite build`)

Before (one entry chunk, everything eager):

| chunk | raw | gzip |
|---|---:|---:|
| `index` (app + react + all dialogs + SQL/DBML + converter + examples + export + i18n) | 1,357.7 KB | **411.9 KB** |
| `elk.bundled` (lazy) | 1,430.7 KB | 441.9 KB |
| `jspdf` / `html2canvas` / `index.es` (canvg) / `svg2pdf` / `purify` (all lazy) | 399.0 / 199.5 / 151.4 / 86.2 / 29.0 KB | 129.6 / 46.8 / 48.9 / 25.0 / 11.4 KB |

Initial download = the entry chunk: **411.9 KB gzip**.

After (initial load = static import closure of `index.html`, `node scripts/bundle-size.mjs`):

| chunk | raw | gzip | what |
|---|---:|---:|---|
| `index` | ~270 KB | ~81 KB | app shell, editor, canvas, model, store |
| `issues` (named after its first module) | ~232 KB | ~69 KB | **all i18n catalogues, en + zh** (`import.meta.glob` eager) |
| `vendor-react` | 214 KB | 66 KB | react + react-dom (floor) |
| `react-dom-server` | 197 KB | 59.5 KB | (before the earlier size reduction) only because `ui/dialogs/recent` imported `@/render/standalone` statically; now lazy, see below |
| `registry` | 72 KB | 25 KB | scene builders / geometry |
| `validation` | 43 KB | 12 KB | |
| `components`, `vendor-state`, small shared chunks | ~70 KB | ~25 KB | |
| **TOTAL initial** | ~1,097 KB | **~340 KB** | vs 411.9 KB before |

Lazy now (loaded on first use, with the dialog frame + spinner shown immediately): `ConvertDialog`+`convert` (conversion engine) 4.8+15.7, `ExportDialog` 3.9
(+ `sqlOutput`), `ImportDialog` 17.8 (SQL/DBML parsers), `ExamplesDialog`+`examples` 2+7, SQL dialog/dock, `DiagramForm`, `IssuesDock`, `LibraryPanel` (+ previews through
`react-dom/server`), `PropertiesPanel` 13.6, `autoLayout` (+ Chen engine) 8.3, ELK glue, ELK itself (worker 1.4 MB / in-thread fallback 1.4 MB, never both), jsPDF + svg2pdf on the first PDF export.

**Earlier size reduction (measured with `node scripts/bundle-size.mjs`, static closure of `index.html`): initial JS 340.0 KB -> 280.2 KB gzip (897 KB raw).**
What changed: (1) the Recent dialog is registered through `lazyDialog` (`src/ui/dialogs/recent/index.ts`) and its thumbnail renderer is a dynamic import
(`thumbnailSvg` is async); (2) `vite.config.ts` gets a `render-standalone` code-splitting group (`standalone.tsx` + `standaloneCore.tsx`, `includeDependenciesRecursively: false`)
so the shared render chunk no longer statically imports `react-dom/server` (the entry shared a chunk with `renderSceneToSvgStringCore`; `react-dom-server` 59.5 KB gz and the standalone renderer
now load only with the first dialog/panel/export that draws SVG strings).

**Current (release candidate, 2026-10-21): initial JS 246.9 KB gzip (785.9 KB raw), target "<= 250 KB gzip" met; the latest figure is in [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).** A pass on 2026-10-20 brought it from 306.6 KB to 244.2 KB; the release fixes (SQL guard, error boundary, recovery) added about 3 KB. Chinese catalogues are a separate chunk
(`scripts/vite-i18n-split.ts` splits each `messages/*.ts` into an eager `en` and a lazy `zh` module; `setLocaleLoaded` switches only after the load, latest
request wins, boot awaits a persisted zh before first paint); the issue/conversion/DDL/decision texts load right after first paint (logic modules write the same
English); `shell/validation.ts` loads the DDL checks lazily. The two items below describe that pass; kept for history.

Status before the 2026-10-20 pass (280.2 KB). What was left:
1. The i18n catalogues (~63 KB gz, in the `invariants` chunk) are eager and contain both languages and every dialog/dock/panel namespace. Loading `zh` (and lazy namespaces) on demand would save
   roughly 30-35 KB gz, but every `messages/*.ts` is a single `defineMessages(ns, { en, zh })` object and the whole test suite assumes a synchronous catalogue: splitting means rewriting
   ~20 catalogue files into en/zh modules plus an async locale switch (flash of English, tests, SSR-style standalone callers). Not a one-hour change; not done.
2. `shell/validation.ts` imports `ddlIssues` from `@/sql` statically (about 8 KB gz of the DDL generator in the entry).
With (1) and (2) the initial load would be about 240 KB gzip.

How: `React.lazy` wrappers (`src/ui/dialogs/content/lazy.tsx`), `src/layout/index.ts` lazy wrappers, `vite.config.ts` `codeSplitting.groups` (vendor-react, vendor-state, react-dom-server) +
`treeshake.moduleSideEffects` for `react-dom/server` / `render/standalone*` (so the barrel `@/render` does not evaluate the server renderer in the entry).

`node scripts/bundle-size.mjs` builds with source maps into `.tmp/bundle-analysis` and prints per-chunk size, the biggest source groups of every chunk and the initial closure.

## 2. ELK off the main thread

`src/layout/elkRunner.ts`: a dedicated Web Worker (`elkjs/lib/elk-worker.min.js?worker` + `elk-api`) in the browser; the bundled in-thread ELK in Node/vitest/jsdom, when
`Worker` is missing or cannot be constructed, or when the worker dies. Same ELK build, same options and seed, so identical results (unit test on the Pharmacy relational + ER
fixtures and on all five algorithms; e2e compares 290 node positions of a 60-entity Chen diagram, worker vs `Worker` removed). Stale requests: `AbortSignal` on `autoLayout`/`layoutGraph`/`layoutChen`
(rejects with `AbortError`, worker terminated when idle). Busy state: `layoutBusyStore` (see src/layout/README.md "UI hook").

Auto-layout of a 60-entity Chen diagram (290 nodes) in the real app (frame gap = longest time between two animation frames while it runs):

| mode | worker | in-thread (Worker removed) |
|---|---:|---:|
| dev | 17 ms | 1,533 ms (long task 1.5 s) |
| `vite preview` | 33 ms | 3,167 ms |
| subfolder static server | 17 ms | 1,550 ms |

Verified in `vite dev`, in the production build under `vite preview` and under a static server at `/schemacanvas/` (the worker file is emitted as `assets/elk-worker.min-*.js`, found relative to its module).

## 3. Hosting

`base: '/schemacanvas/'` for the production build (`SC_BASE` overrides it; `BUILD_BASE` in `vite.config.ts`); the dev server and the Playwright suites run at `/`. Proven by `e2e/perf` against `scripts/serve-static.mjs dist <port> /schemacanvas/`
(everything outside the prefix is a 404): boot, fonts (CSS `url()`), ELK worker, lazy chunks, Pharmacy open + convert + auto-layout, PDF and SVG export, console clean, no failed request.
Scripts: `build`, `preview`, `typecheck`, `test`, `test:e2e`, `test:all` (typecheck + unit + build), `e2e:all` (all Playwright specs serially, one dev server), `e2e:perf`, `analyze`, `serve:dist`.
Nothing is deployed by this repository; the GitHub Pages steps are in [RELEASE.md](../RELEASE.md). Notes: the `<meta>`/inline pre-paint theme script in `index.html` sets `data-theme` before the bundle loads (same rule as `applyThemeNow`); static hosts only need to serve `dist/` as files (no SPA fallback needed, there is no router).

## 4. Startup (Playwright performance entries, empty app)

| | dev | `vite preview` (gzip) | subfolder (no gzip) |
|---|---:|---:|---:|
| DOMContentLoaded | 345 ms | 164 ms | 38 ms (localhost, cached disk) |
| first-contentful-paint | 448 ms | 220 ms | 76 ms |
| goto -> toolbar visible | 500 ms | 456 ms | 109 ms |
| first real click -> Examples dialog visible (first lazy chunk) | 139 ms | 153 ms | 37 ms |
| JS requests at startup | 11 (pre-bundled deps) | 23 | 23 |
| JS transferred (encoded) | 5.7 MB (unminified dev) | 378 KB | 1,253 KB (server does not gzip) |

Pharmacy flow (production, subfolder): open example from the empty app 921 ms (includes the lazy Examples chunk, thumbnails and the example build), Convert preview 864 ms
(ELK in the worker), Auto-layout command 283 ms, PDF export 1.9 s (jsPDF + svg2pdf load at that moment; asserted NOT requested before).
Memory: JS heap after GC with 3 open sheets (ER, relational, one new) 15 MB in the production build (42 MB dev).

## Reproduce

```
npm run analyze                                           # builds with source maps into .tmp/bundle-analysis, prints chunks + initial closure
npm run build                                             # tsc + vite build -> dist/
E2E_PORT=5223 PERF_MODE=dev       npm run e2e:perf
E2E_PORT=5223 PERF_MODE=preview   npm run e2e:perf        # needs `npm run build`
E2E_PORT=5223 PERF_MODE=subfolder npm run e2e:perf        # needs `npm run build`; serves dist/ at /schemacanvas/
```
Metrics land in `.tmp/perf/metrics-<mode>.json`, screenshots in `.tmp/perf/`.
