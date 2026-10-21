/** PDF export: vector (jsPDF + svg2pdf.js, Helvetica text) with an image fallback for text the standard fonts cannot draw. */
import { isWinAnsi } from '@/scene/measure';
import { clampPngScale, rasterizeSvg, withPixelSize } from './png';
import type { ExportInfo, ExportOptions } from './types';

const PX_TO_PT = 0.75;
/** PDF user-space limit (Acrobat): 14400 pt per side. */
const MAX_PAGE_PT = 14400;
const PAPER: Record<'a4' | 'letter', [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
export const IMAGE_FALLBACK_SCALE = 4;
export const IMAGE_FALLBACK_WARNING = 'contains characters PDF standard fonts cannot display; exported as an image';

const ARROWS: Array<[RegExp, string]> = [
  [/↔/g, '<->'],
  [/→/g, '->'],
  [/←/g, '<-'],
];

/** Replace arrow glyphs the built-in fonts lack with ASCII look-alikes. */
export function mapArrowGlyphs(svg: string): string {
  return ARROWS.reduce((s, [re, to]) => s.replace(re, to), svg);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase() as 'amp'] ?? m;
  });
}

/** Distinct text runs of `<text>` elements that contain characters outside Windows-1252. */
export function findNonWinAnsiText(svg: string): string[] {
  const bad = new Set<string>();
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = decodeEntities(m[1]!.replace(/<[^>]+>/g, ''));
    if (!isWinAnsi(text)) bad.add(text);
  }
  return [...bad];
}

export interface PageLayout {
  pageW: number;
  pageH: number;
  /** Drawing box of the diagram on the page, in pt. */
  x: number;
  y: number;
  w: number;
  h: number;
  warnings: string[];
}

/** Page geometry in pt for content of `contentW x contentH` px. Pure. */
export function layoutPage(contentW: number, contentH: number, o: Pick<ExportOptions, 'pageSize' | 'orientation' | 'margin'>): PageLayout {
  const warnings: string[] = [];
  const cw = contentW * PX_TO_PT;
  const ch = contentH * PX_TO_PT;
  const size = o.pageSize ?? 'fit';
  const margin = Math.max(0, Number.isFinite(o.margin) ? (o.margin as number) : size === 'fit' ? 0 : 36);
  if (size === 'fit') {
    const s = Math.min(1, (MAX_PAGE_PT - 2 * margin) / cw, (MAX_PAGE_PT - 2 * margin) / ch);
    if (s < 1) warnings.push('diagram exceeds the maximum PDF page size (14400 pt); it was scaled down to fit');
    const w = cw * s;
    const h = ch * s;
    return { pageW: w + 2 * margin, pageH: h + 2 * margin, x: margin, y: margin, w, h, warnings };
  }
  let [pw, ph] = PAPER[size];
  const landscape = o.orientation === 'landscape' || ((o.orientation ?? 'auto') === 'auto' && cw > ch);
  if (landscape) [pw, ph] = [ph, pw];
  const availW = Math.max(1, pw - 2 * margin);
  const availH = Math.max(1, ph - 2 * margin);
  // Fit inside the margins, never cropped; small diagrams keep their natural size (no upscaling) and are centred.
  const s = Math.min(1, availW / cw, availH / ch);
  const w = cw * s;
  const h = ch * s;
  return { pageW: pw, pageH: ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h, warnings };
}

/** Header strings only hold WinAnsi in the PDF Info dictionary with jsPDF: degrade rather than write garbage. */
function infoSafe(s: string): string {
  return Array.from(s)
    .map((ch) => (isWinAnsi(ch) ? ch : '?'))
    .join('');
}

export interface PdfInput {
  svg: string;
  /** viewBox size in px. */
  width: number;
  height: number;
  background: string | null;
  title: string;
}

export async function renderPdf(input: PdfInput, opts: ExportOptions): Promise<{ blob: Blob; warnings: string[]; info: ExportInfo }> {
  if (typeof document === 'undefined') throw new Error('PDF export requires a browser environment');
  const svg = mapArrowGlyphs(input.svg);
  const page = layoutPage(input.width, input.height, opts);
  const warnings = [...page.warnings];
  const orientation = page.pageW > page.pageH ? 'landscape' : 'portrait';
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [page.pageW, page.pageH], orientation, compress: true });
  doc.setProperties({ title: infoSafe(input.title), subject: 'Database diagram', creator: 'SchemaCanvas' });
  const bad = findNonWinAnsiText(svg);
  let vector = true;
  let scaleUsed: number | undefined;
  if (bad.length === 0) {
    const { svg2pdf } = await import('svg2pdf.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
    try {
      host.innerHTML = svg.replace(/^<\?xml[^>]*\?>\s*/, '');
      const el = host.querySelector('svg');
      if (!el) throw new Error('internal: export SVG did not parse');
      await svg2pdf(el, doc, { x: page.x, y: page.y, width: page.w, height: page.h });
    } finally {
      host.remove();
    }
  } else {
    vector = false;
    warnings.push(IMAGE_FALLBACK_WARNING);
    const c = clampPngScale(input.width, input.height, IMAGE_FALLBACK_SCALE);
    scaleUsed = c.scale;
    if (c.scale < 3) warnings.push(`image resolution reduced to ${c.scale.toFixed(2)}x (page too large)`);
    const png = await rasterizeSvg(withPixelSize(svg, c.width, c.height), c.width, c.height, input.background);
    const bytes = new Uint8Array(await png.arrayBuffer());
    doc.addImage(bytes, 'PNG', page.x, page.y, page.w, page.h, undefined, 'FAST');
  }
  const blob = doc.output('blob');
  return { blob, warnings, info: { width: page.pageW, height: page.pageH, vector, ...(scaleUsed !== undefined ? { scaleUsed } : {}) } };
}
