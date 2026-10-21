/**
 * Deterministic text measurement.
 *
 * The canonical diagram font is Helvetica. Helvetica, Arial and Liberation Sans have identical
 * advance widths, and jsPDF's built-in Helvetica matches too, so metrics from the Adobe AFM
 * tables below are accurate in the browser, in the SVG/PNG/PDF exports AND in Node unit tests.
 * Scenes are therefore reproducible everywhere — no canvas measurement, no layout drift.
 */
import type { FontSpec, MeasureText } from './base';

// Helvetica advance widths (1/1000 em) for ASCII 32..126.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126.
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals … unified ideographs, kana
    (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function glyphWidth(code: number, bold: boolean, mono: boolean): number {
  if (isFullWidth(code)) return 1000;
  if (mono) return 600;
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32]!;
  if (code === 0x2192 || code === 0x2190 || code === 0x2194) return 1000; // arrows
  if (code === 0x2022) return 350; // bullet
  if (code === 0x2026) return 1000; // ellipsis
  if (code >= 0x300 && code <= 0x36f) return 0; // combining marks
  // Accented Latin (é, Ö, ñ …): same advance as the base letter in Helvetica.
  const base = String.fromCodePoint(code).normalize('NFD')[0];
  if (base && base !== String.fromCodePoint(code)) {
    const bc = base.codePointAt(0)!;
    if (bc >= 32 && bc <= 126) return (bold ? BOLD : REGULAR)[bc - 32]!;
  }
  return bold ? 611 : 556; // other Latin / Greek / Cyrillic: a sensible average
}

export const isMonospaceFont = (family: string): boolean => /courier|mono|consolas|menlo/i.test(family);

/** Width of `text` in `font`, in the same units as `font.size` (px). */
export const measureTextMetric: MeasureText = (text: string, font: FontSpec): number => {
  const bold = font.weight === 'bold';
  const mono = isMonospaceFont(font.family);
  let units = 0;
  for (const ch of text) units += glyphWidth(ch.codePointAt(0)!, bold, mono);
  return (units * font.size) / 1000;
};

/**
 * Browser canvas measurement for fonts without a metric table (user-chosen custom fonts).
 * Falls back to the metric table outside a DOM. Not used by default.
 */
export function createCanvasMeasure(): MeasureText {
  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return measureTextMetric;
  const c = ctx;
  return (text, font) => {
    c.font = `${font.style === 'italic' ? 'italic ' : ''}${font.weight === 'bold' ? 'bold ' : ''}${font.size}px ${font.family}`;
    return c.measureText(text).width;
  };
}

/** The measure every scene build uses unless a caller deliberately overrides it. */
export const defaultMeasure: MeasureText = measureTextMetric;

const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True if every character is in Windows-1252 — the only repertoire jsPDF's built-in Helvetica can print. */
export function isWinAnsi(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(c)) continue;
    return false;
  }
  return true;
}
