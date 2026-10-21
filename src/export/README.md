# src/export

SVG / PNG / PDF / native JSON export. Everything renders the SAME scene as the editor (`buildScene` + `SceneSvgCore`, light palette).

```ts
import { exportDiagram, exportProjectJson, suggestFilename, downloadBlob, copyDiagramPngToClipboard } from '@/export';

const r = await exportDiagram(project, diagramId, 'svg' | 'png' | 'pdf' | 'json', options?);  // ExportResult
downloadBlob(r.blob, r.filename);
r.warnings   // human-readable (English) strings: 'diagram is empty', scene warnings, PNG scale reduced..., PDF image fallback
r.info       // { width, height, scaleUsed?, vector }  svg: viewBox px; png: pixels; pdf: page pt
```
`ExportOptions`: `background` ('white'|'transparent'), `padding` (>=2, default 24), `scale` (PNG, default 2), `selectionNodeIds`,
`pageSize` ('fit'|'a4'|'letter'), `orientation`, `margin` (pt; 0 fit / 36 paper), `title`, `darkPalette`.
Other exports: `exportProjectJson(project)`, `suggestFilename(project, diagram|undefined, ext)`, `renderExportSvg` (pure, Node-safe),
`clampPngScale`, `layoutPage`, `copyPngToClipboard(blob)` (best effort, resolves false), `copyDiagramPngToClipboard`.

## Behaviour
* **SVG** (`svg.ts`, pure, deterministic): XML declaration, `<title>`/`<desc>`, escaped text, concrete colours only, no data-* attributes, floats
  trimmed to 3 decimals, viewBox = `Scene.bounds` (paint bounds) + padding rounded OUTWARD.
* **Selection**: temp project, diagram with only those nodes, `partial = true`, `syncDiagramEdges` keeps edges between kept nodes. Input never mutated.
* **PNG** (`png.ts`): SVG -> Image -> canvas, size = `ceil(viewBox*scale)`, scale clamped to 16384 px/side and 16,777,216 px area (warning + `scaleUsed`).
  White background is also filled on the canvas; the raster SVG uses `preserveAspectRatio="none"` so no half-transparent edge row appears.
* **PDF** (`pdf.ts`): jsPDF + svg2pdf.js (dynamically imported), Helvetica vector text, compressed streams. Arrows -> `->`, `<-`, `<->`. Any remaining
  non-WinAnsi text (CJK ...) => whole page embedded as a 4x PNG image, `info.vector=false`, warning
  `contains characters PDF standard fonts cannot display; exported as an image`. Paper sizes: diagram scaled DOWN to fit inside margins (never upscaled), centred.
  Pages are capped at 14400 pt (warning). Info-dict title degrades non-WinAnsi characters to `?`.
* **Empty diagram**: blank 160x80 sheet + warning `diagram is empty`. Unknown diagram id rejects; soft-invalid models never throw.
* **Filenames**: `<project> - <diagram>.<ext>`, NFC, sanitised via `projectFileName`, reserved Windows names prefixed `_`; json = `<project>.schemacanvas.json`.

## Tests
* `npx vitest run src/export` (Node: SVG structure/bounds/escaping/determinism/selection/1000+ nodes, filenames, clamp, page layout).
* `E2E_PORT=5203 npx playwright test e2e/export` (real Chromium via `harness/export/index.html`; artefacts in `.tmp/export/`).
* `fixtures.ts` builds the five examples (ER + converted relational, auto-laid-out); test/harness only.

## Loading
`@/export` itself is only reached through the lazily loaded Export dialog; jsPDF, svg2pdf.js (and their html2canvas / canvg / dompurify dependencies) are `import()`ed inside `pdf.ts` on the first PDF export, so they are separate chunks (see docs/PERFORMANCE.md). Nothing here changed for the bundle work.
