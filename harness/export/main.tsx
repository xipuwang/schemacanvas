/** Browser harness for the export e2e: builds the example projects, runs every exporter and exposes helpers on window.__h. */
import { createRoot } from 'react-dom/client';
import { produce } from 'immer';
import { erBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import type { Project } from '@/model/types';
import { exportDiagram, renderExportSvg } from '@/export';
import type { ExportFormat, ExportOptions } from '@/export';
import { EXAMPLE_KEYS, buildExampleProject, layoutDiagram, type ExampleKey } from '@/export/fixtures';
import { SceneSvg, lightPalette } from '@/render';
import { buildScene } from '@/scene/registry';

type Which = 'er' | 'rel';
interface Entry { project: Project; er: string; rel: string }
const entries = new Map<string, Entry>();
let liveRoot: ReturnType<typeof createRoot> | undefined;
const clearLive = () => liveRoot?.render(null);

async function ensure(key: string): Promise<Entry> {
  let e = entries.get(key);
  if (e) return e;
  if (key.startsWith('custom:')) e = await buildCustom(key.slice(7));
  else {
    const x = await buildExampleProject(key as ExampleKey);
    e = { project: x.project, er: x.erDiagramId, rel: x.relDiagramId };
  }
  entries.set(key, e);
  return e;
}

/** Small ER projects with awkward text: CJK, arrows, markup. */
async function buildCustom(kind: string): Promise<Entry> {
  const b = erBuilder('Custom');
  if (kind === 'cjk') {
    const s = b.entity('学生').key('学号');
    s.attr('姓名');
  } else if (kind === 'arrows') {
    const s = b.entity('Order').key('Id');
    s.attr('Ship → Bill');
    s.attr('Tom & <Jerry> "x"');
  } else if (kind === 'wide') {
    b.entity('Left').key('Id');
    b.entity('Right').key('Id');
  } else if (kind === 'empty') {
    // nothing
  }
  let project = createBareProject(kind === 'cjk' ? '课程设计 Café' : `Custom ${kind}`);
  const d = withDiagram(project, b.build(), 'chen', { name: kind === 'cjk' ? '概念模型' : 'ER' });
  if (kind === 'wide') {
    project = produce(project, (p) => {
      const nodes = Object.values(p.diagrams[d.id]!.nodes);
      nodes.forEach((n, i) => { n.x = i === 0 ? 0 : 30000; n.y = 0; });
    });
  } else if (kind !== 'empty') project = await layoutDiagram(project, d.id);
  void ops;
  return { project, er: d.id, rel: d.id };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportAs(key: string, which: Which, format: ExportFormat, options?: ExportOptions) {
  const e = await ensure(key);
  const t0 = performance.now();
  const r = await exportDiagram(e.project, which === 'er' ? e.er : e.rel, format, options);
  const ms = performance.now() - t0;
  return { base64: await blobToBase64(r.blob), size: r.blob.size, mime: r.mime, filename: r.filename, warnings: r.warnings, info: r.info, ms };
}

function mountLive(key: string, which: Which): { w: number; h: number } {
  const e = entries.get(key)!;
  const id = which === 'er' ? e.er : e.rel;
  const out = renderExportSvg(e.project, id);
  const scene = buildScene(e.project, id);
  const vb = out.viewBox;
  const el = document.getElementById('live')!;
  liveRoot ??= createRoot(el);
  const root = liveRoot;
  // flushSync-free: render and let the caller wait a frame
  root.render(
    <svg xmlns="http://www.w3.org/2000/svg" width={vb.w} height={vb.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#ffffff" />
      <SceneSvg
        scene={scene}
        project={e.project}
        diagram={e.project.diagrams[id]!}
        ctx={{ palette: lightPalette, interactive: false, selection: new Set(), highlights: {} }}
      />
    </svg>,
  );
  return { w: vb.w, h: vb.h };
}

async function decode(base64: string): Promise<ImageData> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/** Bounding box of "painted" pixels (alpha>0 for transparent PNGs, non-white otherwise) and whether it touches an edge. */
async function analysePng(base64: string, transparent: boolean) {
  const img = await decode(base64);
  const { width: w, height: h, data } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1, painted = 0;
  const painted_ = (i: number) => (transparent ? data[i + 3]! > 8 : data[i + 3]! > 8 && (data[i]! < 245 || data[i + 1]! < 245 || data[i + 2]! < 245));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (painted_((y * w + x) * 4)) {
        painted++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const px = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
  return { w, h, painted, bbox: { minX, minY, maxX, maxY }, corner: px(0, 0), touchesEdge: minX <= 0 || minY <= 0 || maxX >= w - 1 || maxY >= h - 1 };
}

/** Fraction of pixels whose colour differs noticeably between two same-size PNGs. */
async function diffPng(a64: string, b64: string) {
  const [a, b] = await Promise.all([decode(a64), decode(b64)]);
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false, a: [a.width, a.height], b: [b.width, b.height], fraction: 1 };
  let diff = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o]! - b.data[o]!), Math.abs(a.data[o + 1]! - b.data[o + 1]!), Math.abs(a.data[o + 2]! - b.data[o + 2]!));
    if (d > 64) diff++;
  }
  return { sameSize: true, a: [a.width, a.height], b: [b.width, b.height], fraction: diff / n };
}

declare global { interface Window { __h: unknown } }
function nodeIdsByName(key: string, which: Which, names: string[]): string[] {
  const e = entries.get(key)!;
  const d = e.project.diagrams[which === 'er' ? e.er : e.rel]!;
  const m = e.project.models[d.modelId]!;
  return Object.values(d.nodes)
    .filter((n) => {
      if (m.kind === 'relational') return n.ref.kind === 'relation' && names.includes(m.relations[n.ref.id]!.name);
      return n.ref.kind === 'entity' && names.includes(m.entities[n.ref.id]!.name);
    })
    .map((n) => n.id);
}

window.__h = { clearLive, nodeIdsByName, keys: EXAMPLE_KEYS, ensure: async (k: string) => { const e = await ensure(k); return { er: e.er, rel: e.rel }; }, exportAs, mountLive, analysePng, diffPng };
document.title = 'export harness ready';
